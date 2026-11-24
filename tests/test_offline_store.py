from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from main import Plugin


class OfflineCollectionTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.uploads = TemporaryDirectory()
        self.base = Path(self.uploads.name)
        self.destination = patch('main.upload_destination', return_value=self.base)
        self.destination.start()
        self.ensure = patch('main.ensure_upload_directory', return_value=None)
        self.ensure.start()
        self.plugin = Plugin()

    async def asyncTearDown(self):
        await self.plugin._unload()
        self.ensure.stop()
        self.destination.stop()
        self.uploads.cleanup()

    def create(self, title='中文攻略', url='https://example.com/guide'):
        created = self.plugin._offline.create(str(self.base), title, url)
        page = Path(created['directory']) / 'index.html'
        page.write_text('<!doctype html><meta charset="utf-8"><h1>攻略</h1>', encoding='utf-8')
        manifest = created['manifest']
        manifest['pages'] = [
            {'id': 'main', 'url': url, 'title': title, 'file': 'index.html', 'status': 'saved'}
        ]
        manifest['status'] = 'saved'
        self.plugin._offline.write(str(self.base), created['id'], manifest)
        return created

    async def entry(self):
        listing = await self.plugin.list_offline_collections('')
        return listing['entries'][0]

    async def test_lists_opens_serves_and_deletes_collection(self):
        created = self.create()
        listing = await self.plugin.list_offline_collections('')
        self.assertEqual(listing['directory'], str(self.base / 'offline'))
        entry = listing['entries'][0]
        self.assertEqual(entry['title'], '中文攻略')
        self.assertEqual(entry['pages'], 1)
        self.assertEqual(entry['status'], 'saved')
        opened = await self.plugin.open_offline_collection(entry['open_token'])
        with urlopen(opened['url']) as response:
            self.assertIn('攻略', response.read().decode())
            self.assertEqual(response.headers['Cache-Control'], 'no-store')
            self.assertIn("script-src 'none'", response.headers['Content-Security-Policy'])
        deleted = await self.plugin.delete_offline_collection(entry['delete_token'])
        self.assertEqual(deleted['title'], '中文攻略')
        self.assertFalse(Path(created['directory']).exists())
        with self.assertRaises(HTTPError) as caught:
            urlopen(opened['url'])
        self.assertEqual(caught.exception.code, 404)

    async def test_unknown_and_stale_tokens_are_rejected(self):
        created = self.create()
        entry = await self.entry()
        with self.assertRaises(ValueError):
            await self.plugin.open_offline_collection('not-a-token')
        path = Path(created['directory'])
        manifest = (path / 'manifest.json').read_text(encoding='utf-8')
        backup = path.with_name(path.name + '-old')
        path.rename(backup)
        path.mkdir()
        (path / 'manifest.json').write_text(manifest, encoding='utf-8')
        with self.assertRaises(ValueError):
            await self.plugin.open_offline_collection(entry['open_token'])
        with self.assertRaises(ValueError):
            await self.plugin.delete_offline_collection(entry['delete_token'])

    async def test_delete_requires_fresh_grant_and_intact_manifest(self):
        created = self.create()
        entry = await self.entry()
        with self.assertRaises(ValueError):
            await self.plugin.delete_offline_collection('not-a-token')
        (Path(created['directory']) / 'manifest.json').unlink()
        with self.assertRaises(ValueError):
            await self.plugin.delete_offline_collection(entry['delete_token'])
        self.assertTrue(Path(created['directory']).exists())

    async def test_server_rejects_traversal_and_foreign_hosts(self):
        self.create()
        entry = await self.entry()
        url = (await self.plugin.open_offline_collection(entry['open_token']))['url']
        base = url[: -len('/index.html')]
        for suffix in ['/../manifest.json', '/%2e%2e/manifest.json', '/..%2fmanifest.json',
                       '/no-such.png', '/nested/../../manifest.json']:
            with self.subTest(suffix=suffix), self.assertRaises(HTTPError) as caught:
                urlopen(base + suffix)
            self.assertEqual(caught.exception.code, 404)
        with self.assertRaises(HTTPError) as caught:
            urlopen(Request(url, headers={'Host': 'untrusted.example'}))
        self.assertEqual(caught.exception.code, 403)

    async def test_symlink_escape_is_not_served(self):
        secret = self.base / 'secret.txt'
        secret.write_text('secret', encoding='utf-8')
        created = self.create()
        link = Path(created['directory']) / 'leak.txt'
        try:
            link.symlink_to(secret)
        except (OSError, NotImplementedError):
            self.skipTest('symlinks are unavailable on this platform')
        entry = await self.entry()
        url = (await self.plugin.open_offline_collection(entry['open_token']))['url']
        with self.assertRaises(HTTPError) as caught:
            urlopen(url.replace('index.html', 'leak.txt'))
        self.assertEqual(caught.exception.code, 404)

    async def test_damaged_collections_are_not_listed(self):
        created = self.create()
        damaged = self.base / 'offline' / 'damaged'
        damaged.mkdir()
        listing = await self.plugin.list_offline_collections('')
        self.assertEqual([entry['id'] for entry in listing['entries']], [created['id']])

    async def test_unload_stops_the_offline_server(self):
        self.create()
        entry = await self.entry()
        opened = await self.plugin.open_offline_collection(entry['open_token'])
        self.assertIsNotNone(self.plugin._offline_server)
        await self.plugin._unload()
        self.assertIsNone(self.plugin._offline_server)
        with self.assertRaises((HTTPError, URLError)):
            urlopen(opened['url'], timeout=1)
