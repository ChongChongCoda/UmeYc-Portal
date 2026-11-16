"""Send native wheel events only to the uniquely matched Portal browser page."""

import asyncio
import math
from urllib.parse import urlsplit


class WebScroller:
    def __init__(self):
        self._lock = asyncio.Lock()
        self._client = None
        self._socket = None
        self._url = None
        self._sequence = 0

    async def _disconnect(self):
        if self._socket is not None:
            await self._socket.close()
        if self._client is not None:
            await self._client.close()
        self._socket = self._client = self._url = None

    async def close(self):
        async with self._lock:
            await self._disconnect()

    async def _connect(self, url):
        # aiohttp is shipped by Decky itself; no additional plugin dependency.
        from aiohttp import ClientSession, ClientTimeout

        self._client = ClientSession(timeout=ClientTimeout(total=2))
        async with self._client.get("http://127.0.0.1:8080/json") as response:
            response.raise_for_status()
            pages = await response.json()
        matches = [page for page in pages if page.get("url") == url and page.get("type") == "page"]
        if len(matches) != 1:
            raise ValueError("无法唯一识别 Portal 网页，请重新打开网址后重试")
        endpoint = urlsplit(matches[0]["webSocketDebuggerUrl"])
        if endpoint.scheme != "ws" or endpoint.hostname not in {"127.0.0.1", "localhost"} or endpoint.port != 8080:
            raise ValueError("Invalid browser debugger endpoint")
        self._socket = await self._client.ws_connect(matches[0]["webSocketDebuggerUrl"])
        self._url = url

    async def scroll(self, url, x, y, width, height):
        self._validate_url(url)
        if not all(isinstance(n, (int, float)) and math.isfinite(n) and -1 <= n <= 1 for n in (x, y)):
            raise ValueError("Invalid stick velocity")
        if not all(isinstance(n, (int, float)) and math.isfinite(n) and 1 <= n <= 8192 for n in (width, height)):
            raise ValueError("Invalid page bounds")
        if not x and not y:
            return
        await self._run(self._dispatch(url, x, y, width, height))

    @staticmethod
    def _validate_url(url):
        if not isinstance(url, str) or len(url) > 8192:
            raise ValueError("Invalid page URL")
        address = urlsplit(url)
        if address.scheme not in {"http", "https"} or not address.hostname or address.hostname == "steamloopback.host":
            raise ValueError("Only a web page can be scrolled")

    async def space(self, url):
        self._validate_url(url)
        await self._run(self._space(url))

    async def _run(self, operation):
        async with self._lock:
            try:
                await asyncio.wait_for(operation, timeout=2)
            except BaseException:
                await self._disconnect()
                raise

    async def _dispatch(self, url, x, y, width, height):
        await self._ensure_page(url)
        await self._request("Input.dispatchMouseEvent", {
            "type": "mouseWheel", "x": width / 2, "y": height / 2,
            "deltaX": x * 96, "deltaY": y * 96, "modifiers": 0,
        })

    async def _space(self, url):
        await self._ensure_page(url)
        key = {"key": " ", "code": "Space", "windowsVirtualKeyCode": 32, "nativeVirtualKeyCode": 32}
        try:
            await self._request("Input.dispatchKeyEvent", {"type": "keyDown", **key})
        finally:
            await self._request("Input.dispatchKeyEvent", {"type": "keyUp", **key})

    async def _ensure_page(self, url):
        if self._url != url or self._socket is None or self._socket.closed:
            await self._disconnect()
            await self._connect(url)
    async def _request(self, method, params):
        self._sequence += 1
        await self._socket.send_json({
            "id": self._sequence,
            "method": method,
            "params": params,
        })
        while True:
            result = await self._socket.receive_json()
            if result.get("id") == self._sequence:
                if "error" in result:
                    raise RuntimeError("Browser input event was rejected")
                break
