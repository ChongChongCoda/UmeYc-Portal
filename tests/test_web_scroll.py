import unittest
from unittest.mock import AsyncMock, patch

from web_scroll import WebScroller


class WebScrollTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.scroller = WebScroller()
        self.socket = AsyncMock()
        self.socket.closed = False
        self.socket.receive_json.return_value = {"id": 1, "result": {}}

        async def connect(url):
            self.scroller._url = url
            self.scroller._socket = self.socket

        self.connect = patch.object(self.scroller, "_connect", side_effect=connect)
        self.connection = self.connect.start()

    async def asyncTearDown(self):
        await self.scroller.close()
        self.connect.stop()

    async def test_native_wheel_has_direction_speed_and_page_center(self):
        await self.scroller.scroll("https://guide.example/", 0.5, 1, 506, 534)
        event = self.socket.send_json.call_args.args[0]
        self.assertEqual(event["method"], "Input.dispatchMouseEvent")
        self.assertEqual(event["params"], {"type": "mouseWheel", "x": 253, "y": 267,
                         "deltaX": 48, "deltaY": 96, "modifiers": 0})
        self.socket.receive_json.return_value = {"id": 2, "result": {}}
        await self.scroller.scroll("https://guide.example/", 0, -0.5, 506, 534)
        self.connection.assert_awaited_once()
        self.assertEqual(self.socket.send_json.call_args.args[0]["params"]["deltaY"], -48)

    async def test_idle_does_not_connect_or_send_events(self):
        await self.scroller.scroll("https://guide.example/", 0, 0, 506, 534)
        self.connection.assert_not_called()

    async def test_space_sends_one_keydown_and_one_keyup(self):
        self.socket.receive_json.side_effect = [{"id": 1}, {"id": 2}]
        await self.scroller.space("https://video.example/")
        calls = [call.args[0] for call in self.socket.send_json.call_args_list]
        self.assertEqual([c["method"] for c in calls], ["Input.dispatchKeyEvent"] * 2)
        self.assertEqual([c["params"]["type"] for c in calls], ["keyDown", "keyUp"])
        self.assertTrue(all(c["params"]["key"] == " " and c["params"]["code"] == "Space" for c in calls))

    async def test_space_attempts_keyup_even_if_keydown_is_rejected(self):
        self.socket.receive_json.side_effect = [{"id": 1, "error": {}}, {"id": 2}]
        with self.assertRaises(RuntimeError):
            await self.scroller.space("https://video.example/")
        self.assertEqual(self.socket.send_json.call_args_list[-1].args[0]["params"]["type"], "keyUp")

    async def test_invalid_inputs_cannot_target_steam_or_non_web_pages(self):
        for url, x, width in [("https://steamloopback.host/", 1, 506), ("file:///etc/passwd", 1, 506),
                              ("https://guide.example/", float("nan"), 506),
                              ("https://guide.example/", 1, 0)]:
            with self.subTest(url=url), self.assertRaises(ValueError):
                await self.scroller.scroll(url, x, 0, width, 534)
        self.connection.assert_not_called()

    async def test_navigation_rebinds_and_close_releases_connection(self):
        await self.scroller.scroll("https://guide.example/one", 0, 1, 506, 534)
        self.socket.receive_json.return_value = {"id": 2}
        await self.scroller.scroll("https://guide.example/two", 0, 1, 506, 534)
        self.assertEqual(self.connection.await_count, 2)
        await self.scroller.close()
        self.assertIsNone(self.scroller._socket)
        self.assertIsNone(self.scroller._url)

    async def test_browser_errors_disconnect_and_allow_retry(self):
        self.socket.receive_json.return_value = {"id": 1, "error": {"message": "closed"}}
        with self.assertRaises(RuntimeError):
            await self.scroller.scroll("https://guide.example/", 0, 1, 506, 534)
        self.assertIsNone(self.scroller._socket)
