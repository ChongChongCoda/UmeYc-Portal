import os
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from main import Plugin


class LocalAppTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temporary = TemporaryDirectory()
        self.home = Path(self.temporary.name).resolve()
        self.environment = patch.dict(os.environ, {'DECKY_USER_HOME': str(self.home)})
        self.environment.start()
        self.app = self.home / '女王魔域地图册'
        (self.app / 'assets').mkdir(parents=True)
        (self.app / 'index.html').write_text(
            '<!doctype html><script src="app.js"></script><h1>2D</h1>', encoding='utf-8'
        )
        (self.app / 'world.html').write_text(
            '<!doctype html><script src="app.js"></script><h1>3D</h1>', encoding='utf-8'
        )
        (self.app / 'app.js').write_text('window.atlas = true;', encoding='utf-8')
        (self.app / 'assets' / 'map.png').write_bytes(b'png')
        self.plugin = Plugin()

    async def asyncTearDown(self):
        await self.plugin._unload()
        self.environment.stop()
        self.temporary.cleanup()

    async def test_validates_and_serves_scripts_without_network(self):
        info = await self.plugin.validate_local_app(str(self.app))
        self.assertEqual(info['directory'], str(self.app))
        self.assertEqual(info['entries'], ['index.html', 'world.html'])
        opened = await self.plugin.open_local_app(str(self.app), 'world.html')
        self.assertIn('/app/', opened['url'])
        with urlopen(opened['url']) as response:
            page = response.read().decode()
            csp = response.headers['Content-Security-Policy']
            self.assertIn('3D', page)
            self.assertIn('__portal_touch.js', page)
            self.assertIn("script-src 'self'", csp)
            self.assertIn("connect-src 'none'", csp)
            self.assertIn('private', response.headers['Cache-Control'])
            etag = response.headers['ETag']
        touch_url = opened['url'].replace('world.html', '__portal_touch.js')
        with urlopen(touch_url) as response:
            script = response.read().decode()
            self.assertIn('__portalTouch', script)
            self.assertTrue(response.headers['Content-Type'].startswith('application/javascript'))
        script = opened['url'].replace('world.html', 'app.js')
        with urlopen(script) as response:
            self.assertEqual(response.read(), b'window.atlas = true;')
            self.assertTrue(response.headers['Content-Type'].startswith('application/javascript'))
        image = opened['url'].replace('world.html', 'assets/map.png')
        with urlopen(image) as response:
            self.assertEqual(response.read(), b'png')
            self.assertEqual(response.headers['Content-Type'], 'image/png')
        request = Request(opened['url'], headers={'If-None-Match': etag})
        try:
            with urlopen(request) as response:
                self.assertEqual(response.status, 304)
        except HTTPError as error:
            self.assertEqual(error.code, 304)

    async def test_rejects_foreign_hosts_traversal_and_unknown_entries(self):
        opened = await self.plugin.open_local_app(str(self.app), 'index.html')
        base = opened['url'].rsplit('/', 1)[0]
        for suffix in ['/../secret.txt', '/%2e%2e/secret.txt', '/missing.js', '/..%2fsecret']:
            with self.subTest(suffix=suffix), self.assertRaises(HTTPError) as caught:
                urlopen(base + suffix)
            self.assertEqual(caught.exception.code, 404)
        with self.assertRaises(HTTPError) as caught:
            urlopen(Request(opened['url'], headers={'Host': 'untrusted.example'}))
        self.assertEqual(caught.exception.code, 403)
        with self.assertRaises(ValueError):
            await self.plugin.open_local_app(str(self.app), 'missing.html')

    async def test_requires_a_user_storage_app_with_index(self):
        outside = TemporaryDirectory()
        try:
            (Path(outside.name) / 'index.html').write_text('x', encoding='utf-8')
            with self.assertRaises(ValueError):
                await self.plugin.validate_local_app(outside.name)
        finally:
            outside.cleanup()
        empty = self.home / '空文件夹'
        empty.mkdir()
        with self.assertRaises(ValueError):
            await self.plugin.validate_local_app(str(empty))
        with self.assertRaises(ValueError):
            await self.plugin.validate_local_app('relative/path')

    async def test_selecting_the_outer_folder_descends_into_the_only_app(self):
        outer = self.home / '解压后的外层'
        outer.mkdir()
        inner = outer / '女王魔域-2D与3D离线地图册'
        inner.mkdir()
        (inner / 'index.html').write_text('inner', encoding='utf-8')
        info = await self.plugin.validate_local_app(str(outer))
        self.assertEqual(info['directory'], str(inner.resolve()))
        self.assertEqual(info['entries'], ['index.html'])

    async def test_search_requires_a_local_app_url_and_query(self):
        with self.assertRaises(ValueError):
            await self.plugin.search_local_app('https://example.com/', 'x')
        with self.assertRaises(ValueError):
            await self.plugin.search_local_app(
                'http://127.0.0.1:8137/app/token/index.html', '   '
            )

    async def test_unload_stops_the_local_app_server(self):
        opened = await self.plugin.open_local_app(str(self.app), 'index.html')
        self.assertIsNotNone(self.plugin._local_app_server)
        await self.plugin._unload()
        self.assertIsNone(self.plugin._local_app_server)
        with self.assertRaises((HTTPError, URLError)):
            urlopen(opened['url'], timeout=1)
