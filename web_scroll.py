"""Send native wheel events only to the uniquely matched Portal browser page."""

import asyncio
import math
import json
from pathlib import Path
from urllib.parse import urlsplit


class WebScroller:
    def __init__(self):
        self._lock = asyncio.Lock()
        self._client = None
        self._socket = None
        self._url = None
        self._title = ""
        self._sequence = 0

    async def _disconnect(self):
        if self._socket is not None:
            await self._socket.close()
        if self._client is not None:
            await self._client.close()
        self._socket = self._client = self._url = None
        self._title = ""

    async def close(self):
        async with self._lock:
            await self._disconnect()

    async def _pages(self):
        # aiohttp is shipped by Decky itself; no additional plugin dependency.
        from aiohttp import ClientSession, ClientTimeout

        async with ClientSession(timeout=ClientTimeout(total=2)) as client:
            async with client.get("http://127.0.0.1:8080/json") as response:
                response.raise_for_status()
                return await response.json()

    async def page_state(self, url, title=""):
        self._validate_url(url)
        matches = self._matching_pages(await self._pages(), url, title)
        if len(matches) != 1:
            raise ValueError("无法唯一识别 Portal 网页，请重新打开网址后重试")
        return await self._run(self._page_state(url, title))

    async def _page_state(self, url, title):
        await self._ensure_page(url, title)
        # Bilibili's SPA can update the episode heading but leave document.title
        # on the previous episode. Read the visible video title in that case.
        expression = """(() => {
          const heading = location.hostname === 'www.bilibili.com' &&
            /^\\/video\\//.test(location.pathname) && document.querySelector('h1.video-title');
          return {url: location.href, title: (heading && (heading.getAttribute('title') ||
            heading.textContent) || document.title).trim()};
        })()"""
        result = await self._request("Runtime.evaluate", {"expression": expression, "returnByValue": True})
        value = result.get("result", {}).get("value")
        if "exceptionDetails" in result or not isinstance(value, dict) or not isinstance(value.get("title"), str):
            raise RuntimeError("无法读取当前网页")
        self._validate_url(value.get("url"))
        return {"url": value["url"], "title": value["title"]}

    async def _connect(self, url, title=""):
        from aiohttp import ClientSession, ClientTimeout

        matches = self._matching_pages(await self._pages(), url, title)
        if len(matches) != 1:
            raise ValueError("无法唯一识别 Portal 网页，请重新打开网址后重试")
        endpoint = urlsplit(matches[0]["webSocketDebuggerUrl"])
        if endpoint.scheme != "ws" or endpoint.hostname not in {"127.0.0.1", "localhost"} or endpoint.port != 8080:
            raise ValueError("Invalid browser debugger endpoint")
        self._client = ClientSession(timeout=ClientTimeout(total=2))
        self._socket = await self._client.ws_connect(matches[0]["webSocketDebuggerUrl"])
        self._url = url
        self._title = title

    @staticmethod
    def _matching_pages(pages, url, title=""):
        pages = [page for page in pages if page.get("type") == "page"]
        # Steam's native URL can remain on the previous episode after pushState.
        # The current native title still updates. Never guess across origins or
        # choose between two pages with the same title.
        if title:
            origin = urlsplit(url)
            return [page for page in pages if page.get("title") == title and
                    (urlsplit(page.get("url", "")).scheme, urlsplit(page.get("url", "")).netloc)
                    == (origin.scheme, origin.netloc)]
        matches = [page for page in pages if page.get("url") == url]
        if matches:
            return matches
        # pushState/replaceState can change query parameters without notifying
        # Steam's BrowserView. Only accept a unique page at the same origin/path.
        target = urlsplit(url)
        def route(address):
            parsed = urlsplit(address)
            return parsed.scheme, parsed.netloc, parsed.path
        return [page for page in pages if page.get("type") == "page" and
                route(page.get("url", "")) == route(target.geturl())]

    async def scroll(self, url, x, y, width, height, title=""):
        self._validate_url(url)
        if not all(isinstance(n, (int, float)) and math.isfinite(n) and -1 <= n <= 1 for n in (x, y)):
            raise ValueError("Invalid stick velocity")
        if not all(isinstance(n, (int, float)) and math.isfinite(n) and 1 <= n <= 8192 for n in (width, height)):
            raise ValueError("Invalid page bounds")
        if not x and not y:
            return
        await self._run(self._dispatch(url, x, y, width, height, title))

    @staticmethod
    def _validate_url(url):
        if not isinstance(url, str) or len(url) > 8192:
            raise ValueError("Invalid page URL")
        address = urlsplit(url)
        if address.scheme not in {"http", "https"} or not address.hostname or address.hostname == "steamloopback.host":
            raise ValueError("Only a web page can be scrolled")

    async def zoom(self, url, action, title=""):
        self._validate_url(url)
        if action not in {"smaller", "default", "larger"}:
            raise ValueError("Invalid zoom action")
        return await self._run(self._zoom(url, action, title))

    async def _zoom(self, url, action, title=""):
        await self._ensure_page(url, title)
        expression = Path(__file__).with_name("assets").joinpath("web-zoom.js").read_text().replace(
            "__PORTAL_ZOOM_ACTION__", json.dumps(action)
        )
        result = await self._request("Runtime.evaluate", {"expression": expression, "returnByValue": True})
        if "exceptionDetails" in result:
            raise RuntimeError("Unable to zoom this web page")
        value = result.get("result", {}).get("value")
        if not isinstance(value, dict) or not isinstance(value.get("factor"), (float, int)):
            raise RuntimeError("No page zoom result")
        await self._request("Emulation.setPageScaleFactor", {"pageScaleFactor": 1})
        return value

    async def space(self, url, title=""):
        self._validate_url(url)
        await self._run(self._space(url, title))

    async def fullscreen(self, url, title=""):
        self._validate_url(url)
        key = {"key": "f", "code": "KeyF", "windowsVirtualKeyCode": 70, "nativeVirtualKeyCode": 70}
        await self._run(self._key(url, key, title))

    async def _run(self, operation):
        async with self._lock:
            try:
                return await asyncio.wait_for(operation, timeout=2)
            except BaseException:
                await self._disconnect()
                raise

    async def _dispatch(self, url, x, y, width, height, title=""):
        await self._ensure_page(url, title)
        await self._request("Input.dispatchMouseEvent", {
            "type": "mouseWheel", "x": width / 2, "y": height / 2,
            "deltaX": x * 96, "deltaY": y * 96, "modifiers": 0,
        })

    async def _space(self, url, title=""):
        key = {"key": " ", "code": "Space", "windowsVirtualKeyCode": 32, "nativeVirtualKeyCode": 32}
        await self._key(url, key, title)

    async def _key(self, url, key, title=""):
        await self._ensure_page(url, title)
        try:
            await self._request("Input.dispatchKeyEvent", {"type": "keyDown", **key})
        finally:
            await self._request("Input.dispatchKeyEvent", {"type": "keyUp", **key})

    async def _ensure_page(self, url, title=""):
        if self._url != url or self._title != title or self._socket is None or self._socket.closed:
            await self._disconnect()
            await self._connect(url, title)
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
                return result.get("result", {})
