"""Short-lived, token-protected LAN form for entering a Portal URL by QR code."""

import html
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import ipaddress
from pathlib import Path
import re
import secrets
import socket
import socketserver
import threading
import time
from urllib.parse import parse_qs, urlsplit

from image_upload import MAX_IMAGE_BYTES, save_image


class PhoneInputServer(ThreadingHTTPServer):
    daemon_threads = True

    def server_bind(self):
        # Binding to the LAN address makes HTTPServer perform a reverse-DNS
        # lookup, which can block for a long time on VPN/hotspot networks.
        socketserver.TCPServer.server_bind(self)
        host, port = self.server_address[:2]
        self.server_name = host
        self.server_port = port


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
    def __init__(self, address, timeout=300, upload_directory=None):
        self.session_id = secrets.token_urlsafe(32)
        self.expires_at = time.monotonic() + timeout
        self._url = None
        self.upload_directory = upload_directory
        self._receiving = False
        self._closed = False
        self._lock = threading.Lock()
        self._close_lock = threading.Lock()
        self._server = PhoneInputServer((address, 0), PhoneInputHandler)
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
            return {"status": "uploading" if self._receiving else "waiting"}

    def submit(self, value):
        value = normalize_url(value)
        with self._lock:
            if self._closed or time.monotonic() >= self.expires_at:
                raise TimeoutError()
            if self._url is not None or self._receiving:
                raise FileExistsError()
            self._url = value

    def upload(self, filename, stream, length):
        with self._lock:
            self._check_active()
            if self._url is not None or self._receiving:
                raise FileExistsError()
            self._receiving = True
        target = None
        try:
            if self.upload_directory is None:
                raise ValueError("请在 Deck 上选择图片保存位置")
            target = save_image(self.upload_directory, filename, stream, length, self._check_active)
            with self._lock:
                self._check_active()
                self._url = target.as_uri()
        except BaseException:
            if target is not None:
                target.unlink(missing_ok=True)
            raise
        finally:
            with self._lock:
                self._receiving = False

    def _check_active(self):
        if self._closed or time.monotonic() >= self.expires_at:
            raise TimeoutError()

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

    def _authorized(self, script=False):
        session = self.server.session
        if self.headers.get("Host") != session.origin.removeprefix("http://"):
            self.send_error(403)
            return False
        expected = "/" + session.session_id + ("/upload.js" if script else "")
        if urlsplit(self.path).path != expected:
            self.send_error(404)
            return False
        return True

    def _page(self, message="", done=False, status=200):
        template = Path(__file__).with_name("assets").joinpath("phone-input.html")
        content = template.read_text(encoding="utf-8").replace(
            "{{MESSAGE}}", html.escape(message)
        ).replace("{{FORM_DISPLAY}}", "none" if done else "block").replace(
            "{{UPLOAD_SCRIPT}}", f"/{self.server.session.session_id}/upload.js"
        ).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Cache-Control", "no-store")
        # no-referrer can turn a browser form POST's Origin into "null". Keep
        # same-origin form submissions identifiable without leaking the token
        # to other sites.
        self.send_header("Referrer-Policy", "same-origin")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; script-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'")
        self.end_headers()
        self.wfile.write(content)

    def do_GET(self):
        script = urlsplit(self.path).path.endswith("/upload.js")
        if not self._authorized(script=script):
            return
        status = self.server.session.status()["status"]
        if script:
            if status == "expired":
                self.send_error(410)
                return
            data = Path(__file__).with_name("assets").joinpath("phone-input.js").read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "text/javascript; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            self.wfile.write(data)
            return
        if status == "expired":
            self._page("二维码已过期，请在 Deck 上重新打开扫码输入。", done=True, status=410)
        elif status == "received":
            self._page("内容已发送，请回到 Deck 查看。", done=True)
        else:
            self._page()

    def do_POST(self):
        if not self._authorized():
            return
        session = self.server.session
        if self.headers.get("Origin") not in {None, session.origin}:
            self.send_error(403)
            return
        try:
            query = parse_qs(urlsplit(self.path).query, max_num_fields=4)
        except ValueError:
            self.send_error(400)
            return
        if query.get("upload") == ["1"]:
            self._upload(query)
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

    def _upload(self, query):
        try:
            names = query.get("filename", [])
            if len(names) != 1:
                raise ValueError("请选择一张图片")
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= MAX_IMAGE_BYTES:
                raise ValueError("请选择不超过 64 MB 的图片")
            self.connection.settimeout(20)
            self.server.session.upload(names[0], self.rfile, length)
        except TimeoutError:
            self._json("上传超时或二维码已过期，请重新扫码上传。", 410)
        except FileExistsError:
            self._json("此二维码正在接收或已使用，请在 Deck 上重新打开扫码传送。", 409)
        except (ValueError, UnicodeError) as error:
            self._json(str(error), 400)
        except OSError:
            self._json("图片未能保存，请检查保存位置和剩余空间后重试。", 400)
        else:
            self._json("图片已上传，请回到 Deck 查看。", 200)

    def _json(self, message, status):
        data = json.dumps({"message": message}, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(data)
