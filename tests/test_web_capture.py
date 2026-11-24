import asyncio
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from main import Plugin
from web_capture import CaptureCancelled, SaveJob


class FakeCapture:
    def __init__(self, result=None, error=None, delay=0.0):
        self.result = result or {
            'id': '20261124-101530-abc123',
            'title': '女王魔域攻略',
            'url': 'https://example.com/guide',
            'mode': 'html',
            'resources': 3,
            'failed': 0,
            'links': 2,
        }
        self.error = error
        self.delay = delay
        self.cancelled = False

    async def save(self, url, title='', options=None, progress=None, cancelled=None):
        if progress:
            progress('snapshot', '保存页面快照')
        if self.delay:
            await asyncio.sleep(self.delay)
        if cancelled and cancelled():
            raise CaptureCancelled('已取消')
        if self.error:
            raise self.error
        return self.result


class SaveJobTests(unittest.IsolatedAsyncioTestCase):
    async def test_reports_progress_and_completes(self):
        job = SaveJob(FakeCapture(), 'https://example.com/guide')
        await job.run()
        status = job.snapshot()
        self.assertEqual(status['status'], 'done')
        self.assertEqual(status['stage'], 'done')
        self.assertEqual(status['collection']['id'], '20261124-101530-abc123')
        self.assertIsNotNone(status['finished_at'])

    async def test_reports_errors(self):
        job = SaveJob(FakeCapture(error=RuntimeError('网页加载超时')), 'https://example.com/')
        await job.run()
        status = job.snapshot()
        self.assertEqual(status['status'], 'error')
        self.assertEqual(status['message'], '网页加载超时')

    async def test_cancellation_is_reported(self):
        job = SaveJob(FakeCapture(), 'https://example.com/')
        job.cancel()
        await job.run()
        self.assertEqual(job.snapshot()['status'], 'cancelled')


class PluginOfflineSaveTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.uploads = TemporaryDirectory()
        self.destination = patch('main.upload_destination', return_value=Path(self.uploads.name))
        self.destination.start()
        self.ensure = patch('main.ensure_upload_directory', return_value=None)
        self.ensure.start()
        self.plugin = Plugin()

    async def asyncTearDown(self):
        await self.plugin._unload()
        self.ensure.stop()
        self.destination.stop()
        self.uploads.cleanup()

    async def wait(self):
        for _ in range(200):
            status = await self.plugin.get_offline_save_status()
            if status and status['status'] != 'running':
                return status
            await asyncio.sleep(0.01)
        raise AssertionError('save job did not finish')

    async def test_starts_a_save_job_and_exposes_its_status(self):
        with patch('main.PageCapture', lambda *_args: FakeCapture()):
            result = await self.plugin.save_offline_page('example.com/guide')
        self.assertTrue(result['started'])
        status = await self.wait()
        self.assertEqual(status['status'], 'done')
        self.assertEqual(status['collection']['title'], '女王魔域攻略')
        self.assertEqual(status['url'], 'https://example.com/guide')

    async def test_rejects_a_second_running_save_and_can_cancel(self):
        with patch('main.PageCapture', lambda *_args: FakeCapture(delay=0.2)):
            await self.plugin.save_offline_page('https://example.com/guide')
            with self.assertRaises(ValueError):
                await self.plugin.save_offline_page('https://example.com/other')
            await self.plugin.cancel_offline_save()
        status = await self.wait()
        self.assertEqual(status['status'], 'cancelled')
