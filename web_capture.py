"""Capture the currently displayed Portal page as an offline collection.

The capture uses Steam's existing browser through its local CDP endpoint: the
page is not reloaded or navigated, the DOM snapshot (MHTML) is written into a
collection, and a full-page screenshot is used when the snapshot API is not
available. Videos are intentionally not downloaded.
"""

import asyncio
import base64
import json
from pathlib import Path
import shutil
import time
from urllib.parse import urlsplit

from mhtml_bundle import convert_mhtml, wrap_screenshot
from offline_store import OfflineLibrary


DEBUGGER_URL = "http://127.0.0.1:8080/json"
WAIT_TIMEOUT = 30.0
READY_TIMEOUT = 20.0
SETTLE_SECONDS = 1.5
MAX_PAGE_HEIGHT = 16000
MAX_PAGE_WIDTH = 4096


class CaptureError(RuntimeError):
    pass


class CaptureCancelled(RuntimeError):
    pass


def _route(address):
    try:
        parsed = urlsplit(address)
        return parsed.scheme, parsed.netloc, parsed.path
    except ValueError:
        return None


def _matching_pages(pages, url):
    pages = [
        page
        for page in pages
        if page.get("type") == "page" and page.get("webSocketDebuggerUrl")
    ]
    exact = [page for page in pages if page.get("url") == url]
    if exact:
        return exact
    route = _route(url)
    return [page for page in pages if route and _route(page.get("url", "")) == route]


class CDPClient:
    def __init__(self, socket):
        self._socket = socket
        self._sequence = 0

    async def call(self, method, params=None, timeout=20.0):
        self._sequence += 1
        await self._socket.send_json(
            {"id": self._sequence, "method": method, "params": params or {}}
        )
        while True:
            try:
                message = await asyncio.wait_for(self._socket.receive_json(), timeout)
            except asyncio.TimeoutError as error:
                raise CaptureError("浏览器响应超时") from error
            if message.get("id") != self._sequence:
                continue
            if "error" in message:
                raise CaptureError(message["error"].get("message") or method)
            return message.get("result", {})

    async def evaluate(self, expression, await_promise=False):
        params = {"expression": expression, "returnByValue": True}
        if await_promise:
            params["awaitPromise"] = True
        result = await self.call("Runtime.evaluate", params, timeout=30 if await_promise else 20)
        if "exceptionDetails" in result:
            raise CaptureError("无法读取网页内容")
        return result.get("result", {}).get("value")


LAZY_LOAD_EXPRESSION = """(async () => {
  const height = Math.min(document.documentElement.scrollHeight || 0, 30000);
  const step = Math.max(500, window.innerHeight * 0.8);
  for (let y = 0; y <= height; y += step) {
    window.scrollTo(0, y);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  window.scrollTo(0, 0);
  await new Promise(resolve => setTimeout(resolve, 300));
  return true;
})()"""


LINKS_EXPRESSION = """(() => {
  const root = document.querySelector('.post__container, .image-text__content, article, main') || document.body;
  const seen = new Set(); const links = [];
  for (const a of root.querySelectorAll('a[href]')) {
    const raw = a.getAttribute('href') || '';
    let decoded = raw;
    try { decoded = decodeURIComponent(raw); } catch (e) {}
    let web = null, linkId = null;
    const m = decoded.match(/"linkid"\\s*:\\s*(\\d+)/);
    if (m) {
      linkId = m[1];
      web = 'https://www.xiaoheihe.cn/app/bbs/link/' + linkId;
    } else if (/^heybox:\\/\\//.test(decoded)) {
      const p = decoded.match(/"path"\\s*:\\s*"(\\/app\\/[^"]+)"/);
      const u = decoded.match(/"url"\\s*:\\s*"(https?:\\/\\/[^"]+)"/);
      if (p) web = 'https://www.xiaoheihe.cn' + p[1];
      else if (u) web = u[1];
    } else if (/^https?:\\/\\//i.test(raw)) {
      web = a.href;
    }
    if (!web) continue;
    let absolute;
    try { absolute = new URL(web, location.href); } catch (e) { continue; }
    if (!/^https?:$/.test(absolute.protocol)) continue;
    if (seen.has(absolute.href)) continue;
    seen.add(absolute.href);
    links.push({url: absolute.href,
      title: (a.innerText || a.textContent || '').trim().slice(0, 200),
      link_id: linkId});
  }
  return {url: location.href,
    title: (document.title || '').trim().slice(0, 300),
    links: links.slice(0, 200)};
})()"""


class PageCapture:
    def __init__(self, library: OfflineLibrary, directory: str):
        self.library = library
        self.directory = directory

    async def save(self, url, title="", options=None, progress=None, cancelled=None):
        report = progress or (lambda *_args: None)
        is_cancelled = cancelled or (lambda: False)

        def check():
            if is_cancelled():
                raise CaptureCancelled("已取消")

        from aiohttp import ClientError, ClientSession, ClientTimeout

        session = ClientSession(
            timeout=ClientTimeout(total=None, sock_connect=5, sock_read=None)
        )
        socket = None
        created = None
        try:
            report("waiting", "等待网页加载")
            page = await self._wait_for_page(session, url, check)
            endpoint = urlsplit(page.get("webSocketDebuggerUrl", ""))
            if (
                endpoint.scheme != "ws"
                or endpoint.hostname not in {"127.0.0.1", "localhost"}
                or endpoint.port != 8080
            ):
                raise CaptureError("浏览器调试地址无效")
            socket = await session.ws_connect(page["webSocketDebuggerUrl"])
            client = CDPClient(socket)
            try:
                await client.call("Page.enable")
                await client.call("Runtime.enable")
            except CaptureError:
                pass
            await self._wait_ready(client, check)
            check()
            report("loading", "加载页面图片")
            try:
                await client.evaluate(LAZY_LOAD_EXPRESSION, await_promise=True)
            except CaptureError:
                pass
            check()
            report("reading", "读取网页内容")
            meta = await client.evaluate(LINKS_EXPRESSION)
            if not isinstance(meta, dict):
                raise CaptureError("无法读取网页内容")
            final_url = meta.get("url") or url
            page_title = title or meta.get("title") or "未命名网页"
            links = meta.get("links") if isinstance(meta.get("links"), list) else []
            check()
            report("creating", "创建离线网页")
            created = await asyncio.to_thread(
                self.library.create, self.directory, page_title, final_url, options or {}
            )
            destination = Path(created["directory"])
            summary = None
            try:
                report("snapshot", "保存页面快照")
                snapshot = await client.call(
                    "Page.captureSnapshot", {"format": "mhtml"}, timeout=60
                )
                data = snapshot.get("data")
                if not data:
                    raise CaptureError("页面快照为空")
                summary = await asyncio.to_thread(
                    convert_mhtml, data, destination, final_url
                )
            except Exception:
                if is_cancelled():
                    raise CaptureCancelled("已取消") from None
                report("screenshot", "保存整页截图")
                summary = await self._screenshot(
                    client, destination, page_title, final_url
                )
            check()
            report("links", "保存链接列表")
            await asyncio.to_thread(
                (destination / "links.json").write_text,
                json.dumps(links, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
            report("writing", "写入离线网页")
            manifest = created["manifest"]
            manifest["title"] = page_title
            manifest["url"] = final_url
            manifest["status"] = "saved" if not summary.get("failed") else "partial"
            manifest["pages"] = [
                {
                    "id": "main",
                    "url": final_url,
                    "title": page_title,
                    "file": summary["file"],
                    "mode": summary.get("mode", "html"),
                    "status": "saved" if not summary.get("failed") else "partial",
                    "resources": summary.get("resources", 0),
                    "failed": summary.get("failed", 0),
                }
            ]
            manifest["link_count"] = len(links)
            await asyncio.to_thread(
                self.library.write, self.directory, created["id"], manifest
            )
            report("done", "离线保存完成")
            return {
                "id": created["id"],
                "title": page_title,
                "url": final_url,
                "mode": summary.get("mode", "html"),
                "resources": summary.get("resources", 0),
                "failed": summary.get("failed", 0),
                "links": len(links),
            }
        except BaseException:
            if created is not None:
                shutil.rmtree(created["directory"], ignore_errors=True)
            raise
        finally:
            if socket is not None:
                try:
                    await socket.close()
                except (ClientError, OSError):
                    pass
            await session.close()

    async def _wait_for_page(self, session, url, check):
        deadline = time.monotonic() + WAIT_TIMEOUT
        while time.monotonic() < deadline:
            check()
            try:
                async with session.get(DEBUGGER_URL) as response:
                    pages = await response.json()
            except (ClientError, OSError, ValueError):
                pages = []
            matches = _matching_pages(pages, url)
            if len(matches) == 1:
                return matches[0]
            if len(matches) > 1:
                raise CaptureError("无法唯一识别网页，请关闭重复的网页后重试")
            await asyncio.sleep(0.4)
        raise CaptureError("等待网页加载超时，请确认网页已经打开")

    async def _wait_ready(self, client, check):
        deadline = time.monotonic() + READY_TIMEOUT
        while time.monotonic() < deadline:
            check()
            try:
                state = await client.evaluate("document.readyState")
            except CaptureError:
                state = None
            if state == "complete":
                await asyncio.sleep(SETTLE_SECONDS)
                return
            await asyncio.sleep(0.3)
        raise CaptureError("网页加载超时")

    async def _screenshot(self, client, destination, title, url):
        width, height, scale = 1280.0, 720.0, 1.0
        try:
            metrics = await client.call("Page.getLayoutMetrics")
            size = metrics.get("cssContentSize") or metrics.get("contentSize") or {}
            width = float(size.get("width") or width)
            height = float(size.get("height") or height)
        except (CaptureError, TypeError, ValueError):
            pass
        width = max(320.0, min(width, MAX_PAGE_WIDTH))
        height = max(480.0, min(height, 250000.0))
        scale = min(1.0, MAX_PAGE_HEIGHT / height)
        data = None
        try:
            result = await client.call(
                "Page.captureScreenshot",
                {
                    "format": "png",
                    "fromSurface": True,
                    "captureBeyondViewport": True,
                    "clip": {
                        "x": 0,
                        "y": 0,
                        "width": width,
                        "height": height,
                        "scale": scale,
                    },
                },
                timeout=90,
            )
            data = result.get("data")
        except CaptureError:
            data = None
        if not data:
            result = await client.call("Page.captureScreenshot", {"format": "png"}, timeout=30)
            data = result.get("data")
            height, scale = 720.0, 1.0
        if not data:
            raise CaptureError("无法保存网页截图")
        try:
            image = base64.b64decode(data)
        except ValueError as error:
            raise CaptureError("网页截图数据无效") from error
        (destination / "page.png").write_bytes(image)
        (destination / "index.html").write_text(
            wrap_screenshot("page.png", title), encoding="utf-8"
        )
        return {
            "file": "index.html",
            "mode": "image",
            "resources": 1,
            "failed": 0,
            "image": "page.png",
            "height": height,
            "scale": scale,
        }


SEARCH_EXPRESSION = """(() => {
  const input = document.querySelector('#query, #search, input[type="search"]');
  if (!input) return false;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(input, __QUERY__);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
})()"""


async def inject_search(url, query):
    """Fill the map/items search box through CDP without opening the keyboard."""
    if not isinstance(url, str) or not isinstance(query, str):
        raise CaptureError("搜索参数无效")
    parsed = urlsplit(url)
    if (
        parsed.scheme != "http"
        or parsed.hostname not in {"127.0.0.1", "localhost"}
        or not parsed.path.startswith("/app/")
    ):
        raise CaptureError("只能搜索本地地图册页面")
    from aiohttp import ClientError, ClientSession, ClientTimeout

    session = ClientSession(timeout=ClientTimeout(total=None, sock_connect=5, sock_read=10))
    socket = None
    try:
        page = None
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            try:
                async with session.get(DEBUGGER_URL) as response:
                    pages = await response.json()
            except (ClientError, OSError, ValueError):
                pages = []
            matches = _matching_pages(pages, url)
            if len(matches) == 1:
                page = matches[0]
                break
            if len(matches) > 1:
                raise CaptureError("无法唯一识别网页，请关闭重复页面后重试")
            await asyncio.sleep(0.2)
        if page is None:
            raise CaptureError("地图页面尚未打开")
        endpoint = urlsplit(page.get("webSocketDebuggerUrl", ""))
        if (
            endpoint.scheme != "ws"
            or endpoint.hostname not in {"127.0.0.1", "localhost"}
            or endpoint.port != 8080
        ):
            raise CaptureError("浏览器调试地址无效")
        socket = await session.ws_connect(page["webSocketDebuggerUrl"])
        client = CDPClient(socket)
        await client.call("Runtime.enable")
        expression = SEARCH_EXPRESSION.replace(
            "__QUERY__", json.dumps(query, ensure_ascii=False)
        )
        value = await client.evaluate(expression)
        if value is not True:
            raise CaptureError("这个页面没有可用的搜索框")
        return {"found": True}
    finally:
        if socket is not None:
            try:
                await socket.close()
            except (ClientError, OSError):
                pass
        await session.close()


class SaveJob:
    """One offline save request with a pollable status."""

    def __init__(self, capture: PageCapture, url: str, title: str = ""):
        self.capture = capture
        self.url = url
        self.title = title
        self._cancelled = False
        self._status = {
            "status": "running",
            "stage": "waiting",
            "message": "等待网页加载",
            "url": url,
            "title": title,
            "collection": None,
            "started_at": int(time.time()),
            "finished_at": None,
        }

    def _report(self, stage, message):
        self._status["stage"] = stage
        self._status["message"] = message

    def cancel(self):
        self._cancelled = True

    def snapshot(self):
        return dict(self._status)

    async def run(self):
        try:
            result = await self.capture.save(
                self.url,
                self.title,
                progress=self._report,
                cancelled=lambda: self._cancelled,
            )
            self._status.update(
                status="done",
                stage="done",
                message="离线保存完成",
                collection=result,
                finished_at=int(time.time()),
            )
        except CaptureCancelled:
            self._status.update(
                status="cancelled",
                message="已取消离线保存",
                finished_at=int(time.time()),
            )
        except Exception as error:  # noqa: BLE001 - surface every failure to the UI
            self._status.update(
                status="error",
                message=str(error),
                finished_at=int(time.time()),
            )
