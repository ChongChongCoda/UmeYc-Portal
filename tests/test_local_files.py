import asyncio
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from main import Plugin


class LocalPreviewTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.plugin = Plugin()
        self.path = Path(self.temp.name) / '攻略 #1? <上>.JPG'
        self.path.write_bytes(b"test-image-content")

    async def asyncTearDown(self):
        await self.plugin._unload()
        self.temp.cleanup()

    async def test_image_viewer_and_exact_file_content(self):
        result = await self.plugin.prepare_local_file(str(self.path))
        url = result["url"]
        self.assertNotIn(str(self.path), url)
        self.assertEqual(self.plugin._server.server_address[0], "127.0.0.1")
        with urlopen(url) as response:
            page = response.read().decode()
            self.assertIn("攻略 #1? &lt;上&gt;.JPG", page)
            self.assertIn('aria-label="默认"', page)
            self.assertNotIn('{{ICON_', page)
            icons = json.loads((Path(__file__).resolve().parent.parent / 'assets/zoom-icons.json').read_text())
            for icon in icons.values():
                self.assertIn(icon, page)
            self.assertEqual(response.headers["Cache-Control"], "no-store")
        file_url = url.replace("/viewer/", "/file/")
        with urlopen(file_url) as response:
            self.assertEqual(hashlib.sha256(response.read()).digest(),
                             hashlib.sha256(self.path.read_bytes()).digest())
            self.assertEqual(response.headers["Content-Type"], "image/jpeg")
        with urlopen(Request(file_url, method="HEAD")) as response:
            self.assertEqual(int(response.headers["Content-Length"]), self.path.stat().st_size)
            self.assertEqual(response.read(), b"")

    async def test_unsupported_missing_directory_and_relative_paths(self):
        invalid = Path(self.temp.name) / 'program.sh'
        invalid.write_text('echo example')
        for path in [str(invalid), self.temp.name, str(self.path) + '.missing', 'relative.jpg']:
            with self.subTest(path=path), self.assertRaises(ValueError):
                await self.plugin.prepare_local_file(path)

    async def test_only_granted_files_and_expected_host_are_accessible(self):
        url = (await self.plugin.prepare_local_file(str(self.path)))["url"]
        base = url.split('/viewer/')[0]
        for path in ['/file/no-token', '/file/../../etc/passwd', '/viewer/no-token', '/']:
            with self.subTest(path=path), self.assertRaises(HTTPError) as caught:
                urlopen(base + path)
            self.assertEqual(caught.exception.code, 404)
        with self.assertRaises(HTTPError) as caught:
            urlopen(Request(url, headers={"Host": "untrusted.example"}))
        self.assertEqual(caught.exception.code, 403)

    async def test_file_removed_after_selection_reports_error(self):
        url = (await self.plugin.prepare_local_file(str(self.path)))["url"].replace('/viewer/', '/file/')
        self.path.unlink()
        with self.assertRaises(HTTPError) as caught:
            urlopen(url)
        self.assertEqual(caught.exception.code, 404)

    async def test_text_content_and_new_grant_after_restart(self):
        text = self.path.with_suffix('.md')
        text.write_text('攻略正文', encoding='utf-8')
        first = (await self.plugin.prepare_local_file(str(text)))["url"]
        with urlopen(first) as response:
            self.assertEqual(response.read().decode(), '攻略正文')
            self.assertEqual(response.headers['Content-Type'], 'text/plain; charset=utf-8')
        old_thread = self.plugin._thread
        await self.plugin._unload()
        self.assertFalse(old_thread.is_alive())
        second = (await self.plugin.prepare_local_file(str(text)))["url"]
        self.assertNotEqual(first, second)
        with urlopen(second) as response:
            self.assertEqual(response.read().decode(), '攻略正文')

    async def test_reading_position_is_session_only_and_scoped_to_file(self):
        url = (await self.plugin.prepare_local_file(str(self.path)))["url"]
        state_url = url.replace('/viewer/', '/state/')
        state = {"top": 1.25, "left": 0.2, "zoom": 1.4}
        request = Request(state_url, data=json.dumps(state).encode(), method='POST')
        with urlopen(request) as response:
            self.assertEqual(response.status, 204)
        with urlopen(url) as response:
            page = response.read().decode()
            self.assertIn('&quot;top&quot;: 1.25', page)
        same_url = (await self.plugin.prepare_local_file(str(self.path)))["url"]
        self.assertEqual(url, same_url)
        await self.plugin._unload()
        restarted = (await self.plugin.prepare_local_file(str(self.path)))["url"]
        with urlopen(restarted) as response:
            self.assertIn('&quot;top&quot;: 0', response.read().decode())

    async def test_motion_is_pushed_to_subscribers_and_stops_on_unload(self):
        import queue
        url = (await self.plugin.prepare_local_file(str(self.path)))["url"]
        token = url.rsplit('/', 1)[1]
        listener = queue.Queue(maxsize=4)
        self.plugin._server.listeners[token] = [listener]
        await self.plugin.set_reader_motion(str(self.path), 0, 0.8)
        self.assertEqual(json.loads(listener.get_nowait()), {"x": 0, "y": 0.8})
        with self.assertRaises(ValueError):
            await self.plugin.set_reader_motion(str(self.path), 0, float('nan'))
        with self.assertRaises(ValueError):
            await self.plugin.set_reader_motion('/unselected.JPG', 0, 1)
        await self.plugin._unload()
        self.assertIsNone(listener.get_nowait())

    async def test_zoom_commands_use_selected_image_and_validate_action(self):
        import queue
        with self.assertRaises(ValueError):
            await self.plugin.zoom_reader(str(self.path), "smaller")
        url = (await self.plugin.prepare_local_file(str(self.path)))["url"]
        listener = queue.Queue(maxsize=4)
        self.plugin._server.listeners[url.rsplit('/', 1)[1]] = [listener]
        for action in ("smaller", "default", "larger"):
            await self.plugin.zoom_reader(str(self.path), action)
            self.assertEqual(json.loads(listener.get_nowait()), {"zoom": action})
        with self.assertRaises(ValueError):
            await self.plugin.zoom_reader(str(self.path), "invalid")
        with self.assertRaises(ValueError):
            await self.plugin.zoom_reader("/unselected.JPG", "default")
        text = self.path.with_suffix('.txt')
        text.write_text('攻略')
        await self.plugin.prepare_local_file(str(text))
        with self.assertRaises(ValueError):
            await self.plugin.zoom_reader(str(text), "larger")
        self.assertTrue(listener.empty())

    async def test_viewer_script_is_served_and_state_rejects_invalid_values(self):
        url = (await self.plugin.prepare_local_file(str(self.path)))["url"]
        with urlopen(url.replace('/viewer/', '/script/')) as response:
            self.assertEqual(response.headers['Content-Type'], 'text/javascript; charset=utf-8')
            self.assertIn(b'EventSource', response.read())
        for state in [{}, {"top": -1, "left": 0, "zoom": 1}, {"top": 0, "left": 0, "zoom": 100}]:
            with self.subTest(state=state), self.assertRaises(HTTPError) as caught:
                urlopen(Request(url.replace('/viewer/', '/state/'), data=json.dumps(state).encode()))
            self.assertEqual(caught.exception.code, 400)


if __name__ == '__main__':
    unittest.main()
