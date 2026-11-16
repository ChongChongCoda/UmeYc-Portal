"""Preview explicitly selected local files in Steam's browser, on loopback only."""

import asyncio
from collections import OrderedDict
import html
import json
import math
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import mimetypes
import os
from pathlib import Path
import secrets
import shutil
import threading
import queue
from urllib.parse import urlsplit


SUPPORTED_EXTENSIONS = {
    ".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".svg", ".avif", ".ico",
    ".pdf", ".html", ".htm", ".txt", ".md",
}
IMAGE_EXTENSIONS = SUPPORTED_EXTENSIONS - {".pdf", ".html", ".htm", ".txt", ".md"}


class PreviewServer(ThreadingHTTPServer):
    daemon_threads = True

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
        payload = json.dumps({"x": x, "y": y})
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
                ).encode("utf-8")
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

    async def _unload(self):
        if self._server is not None:
            self._server.stop_readers()
            await asyncio.to_thread(self._server.shutdown)
            self._server.server_close()
            await asyncio.to_thread(self._thread.join, 2)
            self._server = None
            self._thread = None

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
