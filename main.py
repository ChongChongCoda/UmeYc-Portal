"""Loopback file previews and explicitly opened, short-lived QR URL input."""

import asyncio
from collections import OrderedDict
import faulthandler
import html
import json
import math
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import mimetypes
import os
from pathlib import Path
import queue
import secrets
import shutil
import socketserver
import sys
import threading
import time
from urllib.parse import urlsplit

# Decky loads main.py by filename rather than importing a plugin package.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from phone_input import PhoneInputSession, lan_address, normalize_url
from image_upload import upload_destination, ensure_upload_directory
from local_app import LocalAppServer, validate_app
from local_library import LocalLibrary
from offline_server import OfflineServer
from offline_store import OfflineLibrary
from storage_migration import StorageMigration, plan_migration
from web_capture import PageCapture, SaveJob
from web_scroll import WebScroller


DIAGNOSTIC_ROOT = Path(os.environ.get("DECKY_USER_HOME", "/home/deck"))
DIAGNOSTIC_FLAG = DIAGNOSTIC_ROOT / "umeyc-debug.flag"
DIAGNOSTIC_LOG = DIAGNOSTIC_ROOT / "umeyc-backend-stack.txt"
_diagnostics_started = False


def _start_diagnostics():
    """Dump all backend threads while a user-created flag file exists."""
    global _diagnostics_started
    if _diagnostics_started:
        return
    _diagnostics_started = True

    def loop():
        while True:
            try:
                if DIAGNOSTIC_FLAG.exists():
                    with DIAGNOSTIC_LOG.open("a", encoding="utf-8") as handle:
                        handle.write(
                            f"\n===== {time.strftime('%Y-%m-%d %H:%M:%S')} =====\n"
                        )
                        faulthandler.dump_traceback(file=handle, all_threads=True)
                        handle.flush()
            except Exception:  # noqa: BLE001 - diagnostics must never break the plugin
                pass
            time.sleep(10)

    threading.Thread(target=loop, daemon=True, name="portal-diagnostics").start()


_start_diagnostics()


SUPPORTED_EXTENSIONS = {
    ".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".svg", ".avif", ".ico",
    ".pdf", ".html", ".htm", ".txt", ".md",
}
IMAGE_EXTENSIONS = SUPPORTED_EXTENSIONS - {".pdf", ".html", ".htm", ".txt", ".md"}


class PreviewServer(ThreadingHTTPServer):
    daemon_threads = True

    def server_bind(self):
        # HTTPServer.server_bind performs a blocking reverse-DNS lookup.
        socketserver.TCPServer.server_bind(self)
        host, port = self.server_address[:2]
        self.server_name = host
        self.server_port = port

    def __init__(self):
        self.grants = OrderedDict()
        self.grants_lock = threading.Lock()
        self.reader_states = OrderedDict()
        self.listeners = {}
        self.stopping = False
        super().__init__(("127.0.0.1", 0), PreviewHandler)

    def authorize(self, path):
        with self.grants_lock:
            # Reuse the same page while reopening the same file in this session.
            for token, granted in self.grants.items():
                if granted == path:
                    self.grants.move_to_end(token)
                    break
            else:
                token = secrets.token_urlsafe(32)
            self.grants[token] = path
            while len(self.grants) > 64:
                self.grants.popitem(last=False)
        route = "viewer" if path.suffix.lower() in IMAGE_EXTENSIONS else "file"
        return f"http://127.0.0.1:{self.server_port}/{route}/{token}"

    def motion(self, path, x, y):
        self.broadcast(path, {"x": x, "y": y})

    def broadcast(self, path, message):
        payload = json.dumps(message)
        with self.grants_lock:
            tokens = [token for token, granted in self.grants.items() if granted == path]
            for token in tokens:
                for listener in self.listeners.get(token, []):
                    if listener.full():
                        listener.get_nowait()
                    listener.put_nowait(payload)

    def stop_readers(self):
        with self.grants_lock:
            self.stopping = True
            for listeners in self.listeners.values():
                for listener in listeners:
                    if listener.full():
                        listener.get_nowait()
                    listener.put_nowait(None)


class PreviewHandler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        # File names and bearer tokens must not end up in the access log.
        pass

    def do_HEAD(self):
        self._respond(head=True)

    def do_GET(self):
        self._respond(head=False)

    def do_POST(self):
        parts = urlsplit(self.path).path.split("/")
        origin = f"http://127.0.0.1:{self.server.server_port}"
        if (self.headers.get("Host") != origin.removeprefix("http://") or
                self.headers.get("Origin") not in {None, origin} or
                len(parts) != 3 or parts[1] != "state"):
            self.send_error(403)
            return
        with self.server.grants_lock:
            path = self.server.grants.get(parts[2])
        if path is None:
            self.send_error(404)
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 1024:
                raise ValueError()
            state = json.loads(self.rfile.read(length))
            saved = {name: float(state[name]) for name in ("top", "left", "zoom")}
            if not all(math.isfinite(value) for value in saved.values()):
                raise ValueError()
            if not (0 <= saved["top"] <= 100000 and 0 <= saved["left"] <= 100000 and
                    0.25 <= saved["zoom"] <= 8):
                raise ValueError()
        except (ValueError, KeyError, TypeError):
            self.send_error(400)
            return
        with self.server.grants_lock:
            self.server.reader_states[path] = saved
            self.server.reader_states.move_to_end(path)
            while len(self.server.reader_states) > 128:
                self.server.reader_states.popitem(last=False)
        self.send_response(204)
        self.end_headers()

    def _respond(self, head):
        if self.headers.get("Host") != f"127.0.0.1:{self.server.server_port}":
            self.send_error(403)
            return
        parts = urlsplit(self.path).path.split("/")
        if len(parts) != 3 or parts[1] not in {"viewer", "file", "script", "events"}:
            self.send_error(404)
            return
        route, token = parts[1:]
        with self.server.grants_lock:
            path = self.server.grants.get(token)
        if path is None:
            self.send_error(404)
            return

        try:
            if route == "viewer":
                with self.server.grants_lock:
                    state = dict(self.server.reader_states.get(path, {"top": 0, "left": 0, "zoom": 1}))
                template = Path(__file__).with_name("assets").joinpath("image-viewer.html")
                content = template.read_text(encoding="utf-8").replace(
                    "{{TITLE}}", html.escape(path.name)
                ).replace("{{TOKEN}}", token).replace(
                    "{{STATE}}", html.escape(json.dumps(state), quote=True)
                )
                icons = json.loads(template.with_name("zoom-icons.json").read_text())
                for key, icon in icons.items():
                    content = content.replace("{{ICON_" + key.upper() + "}}", html.escape(icon, quote=True))
                content = content.encode("utf-8")
                self._headers("text/html; charset=utf-8", len(content))
                if not head:
                    self.wfile.write(content)
            elif route == "script":
                content = Path(__file__).with_name("assets").joinpath("image-viewer.js").read_bytes()
                self._headers("text/javascript; charset=utf-8", len(content))
                if not head:
                    self.wfile.write(content)
            elif route == "events":
                if head:
                    self._headers("text/event-stream", 0)
                else:
                    self._events(token)
            else:
                with path.open("rb") as source:
                    # Use the opened file's size, avoiding a separate stat/open race.
                    size = os.fstat(source.fileno()).st_size
                    mime = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
                    if path.suffix.lower() in {".txt", ".md"}:
                        mime = "text/plain; charset=utf-8"
                    self._headers(mime, size, sandbox=True)
                    if not head:
                        shutil.copyfileobj(source, self.wfile)
        except (FileNotFoundError, PermissionError, IsADirectoryError):
            self.send_error(404, "File is unavailable; please select it again")
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _events(self, token):
        listener = queue.Queue(maxsize=4)
        with self.server.grants_lock:
            subscribers = self.server.listeners.setdefault(token, [])
            if len(subscribers) >= 4:
                self.send_error(429)
                return
            subscribers.append(listener)
        try:
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(b": connected\n\n")
            self.wfile.flush()
            while not self.server.stopping:
                try:
                    payload = listener.get(timeout=15)
                    if payload is None:
                        break
                    self.wfile.write(f"data: {payload}\n\n".encode())
                except queue.Empty:
                    self.wfile.write(b": keepalive\n\n")
                self.wfile.flush()
        finally:
            with self.server.grants_lock:
                self.server.listeners.get(token, []).remove(listener)

    def _headers(self, content_type, length, sandbox=False):
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(length))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("X-Content-Type-Options", "nosniff")
        if sandbox:
            self.send_header("Content-Security-Policy", "sandbox")
        else:
            self.send_header("Content-Security-Policy", "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; script-src 'self'; connect-src 'self'")
        self.end_headers()


class Plugin:
    def __init__(self):
        self._server = None
        self._thread = None
        self._phone = None
        self._phone_lock = asyncio.Lock()
        self._web_scroller = WebScroller()
        self._library = LocalLibrary(SUPPORTED_EXTENSIONS)
        self._offline = OfflineLibrary()
        self._offline_server = None
        self._offline_thread = None
        # Decky treats _migration/_uninstall as plugin hooks when present and
        # would call them during startup; keep internal jobs on other names.
        self._storage_migration = None
        self._storage_migration_lock = threading.Lock()
        self._offline_save = None
        self._offline_save_task = None
        self._local_app_server = None
        self._local_app_thread = None

    def _start(self):
        if self._server is None:
            self._server = PreviewServer()
            self._thread = threading.Thread(target=self._server.serve_forever, daemon=True)
            self._thread.start()

    async def _main(self):
        self._start()

    async def prepare_local_file(self, path: str):
        if not isinstance(path, str) or not Path(path).is_absolute():
            raise ValueError("请选择一个本地文件")
        try:
            selected = Path(path).resolve(strict=True)
            if not selected.is_file():
                raise ValueError("请选择文件，不能选择文件夹")
            if selected.suffix.lower() not in SUPPORTED_EXTENSIONS:
                raise ValueError("支持图片、PDF、HTML 和文本文件")
            with selected.open("rb"):
                pass
        except OSError as error:
            raise ValueError("文件不存在或无法读取，请检查 SD 卡后重新选择") from error
        self._start()
        return {"url": self._server.authorize(selected)}

    async def list_local_files(self, directory: str):
        try:
            return self._library.list(directory)
        except OSError as error:
            raise ValueError("无法读取文件夹，请检查存储设备或重新选择位置") from error

    async def delete_local_file(self, token: str):
        try:
            path = self._library.delete(token)
        except OSError as error:
            raise ValueError("文件不存在或无法删除，请刷新列表后重试") from error
        if self._server is not None:
            with self._server.grants_lock:
                selected = Path(path)
                self._server.reader_states.pop(selected, None)
                for grant, granted in list(self._server.grants.items()):
                    if granted == selected:
                        self._server.grants.pop(grant)
                        for listener in self._server.listeners.get(grant, []):
                            if listener.full():
                                listener.get_nowait()
                            listener.put_nowait(None)
        return {"path": path}

    async def get_upload_directory(self, directory: str = ""):
        destination = upload_destination(directory)
        try:
            ensure_upload_directory(destination)
        except OSError as error:
            raise ValueError("图片保存位置无法使用，请重新选择文件夹") from error
        return {"directory": str(destination)}

    def _start_offline(self):
        if self._offline_server is None:
            self._offline_server = OfflineServer(self._offline)
            self._offline_thread = threading.Thread(
                target=self._offline_server.serve_forever, daemon=True
            )
            self._offline_thread.start()

    async def list_offline_collections(self, directory: str = ""):
        destination = upload_destination(directory)
        try:
            ensure_upload_directory(destination)
            return self._offline.list(str(destination))
        except OSError as error:
            raise ValueError("无法读取离线网页目录，请检查存储设备") from error

    async def open_offline_collection(self, token: str):
        self._start_offline()
        return {"url": self._offline_server.authorize(token)}

    async def delete_offline_collection(self, token: str):
        return self._offline.delete(token)

    async def plan_storage_migration(self, old: str, new: str):
        return await asyncio.to_thread(plan_migration, old, new)

    async def start_storage_migration(self, old: str, new: str):
        plan = await asyncio.to_thread(plan_migration, old, new)
        if plan["total"] == 0:
            return {"started": False, "plan": plan, "status": None}
        with self._storage_migration_lock:
            if self._storage_migration is not None and self._storage_migration.snapshot()["status"] == "running":
                raise ValueError("已有迁移任务正在进行，请先等待或取消")
            job = await asyncio.to_thread(StorageMigration, old, new)
            job.start()
            self._storage_migration = job
        return {"started": True, "plan": plan, "status": job.snapshot()}

    async def get_storage_migration_status(self):
        job = self._storage_migration
        return job.snapshot() if job is not None else None

    async def cancel_storage_migration(self):
        job = self._storage_migration
        if job is None:
            return None
        job.cancel()
        return job.snapshot()

    async def save_offline_page(self, url: str, title: str = "", directory: str = ""):
        source = normalize_url(url)
        if (
            self._offline_save is not None
            and self._offline_save.snapshot()["status"] == "running"
        ):
            raise ValueError("已有离线保存任务正在进行，请等待完成或取消")
        destination = upload_destination(directory)
        try:
            ensure_upload_directory(destination)
        except OSError as error:
            raise ValueError("保存位置无法使用，请检查存储设备") from error
        clean_title = title.strip()[:300] if isinstance(title, str) else ""
        job = SaveJob(PageCapture(self._offline, str(destination)), source, clean_title)
        self._offline_save = job
        self._offline_save_task = asyncio.create_task(job.run())
        return {"started": True, "status": job.snapshot()}

    async def get_offline_save_status(self):
        job = self._offline_save
        return job.snapshot() if job is not None else None

    async def cancel_offline_save(self):
        job = self._offline_save
        if job is None:
            return None
        job.cancel()
        return job.snapshot()

    def _start_local_app(self):
        if self._local_app_server is None:
            self._local_app_server = LocalAppServer()
            self._local_app_thread = threading.Thread(
                target=self._local_app_server.serve_forever, daemon=True
            )
            self._local_app_thread.start()

    async def validate_local_app(self, directory: str):
        return await asyncio.to_thread(validate_app, directory)

    async def open_local_app(self, directory: str, entry: str = "index.html"):
        info = await asyncio.to_thread(validate_app, directory)
        self._start_local_app()
        url = self._local_app_server.authorize(info["directory"], entry)
        return {"url": url, "directory": info["directory"], "entries": info["entries"]}

    async def _unload(self):
        if self._storage_migration is not None:
            self._storage_migration.cancel()
        if self._offline_save is not None:
            self._offline_save.cancel()
        if self._offline_save_task is not None:
            self._offline_save_task.cancel()
            try:
                await self._offline_save_task
            except (asyncio.CancelledError, Exception):
                pass
            self._offline_save_task = None
        await self._web_scroller.close()
        async with self._phone_lock:
            if self._phone is not None:
                await asyncio.to_thread(self._phone.close)
                self._phone = None
        if self._server is not None:
            self._server.stop_readers()
            await asyncio.to_thread(self._server.shutdown)
            self._server.server_close()
            await asyncio.to_thread(self._thread.join, 2)
            self._server = None
            self._thread = None
        if self._offline_server is not None:
            await asyncio.to_thread(self._offline_server.shutdown)
            self._offline_server.server_close()
            await asyncio.to_thread(self._offline_thread.join, 2)
            self._offline_server = None
            self._offline_thread = None
        if self._local_app_server is not None:
            await asyncio.to_thread(self._local_app_server.shutdown)
            self._local_app_server.server_close()
            await asyncio.to_thread(self._local_app_thread.join, 2)
            self._local_app_server = None
            self._local_app_thread = None

    async def get_web_page_state(self, url: str, title: str = ""):
        return await self._web_scroller.page_state(url, title)

    async def scroll_web_page(self, url: str, x: float, y: float, width: float, height: float, title: str = ""):
        await self._web_scroller.scroll(url, x, y, width, height, title)

    async def release_web_scroll(self):
        await self._web_scroller.close()

    async def zoom_web_page(self, url: str, action: str, title: str = ""):
        return await self._web_scroller.zoom(url, action, title)

    async def send_web_space(self, url: str, title: str = ""):
        await self._web_scroller.space(url, title)

    async def toggle_web_fullscreen(self, url: str, title: str = ""):
        await self._web_scroller.fullscreen(url, title)

    async def zoom_reader(self, path: str, action: str):
        if action not in ("smaller", "default", "larger"):
            raise ValueError("Invalid zoom action")
        selected = Path(path).resolve()
        if self._server is None:
            raise ValueError("Reader is not open")
        with self._server.grants_lock:
            if selected not in self._server.grants.values() or selected.suffix.lower() not in IMAGE_EXTENSIONS:
                raise ValueError("Image has not been selected")
        self._server.broadcast(selected, {"zoom": action})

    async def set_reader_motion(self, path: str, x: float, y: float):
        if self._server is None:
            return
        if not all(isinstance(value, (float, int)) and math.isfinite(value) and
                   -1 <= value <= 1 for value in (x, y)):
            raise ValueError("Invalid stick velocity")
        selected = Path(path).resolve()
        with self._server.grants_lock:
            if selected not in self._server.grants.values():
                raise ValueError("File has not been selected")
        self._server.motion(selected, x, y)

    async def start_url_input(self, directory: str = ""):
        async with self._phone_lock:
            if self._phone is not None:
                await asyncio.to_thread(self._phone.close)
                self._phone = None
            try:
                destination = upload_destination(directory)
                self._phone = PhoneInputSession(lan_address(), upload_directory=destination)
            except OSError as error:
                raise ValueError("无法打开扫码输入，请检查网络后重试") from error
            picker_directory = destination
            while not picker_directory.is_dir():
                picker_directory = picker_directory.parent
            return {"session_id": self._phone.session_id, "url": self._phone.url, "expires_in": 300,
                    "upload_directory": str(destination), "upload_picker_directory": str(picker_directory)}

    async def get_url_input_status(self, session_id: str):
        session = self._phone
        if session is None or session.session_id != session_id:
            return {"status": "expired"}
        status = session.status()
        if status["status"] in {"received", "expired"}:
            await asyncio.to_thread(session.close)
        return status

    async def cancel_url_input(self, session_id: str):
        async with self._phone_lock:
            if self._phone is not None and self._phone.session_id == session_id:
                await asyncio.to_thread(self._phone.close)
                self._phone = None
