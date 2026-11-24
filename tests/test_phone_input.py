import socket
import base64
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, quote
from urllib.request import Request, urlopen

from main import Plugin
from phone_input import PhoneInputSession, normalize_search, normalize_url


class PhoneInputTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.address = patch('main.lan_address', return_value='127.0.0.1')
        self.address.start()
        self.plugin = Plugin()
        self.uploads = TemporaryDirectory()
        self.destination = patch('main.upload_destination', return_value=Path(self.uploads.name))
        self.destination.start()

    async def asyncTearDown(self):
        await self.plugin._unload()
        self.address.stop()
        self.destination.stop()
        self.uploads.cleanup()

    def post(self, url, value, headers=None):
        return urlopen(Request(url, data=urlencode({'url': value}).encode(),
                               headers=headers or {}), timeout=3)

    def post_text(self, url, value, headers=None):
        return urlopen(Request(url, data=urlencode({'text': value}).encode(),
                               headers=headers or {}), timeout=3)

    async def test_search_mode_serves_phone_keyboard_form_and_returns_text(self):
        session = await self.plugin.start_url_input(mode='search')
        self.assertEqual(session['mode'], 'search')
        self.assertNotIn('upload_directory', session)
        self.assertEqual(
            (await self.plugin.get_url_input_status(session['session_id']))['status'], 'waiting')
        with urlopen(session['url']) as response:
            page = response.read().decode()
        self.assertIn('地图搜索', page)
        self.assertIn('name="text"', page)
        self.assertNotIn('upload.js', page)
        with self.assertRaises(HTTPError) as caught:
            urlopen(session['url'] + '/upload.js')
        self.assertEqual(caught.exception.code, 404)
        with self.post_text(session['url'], '  钥匙  ',
                            {'Origin': session['url'].rsplit('/', 1)[0]}) as response:
            self.assertIn('搜索内容已发送', response.read().decode())
        result = await self.plugin.get_url_input_status(session['session_id'])
        self.assertEqual(result, {'status': 'received', 'kind': 'search', 'text': '钥匙'})
        self.assertEqual(
            await self.plugin.get_url_input_status(session['session_id']), result)
        with self.assertRaises((URLError, ConnectionError, socket.timeout)):
            urlopen(session['url'], timeout=1)

    async def test_search_mode_rejects_unsafe_values_and_other_fields(self):
        session = await self.plugin.start_url_input(mode='search')
        for data, headers, code in [
            (urlencode({'text': ''}).encode(), {}, 400),
            (urlencode({'text': ' '}).encode(), {}, 400),
            (urlencode({'text': 'x' * 201}).encode(), {}, 400),
            (urlencode({'url': 'https://example.com'}).encode(), {}, 400),
            (urlencode({'text': '钥匙'}).encode(), {'Content-Type': 'application/json'}, 415),
        ]:
            with self.subTest(code=code), self.assertRaises(HTTPError) as caught:
                urlopen(Request(session['url'], data=data, headers=headers), timeout=3)
            self.assertEqual(caught.exception.code, code)
        with self.assertRaises(HTTPError) as caught:
            urlopen(Request(session['url'] + '?upload=1&filename=a.png',
                            data=b'\x89PNG\r\n\x1a\n'), timeout=3)
        self.assertEqual(caught.exception.code, 400)
        self.assertEqual(
            (await self.plugin.get_url_input_status(session['session_id']))['status'], 'waiting')
        with self.post_text(session['url'], '钥匙'):
            pass
        self.assertEqual(
            (await self.plugin.get_url_input_status(session['session_id']))['status'], 'received')

    async def test_search_session_accepts_only_one_submission(self):
        session = await self.plugin.start_url_input(mode='search')
        with self.post_text(session['url'], '钥匙'):
            pass
        with self.assertRaises(HTTPError) as caught:
            self.post_text(session['url'], '知识')
        self.assertEqual(caught.exception.code, 409)
        result = await self.plugin.get_url_input_status(session['session_id'])
        self.assertEqual(result['text'], '钥匙')

    async def test_rejects_unknown_input_mode(self):
        with self.assertRaisesRegex(ValueError, '扫码输入类型'):
            await self.plugin.start_url_input(mode='video')
        self.assertIsNone(self.plugin._phone)

    async def test_form_submit_receive_and_port_closes(self):
        session = await self.plugin.start_url_input()
        url = session['url']
        self.assertEqual((await self.plugin.get_url_input_status(session['session_id']))['status'], 'waiting')
        with urlopen(url) as response:
            page = response.read().decode()
            self.assertIn('扫码传送', page)
            self.assertIn('上传图片', page)
            self.assertIn(f'/{session["session_id"]}/upload.js', page)
            self.assertEqual(response.headers['Cache-Control'], 'no-store')
            self.assertEqual(response.headers['Referrer-Policy'], 'same-origin')
            self.assertIn('<meta name="referrer" content="same-origin">', page)
        with self.post(url, 'example.com/攻略?a=1&b=2', {'Origin': url.rsplit('/', 1)[0]}) as response:
            self.assertIn('网址已发送', response.read().decode())
        result = await self.plugin.get_url_input_status(session['session_id'])
        self.assertEqual(result, {'status': 'received', 'url': 'https://example.com/攻略?a=1&b=2'})
        self.assertEqual(await self.plugin.get_url_input_status(session['session_id']), result)
        with self.assertRaises((URLError, ConnectionError, socket.timeout)):
            urlopen(url, timeout=1)

    async def test_cancel_closes_only_matching_session(self):
        first = await self.plugin.start_url_input()
        previous = self.plugin._phone
        second = await self.plugin.start_url_input()
        self.assertFalse(previous._thread.is_alive())
        self.assertNotEqual(first['session_id'], second['session_id'])
        await self.plugin.cancel_url_input(first['session_id'])
        self.assertEqual((await self.plugin.get_url_input_status(second['session_id']))['status'], 'waiting')
        await self.plugin.cancel_url_input(second['session_id'])
        self.assertIsNone(self.plugin._phone)
        self.assertEqual((await self.plugin.get_url_input_status(second['session_id']))['status'], 'expired')

    async def test_rejects_wrong_token_host_and_cross_origin(self):
        session = await self.plugin.start_url_input()
        url = session['url']
        for request, status in [
            (Request(url + '-wrong'), 404),
            (Request(url, headers={'Host': 'untrusted.example'}), 403),
            (Request(url, data=b'url=https%3A%2F%2Fexample.com', headers={'Origin': 'https://untrusted.example'}), 403),
            (Request(url, data=b'{}', headers={'Content-Type': 'application/json'}), 415),
        ]:
            with self.subTest(status=status), self.assertRaises(HTTPError) as caught:
                urlopen(request)
            self.assertEqual(caught.exception.code, status)
        self.assertEqual((await self.plugin.get_url_input_status(session['session_id']))['status'], 'waiting')

    async def test_image_upload_preserves_chinese_name_and_opens_local_preview(self):
        session = await self.plugin.start_url_input()
        image = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=')
        url = session['url'] + '?upload=1&filename=' + quote('中文攻略.PNG')
        request = Request(url, data=image, headers={
            'Content-Type': 'application/octet-stream', 'Origin': session['url'].rsplit('/', 1)[0]})
        with urlopen(request) as response:
            self.assertIn('图片已上传', response.read().decode())
        result = await self.plugin.get_url_input_status(session['session_id'])
        saved = Path(self.uploads.name).resolve() / '中文攻略.png'
        self.assertEqual(result, {'status': 'received', 'url': saved.as_uri()})
        self.assertEqual(saved.read_bytes(), image)
        preview = await self.plugin.prepare_local_file(str(saved))
        with urlopen(preview['url']) as response:
            self.assertIn('中文攻略.png', response.read().decode())

    async def test_upload_rejects_wrong_origin_token_type_and_oversize_without_consuming_session(self):
        session = await self.plugin.start_url_input()
        for suffix, data, headers, code in [
            ('-wrong?upload=1&filename=a.png', b'\x89PNG\r\n\x1a\n', {}, 404),
            ('?upload=1&filename=a.png', b'\x89PNG\r\n\x1a\n', {'Origin': 'https://other.example'}, 403),
            ('?upload=1&filename=a.html', b'<html>', {}, 400),
            ('?upload=1&filename=a.png', b'PNG', {'Content-Length': str(65 * 1024 * 1024)}, 400),
            ('?upload=1&filename=a.png', b'not an image', {}, 400),
        ]:
            with self.subTest(suffix=suffix, code=code), self.assertRaises(HTTPError) as caught:
                urlopen(Request(session['url'] + suffix, data=data, headers=headers), timeout=3)
            self.assertEqual(caught.exception.code, code)
        self.assertEqual(list(Path(self.uploads.name).iterdir()), [])
        self.assertEqual((await self.plugin.get_url_input_status(session['session_id']))['status'], 'waiting')
        with self.post(session['url'], 'https://still-works.example/'):
            pass

    async def test_uploading_status_keeps_listener_open_and_url_cannot_win_upload_race(self):
        session = await self.plugin.start_url_input()
        self.plugin._phone._receiving = True
        self.assertEqual(await self.plugin.get_url_input_status(session['session_id']), {'status': 'uploading'})
        self.assertTrue(self.plugin._phone._thread.is_alive())
        with self.assertRaises(HTTPError) as caught:
            self.post(session['url'], 'https://race.example/')
        self.assertEqual(caught.exception.code, 409)
        self.plugin._phone._receiving = False

    async def test_rejects_unsafe_urls_without_consuming_session(self):
        session = await self.plugin.start_url_input()
        for value in ['javascript:alert(1)', 'file:///etc/passwd', 'ftp://example.com', 'https://', 'https://user:pass@example.com', 'https://bad port/', '', 'x' * 4097]:
            with self.subTest(value=value[:40]), self.assertRaises(HTTPError) as caught:
                self.post(session['url'], value)
            self.assertEqual(caught.exception.code, 400)
        self.assertEqual((await self.plugin.get_url_input_status(session['session_id']))['status'], 'waiting')

    async def test_session_accepts_only_one_submission(self):
        session = await self.plugin.start_url_input()
        with self.post(session['url'], 'https://first.example/'):
            pass
        with self.assertRaises(HTTPError) as caught:
            self.post(session['url'], 'https://second.example/')
        self.assertEqual(caught.exception.code, 409)
        self.assertEqual((await self.plugin.get_url_input_status(session['session_id']))['url'], 'https://first.example/')

    async def test_unload_stops_listener_and_timer(self):
        await self.plugin.start_url_input()
        session = self.plugin._phone
        await self.plugin._unload()
        self.assertFalse(session._thread.is_alive())
        self.assertTrue(session._timer.finished.is_set())

    async def test_setup_failure_does_not_leave_a_session(self):
        with patch('main.lan_address', side_effect=ValueError('请连接 Wi-Fi')):
            with self.assertRaisesRegex(ValueError, 'Wi-Fi'):
                await self.plugin.start_url_input()
        self.assertIsNone(self.plugin._phone)

    async def test_bind_failure_is_readable(self):
        with patch('main.PhoneInputSession', side_effect=OSError('bind failed')):
            with self.assertRaisesRegex(ValueError, '检查网络'):
                await self.plugin.start_url_input()

    async def test_local_files_are_not_exposed_on_lan_listener(self):
        session = await self.plugin.start_url_input()
        origin = session['url'].rsplit('/', 1)[0]
        for route in ['/', '/file/anything', '/viewer/anything', '/state/anything', '/etc/passwd']:
            with self.subTest(route=route), self.assertRaises(HTTPError) as caught:
                urlopen(origin + route)
            self.assertEqual(caught.exception.code, 404)


class PhoneInputExpiryTests(unittest.TestCase):
    def test_expiry_automatically_closes_the_listener(self):
        session = PhoneInputSession('127.0.0.1', timeout=0.05)
        try:
            session._thread.join(timeout=2)
            self.assertFalse(session._thread.is_alive())
            self.assertEqual(session.status(), {'status': 'expired'})
        finally:
            session.close()

    def test_normalizes_web_addresses(self):
        self.assertEqual(normalize_url('  example.com/guide  '), 'https://example.com/guide')
        self.assertEqual(normalize_url('http://192.168.1.2:8000/a?b=1#c'), 'http://192.168.1.2:8000/a?b=1#c')
        for value in [None, 'https://example.com:bad/', 'https://example.com:99999/', 'https://example.com\\@evil.example', 'data:text/html,test']:
            with self.subTest(value=value), self.assertRaises(ValueError):
                normalize_url(value)

    def test_normalizes_search_text(self):
        self.assertEqual(normalize_search('  钥匙  '), '钥匙')
        self.assertEqual(normalize_search('x' * 200), 'x' * 200)
        for value in [None, '', '   ', 'x' * 201, '钥匙\n知识', 42]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                normalize_search(value)
