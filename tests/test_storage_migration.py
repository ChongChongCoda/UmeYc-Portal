import asyncio
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from main import Plugin
from storage_migration import StorageMigration, plan_migration


class StorageMigrationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = TemporaryDirectory()
        base = Path(self.temporary.name).resolve()
        self.old = base / '旧位置'
        self.new = base / '新位置'
        self.old.mkdir()
        self.new.mkdir()
        self.image = self.old / '攻略.jpg'
        self.image.write_bytes(b'old-image')
        self.taken = self.new / '攻略.jpg'
        self.taken.write_bytes(b'existing-image')
        self.collection_id = '20261124-101530-abc123'
        self.collection = self.old / 'offline' / self.collection_id
        (self.collection / 'assets').mkdir(parents=True)
        (self.collection / 'index.html').write_text('<h1>合集</h1>', encoding='utf-8')
        (self.collection / 'assets' / 'a.png').write_bytes(b'png')
        self.manifest = {
            'version': 1,
            'id': self.collection_id,
            'title': '女王魔域攻略合集',
            'url': 'https://example.com/guide',
            'created_at': 1763945730,
            'options': {},
            'status': 'saved',
            'pages': [{'id': 'main', 'url': 'https://example.com/guide', 'title': '主页面',
                       'file': 'index.html', 'status': 'saved'}],
        }
        (self.collection / 'manifest.json').write_text(
            json.dumps(self.manifest, ensure_ascii=False), encoding='utf-8'
        )

    def tearDown(self):
        self.temporary.cleanup()

    def test_plan_reports_images_collections_conflicts_and_bytes(self):
        plan = plan_migration(str(self.old), str(self.new))
        self.assertEqual(plan['images'], 1)
        self.assertEqual(plan['collections'], 1)
        self.assertEqual(plan['total'], 2)
        self.assertEqual(plan['conflicts'], 1)
        self.assertGreater(plan['bytes'], 0)
        self.assertEqual(plan['old'], str(self.old))
        self.assertEqual(plan['new'], str(self.new))

    def test_migrates_images_and_collections_without_overwriting(self):
        job = StorageMigration(str(self.old), str(self.new))
        job.run()
        status = job.snapshot()
        self.assertEqual(status['status'], 'done')
        self.assertEqual(status['errors'], [])
        self.assertEqual(status['done_items'], 2)
        self.assertEqual(status['bytes_done'], status['bytes_total'])
        moved = self.new / '攻略 (1).jpg'
        self.assertEqual(moved.read_bytes(), b'old-image')
        self.assertEqual(self.taken.read_bytes(), b'existing-image')
        self.assertFalse(self.image.exists())
        target = self.new / 'offline' / self.collection_id
        self.assertTrue((target / 'index.html').is_file())
        self.assertEqual((target / 'assets' / 'a.png').read_bytes(), b'png')
        self.assertEqual(json.loads((target / 'manifest.json').read_text(encoding='utf-8'))['id'],
                         self.collection_id)
        self.assertFalse(self.collection.exists())
        self.assertFalse((self.old / 'offline').exists())

    def test_collection_name_collision_updates_manifest_id(self):
        existing = self.new / 'offline' / self.collection_id
        existing.mkdir(parents=True)
        job = StorageMigration(str(self.old), str(self.new))
        job.run()
        status = job.snapshot()
        self.assertEqual(status['status'], 'done')
        self.assertEqual(status['collections'][0]['to'], self.collection_id + '-1')
        target = self.new / 'offline' / (self.collection_id + '-1')
        manifest = json.loads((target / 'manifest.json').read_text(encoding='utf-8'))
        self.assertEqual(manifest['id'], self.collection_id + '-1')
        self.assertEqual(manifest['title'], '女王魔域攻略合集')

    def test_copy_fallback_is_used_when_rename_fails(self):
        with patch('storage_migration.os.rename', side_effect=OSError('cross-device')):
            job = StorageMigration(str(self.old), str(self.new))
            job.run()
        status = job.snapshot()
        self.assertEqual(status['status'], 'done')
        self.assertEqual(status['errors'], [])
        self.assertEqual((self.new / '攻略 (1).jpg').read_bytes(), b'old-image')
        self.assertTrue((self.new / 'offline' / self.collection_id / 'index.html').is_file())
        self.assertFalse(self.image.exists())
        self.assertFalse(self.collection.exists())

    def test_plan_rejects_nested_roots(self):
        with self.assertRaises(ValueError):
            plan_migration(str(self.old), str(self.old / 'inside'))
        with self.assertRaises(ValueError):
            plan_migration(str(self.old / 'offline'), str(self.old))

    def test_empty_old_root_has_nothing_to_move(self):
        plan = plan_migration(str(self.old / 'missing'), str(self.new))
        self.assertEqual(plan['total'], 0)
        job = StorageMigration(str(self.old / 'missing'), str(self.new))
        job.run()
        self.assertEqual(job.snapshot()['status'], 'done')

    def test_cancel_before_start_moves_nothing(self):
        job = StorageMigration(str(self.old), str(self.new))
        job.cancel()
        job.run()
        status = job.snapshot()
        self.assertEqual(status['status'], 'cancelled')
        self.assertTrue(self.image.exists())
        self.assertTrue(self.collection.exists())

    def test_symlink_inside_collection_is_not_migrated(self):
        link = self.collection / 'assets' / 'leak.png'
        try:
            link.symlink_to(self.image)
        except (OSError, NotImplementedError):
            self.skipTest('symlinks are unavailable on this platform')
        job = StorageMigration(str(self.old), str(self.new))
        job.run()
        status = job.snapshot()
        self.assertEqual(len(status['errors']), 1)
        self.assertTrue(self.collection.exists())
        self.assertEqual((self.new / '攻略 (1).jpg').read_bytes(), b'old-image')


class PluginStorageMigrationTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temporary = TemporaryDirectory()
        base = Path(self.temporary.name).resolve()
        self.old = base / '旧位置'
        self.new = base / '新位置'
        self.old.mkdir()
        self.new.mkdir()
        (self.old / '攻略.png').write_bytes(b'image')
        self.plugin = Plugin()

    async def asyncTearDown(self):
        await self.plugin._unload()
        self.temporary.cleanup()

    async def test_plugin_starts_polls_and_finishes_a_migration(self):
        plan = await self.plugin.plan_storage_migration(str(self.old), str(self.new))
        self.assertEqual(plan['total'], 1)
        result = await self.plugin.start_storage_migration(str(self.old), str(self.new))
        self.assertTrue(result['started'])
        status = result['status']
        for _ in range(200):
            status = await self.plugin.get_storage_migration_status()
            if status and status['status'] != 'running':
                break
            await asyncio.sleep(0.02)
        self.assertEqual(status['status'], 'done')
        self.assertEqual(status['errors'], [])
        self.assertTrue((self.new / '攻略.png').is_file())
        self.assertFalse((self.old / '攻略.png').exists())

    async def test_plugin_rejects_a_second_running_migration(self):
        class RunningJob:
            def snapshot(self):
                return {'status': 'running'}

            def cancel(self):
                pass

        self.plugin._migration = RunningJob()
        with self.assertRaises(ValueError):
            await self.plugin.start_storage_migration(str(self.old), str(self.new))
