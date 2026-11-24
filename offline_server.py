"""Loopback, read-only server for saved offline web collections.

The server only serves directories that were granted through the offline
library, refuses path traversal and symlink escapes, and loads pages with a
policy that forbids scripts and network access.
"""

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import mimetypes
import shutil
from urllib.parse import unquote, urlsplit


PAGE_POLICY = (
    "default-src 'none'; "
    "img-src 'self' data: blob:; "
    "media-src 'self'; "
    "style-src 'self' 'unsafe-inline'; "
    "font-src 'self' data:; "
    "script-src 'none'; "
    "connect-src 'none'; "
    "frame-src 'none'; "
    "form-action 'none'; "
    "base-uri 'none'"
)


class OfflineServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, library):
        self.library = library
        super().__init__(("127.0.0.1", 0), OfflineHandler)

    @property
    def origin(self):
        return f"http://127.0.0.1:{self.server_port}"

    def authorize(self, token):
        self.library.authorize(token)
        return f"{self.origin}/{token}/index.html"


class OfflineHandler(BaseHTTPRequestHandler):
    server_version = "PortalOffline/1.0"

    def log_message(self, *_args):
        # Tokens and page names must not end up in the access log.
        pass

    def do_HEAD(self):
        self._respond(head=True)

    def do_GET(self):
        self._respond(head=False)

    def _respond(self, head):
        if self.headers.get("Host") != self.server.origin.removeprefix("http://"):
            self.send_error(403)
            return
        parts = urlsplit(self.path).path.split("/")
        if len(parts) < 3 or parts[0] != "":
            self.send_error(404)
            return
        token = unquote(parts[1])
        try:
            root = self.server.library.authorize(token)
        except ValueError:
            self.send_error(404)
            return
        relative = [unquote(part) for part in parts[2:] if part]
        if any(
            part in {".", ".."} or "\\" in part or "\x00" in part or ":" in part
            for part in relative
        ):
            self.send_error(404)
            return
        if not relative or urlsplit(self.path).path.endswith("/"):
            relative.append("index.html")
        try:
            target = root.joinpath(*relative).resolve(strict=True)
        except (OSError, RuntimeError):
            self.send_error(404)
            return
        if not target.is_relative_to(root) or not target.is_file():
            self.send_error(404)
            return
        try:
            size = target.stat().st_size
            source = target.open("rb")
        except OSError:
            self.send_error(404)
            return
        with source:
            content_type = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
            if content_type.startswith("text/") or content_type in {
                "application/javascript",
                "application/json",
                "application/manifest+json",
            }:
                content_type += "; charset=utf-8"
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(size))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("Content-Security-Policy", PAGE_POLICY)
            self.end_headers()
            if not head:
                try:
                    shutil.copyfileobj(source, self.wfile)
                except (BrokenPipeError, ConnectionResetError):
                    pass
