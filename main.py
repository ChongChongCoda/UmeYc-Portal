"""Preview explicitly selected local files in Steam's browser, on loopback only."""

import asyncio
from collections import OrderedDict
import html
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import mimetypes
import os
from pathlib import Path
import secrets
import shutil
import threading
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
        super().__init__(("127.0.0.1", 0), PreviewHandler)

    def authorize(self, path):
        token = secrets.token_urlsafe(32)
        with self.grants_lock:
            self.grants[token] = path
            while len(self.grants) > 64:
                self.grants.popitem(last=False)
        route = "viewer" if path.suffix.lower() in IMAGE_EXTENSIONS else "file"
        return f"http://127.0.0.1:{self.server_port}/{route}/{token}"


class PreviewHandler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        # File names and bearer tokens must not end up in the access log.
        pass

    def do_HEAD(self):
        self._respond(head=True)

    def do_GET(self):
        self._respond(head=False)

    def _respond(self, head):
        if self.headers.get("Host") != f"127.0.0.1:{self.server.server_port}":
            self.send_error(403)
            return
        parts = urlsplit(self.path).path.split("/")
        if len(parts) != 3 or parts[1] not in {"viewer", "file"}:
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
                template = Path(__file__).with_name("assets").joinpath("image-viewer.html")
                content = template.read_text(encoding="utf-8").replace(
                    "{{TITLE}}", html.escape(path.name)
                ).replace("{{IMAGE_URL}}", f"/file/{token}").encode("utf-8")
                self._headers("text/html; charset=utf-8", len(content))
                if not head:
                    self.wfile.write(content)
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
            self.send_header("Content-Security-Policy", "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'")
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
            await asyncio.to_thread(self._server.shutdown)
            self._server.server_close()
            await asyncio.to_thread(self._thread.join, 2)
            self._server = None
            self._thread = None
