"""Serve a user-selected static web app, such as an offline map atlas.

Unlike the saved offline collections this content is user-provided and may run
its own scripts, so the policy allows same-origin scripts and styles while
still blocking all network access. The directory is never copied; the app is
read in place from the SD card or internal storage.
"""

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import mimetypes
import os
from pathlib import Path
import secrets
import shutil
import socketserver
import threading
from urllib.parse import unquote, urlsplit


APP_POLICY = (
    "default-src 'none'; "
    "script-src 'self'; "
    "style-src 'self' 'unsafe-inline'; "
    "img-src 'self' data:; "
    "media-src 'self'; "
    "font-src 'self' data:; "
    "connect-src 'none'; "
    "worker-src 'none'; "
    "frame-src 'none'; "
    "object-src 'none'; "
    "base-uri 'none'; "
    "form-action 'none'"
)
KNOWN_ENTRIES = ("index.html", "world.html", "items.html")
TOUCH_SCRIPT_ROUTE = "__portal_touch.js"
TOUCH_SCRIPT_ASSET = "local-app-touch.js"
TOUCH_INJECTION_VERSION = "pt1"
MAX_GRANTS = 32


def _storage_roots():
    home = Path(os.environ.get("DECKY_USER_HOME", "/home/deck")).resolve()
    return home, Path("/run/media")


def _resolve_app(directory):
    if not isinstance(directory, str) or not directory:
        raise ValueError("请选择地图册文件夹")
    path = Path(directory)
    if not path.is_absolute():
        raise ValueError("请选择地图册文件夹")
    try:
        path = path.resolve(strict=True)
    except OSError as error:
        raise ValueError("地图册文件夹不可用，请检查 SD 卡是否插好") from error
    if not path.is_dir():
        raise ValueError("请选择解压后的地图册文件夹")
    home, media = _storage_roots()
    if not (path.is_relative_to(home) or path.is_relative_to(media)):
        raise ValueError("只能选择 SD 卡或内置存储中的地图册")
    if (path / "index.html").is_file():
        return path
    children = [
        child
        for child in path.iterdir()
        if child.is_dir() and not child.is_symlink() and (child / "index.html").is_file()
    ]
    if len(children) == 1:
        return children[0].resolve()
    raise ValueError("这个文件夹里没有 index.html，请选择解压后的地图册目录")


def list_entries(root):
    return [name for name in KNOWN_ENTRIES if (root / name).is_file()]


def validate_app(directory):
    root = _resolve_app(directory)
    entries = list_entries(root)
    if not entries:
        raise ValueError("地图册缺少可打开的页面")
    return {"directory": str(root), "entries": entries}


class LocalAppServer(ThreadingHTTPServer):
    daemon_threads = True

    def server_bind(self):
        socketserver.TCPServer.server_bind(self)
        host, port = self.server_address[:2]
        self.server_name = host
        self.server_port = port

    def __init__(self):
        self._lock = threading.Lock()
        self._grants = {}
        self._tokens = {}
        try:
            super().__init__(("127.0.0.1", 8137), LocalAppHandler)
        except OSError:
            super().__init__(("127.0.0.1", 0), LocalAppHandler)

    @property
    def origin(self):
        return f"http://127.0.0.1:{self.server_port}"

    def validate(self, directory):
        return validate_app(directory)

    def authorize(self, directory, entry="index.html"):
        root = _resolve_app(directory)
        entries = list_entries(root)
        if entry not in entries:
            raise ValueError("地图册中没有这个页面")
        with self._lock:
            token = self._tokens.get(root)
            if token is None:
                token = secrets.token_urlsafe(32)
                info = root.stat()
                self._tokens[root] = token
                self._grants[token] = (root, (info.st_dev, info.st_ino))
                while len(self._tokens) > MAX_GRANTS:
                    oldest = next(iter(self._tokens))
                    self._grants.pop(self._tokens.pop(oldest), None)
        return f"{self.origin}/app/{token}/{entry}"

    def granted(self, token):
        with self._lock:
            granted = self._grants.get(token)
        if granted is None:
            return None
        root, identity = granted
        try:
            info = root.stat()
        except OSError:
            return None
        if not root.is_dir() or (info.st_dev, info.st_ino) != identity:
            return None
        return root


class LocalAppHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "PortalLocalApp/1.0"

    def log_message(self, *_args):
        pass

    def do_HEAD(self):
        self._respond(head=True)

    def do_GET(self):
        self._respond(head=False)

    def _respond(self, head):
        if self.headers.get("Host") != self.server.origin.removeprefix("http://"):
            self.send_error(403)
            return
        if urlsplit(self.path).path == "/favicon.ico":
            self.send_response(204)
            self.end_headers()
            return
        parts = urlsplit(self.path).path.split("/")
        if len(parts) < 4 or parts[0] != "" or parts[1] != "app":
            self.send_error(404)
            return
        token = unquote(parts[2])
        root = self.server.granted(token)
        if root is None:
            self.send_error(404)
            return
        relative = [unquote(part) for part in parts[3:] if part]
        if any(
            part in {".", ".."} or "\\" in part or "\x00" in part or ":" in part
            for part in relative
        ):
            self.send_error(404)
            return
        if not relative or urlsplit(self.path).path.endswith("/"):
            relative.append("index.html")
        if relative == [TOUCH_SCRIPT_ROUTE]:
            self._serve_touch_script(head)
            return
        try:
            target = root.joinpath(*relative).resolve(strict=True)
        except (OSError, RuntimeError):
            self.send_error(404)
            return
        if not target.is_relative_to(root) or not target.is_file():
            self.send_error(404)
            return
        try:
            info = target.stat()
            source = target.open("rb")
        except OSError:
            self.send_error(404)
            return
        content_type = self._content_type(target)
        payload = None
        length = info.st_size
        etag = f'"{info.st_size:x}-{info.st_mtime_ns:x}"'
        if target.suffix.lower() in {".html", ".htm"}:
            try:
                text = source.read().decode("utf-8")
            except UnicodeDecodeError:
                source.seek(0)
            except OSError:
                source.close()
                self.send_error(404)
                return
            else:
                tag = f'<script src="/app/{token}/{TOUCH_SCRIPT_ROUTE}"></script>'
                if TOUCH_SCRIPT_ROUTE not in text:
                    if "</body>" in text:
                        text = text.replace("</body>", tag + "\n</body>", 1)
                    else:
                        text += tag
                payload = text.encode("utf-8")
                source.close()
                source = None
                length = len(payload)
                etag = f'"{length:x}-touch{TOUCH_INJECTION_VERSION}"'
        if self.headers.get("If-None-Match") == etag:
            self.send_response(304)
            self.send_header("ETag", etag)
            self.send_header("Cache-Control", "private, max-age=0, must-revalidate")
            self.send_header("Content-Security-Policy", APP_POLICY)
            self.end_headers()
            if source is not None:
                source.close()
            self.close_connection = True
            return
        try:
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(length))
            self.send_header("ETag", etag)
            self.send_header("Cache-Control", "private, max-age=0, must-revalidate")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("Content-Security-Policy", APP_POLICY)
            self.end_headers()
            if not head:
                try:
                    if payload is not None:
                        self.wfile.write(payload)
                    elif source is not None:
                        shutil.copyfileobj(source, self.wfile, length=1024 * 1024)
                except (BrokenPipeError, ConnectionResetError):
                    pass
        finally:
            if source is not None:
                source.close()

    def _serve_touch_script(self, head):
        path = Path(__file__).with_name("assets").joinpath(TOUCH_SCRIPT_ASSET)
        try:
            info = path.stat()
            source = path.open("rb")
        except OSError:
            self.send_error(404)
            return
        etag = f'"{info.st_size:x}-{info.st_mtime_ns:x}"'
        if self.headers.get("If-None-Match") == etag:
            self.send_response(304)
            self.send_header("ETag", etag)
            self.send_header("Cache-Control", "private, max-age=0, must-revalidate")
            self.send_header("Content-Security-Policy", APP_POLICY)
            self.end_headers()
            source.close()
            self.close_connection = True
            return
        try:
            self.send_response(200)
            self.send_header("Content-Type", "application/javascript; charset=utf-8")
            self.send_header("Content-Length", str(info.st_size))
            self.send_header("ETag", etag)
            self.send_header("Cache-Control", "private, max-age=0, must-revalidate")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("Content-Security-Policy", APP_POLICY)
            self.end_headers()
            if not head:
                try:
                    shutil.copyfileobj(source, self.wfile, length=1024 * 1024)
                except (BrokenPipeError, ConnectionResetError):
                    pass
        finally:
            source.close()

    @staticmethod
    def _content_type(path):
        suffix = path.suffix.lower()
        if suffix in {".html", ".htm"}:
            return "text/html; charset=utf-8"
        if suffix == ".js":
            return "application/javascript; charset=utf-8"
        if suffix == ".css":
            return "text/css; charset=utf-8"
        if suffix == ".json":
            return "application/json; charset=utf-8"
        if suffix == ".svg":
            return "image/svg+xml"
        return mimetypes.guess_type(path.name)[0] or "application/octet-stream"
