"""Short-lived, token-protected LAN form for entering a Portal URL by QR code."""

import html
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import ipaddress
from pathlib import Path
import re
import secrets
import socket
import threading
import time
from urllib.parse import parse_qs, urlsplit


def lan_address():
    # UDP connect selects a local route without sending a packet or using a cloud service.
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as connection:
            connection.connect(("192.0.2.1", 9))
            address = connection.getsockname()[0]
        ip = ipaddress.ip_address(address)
        if ip.is_loopback or ip.is_unspecified or not ip.is_private:
            raise ValueError()
        return address
    except (OSError, ValueError) as error:
        raise ValueError("未找到局域网地址，请让 Deck 和扫码设备连接同一 Wi-Fi 后重试") from error


def normalize_url(value):
    if not isinstance(value, str):
        raise ValueError("请输入网页或图片网址")
    value = value.strip()
    if not value or len(value) > 4096 or any(c.isspace() or ord(c) < 32 for c in value) or "\\" in value:
        raise ValueError("请输入有效网址，网址中不能包含空格")
    if not re.match(r"^[a-zA-Z][a-zA-Z0-9+.-]*:", value):
        value = "https://" + value
    try:
        parsed = urlsplit(value)
        if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password:
            raise ValueError()
        parsed.port  # Validate a supplied port, including invalid text or out-of-range values.
    except ValueError as error:
        raise ValueError("仅支持 http:// 或 https:// 网页和图片网址") from error
    return value


class PhoneInputSession:
    def __init__(self, address, timeout=300):
        self.session_id = secrets.token_urlsafe(32)
        self.expires_at = time.monotonic() + timeout
        self._url = None
        self._closed = False
        self._lock = threading.Lock()
        self._close_lock = threading.Lock()
        self._server = ThreadingHTTPServer((address, 0), PhoneInputHandler)
        self._server.daemon_threads = True
        self._server.session = self
        self.origin = f"http://{address}:{self._server.server_port}"
        self.url = f"{self.origin}/{self.session_id}"
        self._thread = threading.Thread(
            target=lambda: self._server.serve_forever(poll_interval=0.1), daemon=True
        )
        self._timer = threading.Timer(timeout, self.close)
        self._timer.daemon = True
        self._thread.start()
        self._timer.start()

    def status(self):
        with self._lock:
            if self._url is not None:
                return {"status": "received", "url": self._url}
            if self._closed or time.monotonic() >= self.expires_at:
                return {"status": "expired"}
            return {"status": "waiting"}

    def submit(self, value):
        value = normalize_url(value)
        with self._lock:
            if self._closed or time.monotonic() >= self.expires_at:
                raise TimeoutError()
            if self._url is not None:
                raise FileExistsError()
            self._url = value

    def close(self):
        with self._close_lock:
            if self._closed:
                return
            self._closed = True
            self._timer.cancel()
            self._server.shutdown()
            self._server.server_close()
            self._thread.join(timeout=2)


class PhoneInputHandler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        # Neither the one-time token nor the submitted address belongs in logs.
        pass

    def _authorized(self):
        session = self.server.session
        if self.headers.get("Host") != session.origin.removeprefix("http://"):
            self.send_error(403)
            return False
        if urlsplit(self.path).path != "/" + session.session_id:
            self.send_error(404)
            return False
        return True

    def _page(self, message="", done=False, status=200):
        template = Path(__file__).with_name("assets").joinpath("phone-input.html")
        content = template.read_text(encoding="utf-8").replace(
            "{{MESSAGE}}", html.escape(message)
        ).replace("{{FORM_DISPLAY}}", "none" if done else "block").encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Cache-Control", "no-store")
        # no-referrer can turn a browser form POST's Origin into "null". Keep
        # same-origin form submissions identifiable without leaking the token
        # to other sites.
        self.send_header("Referrer-Policy", "same-origin")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'")
        self.end_headers()
        self.wfile.write(content)

    def do_GET(self):
        if not self._authorized():
            return
        status = self.server.session.status()["status"]
        if status == "expired":
            self._page("二维码已过期，请在 Deck 上重新打开扫码输入。", done=True, status=410)
        elif status == "received":
            self._page("网址已发送，请回到 Deck 查看。", done=True)
        else:
            self._page()

    def do_POST(self):
        if not self._authorized():
            return
        session = self.server.session
        if self.headers.get("Origin") not in {None, session.origin}:
            self.send_error(403)
            return
        if self.headers.get("Content-Type", "").split(";", 1)[0] != "application/x-www-form-urlencoded":
            self.send_error(415)
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 32768:
                raise ValueError("网址太长，请重新输入")
            fields = parse_qs(self.rfile.read(length).decode("utf-8"), max_num_fields=4)
            values = fields.get("url", [])
            if len(values) != 1:
                raise ValueError("请输入一个网址")
            session.submit(values[0])
        except (ValueError, UnicodeError) as error:
            self._page(str(error), status=400)
        except TimeoutError:
            self._page("二维码已过期，请在 Deck 上重新打开扫码输入。", done=True, status=410)
        except FileExistsError:
            self._page("此二维码已使用，请在 Deck 上重新打开扫码输入。", done=True, status=409)
        else:
            self._page("网址已发送，请回到 Deck 查看。", done=True)
