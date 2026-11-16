import io
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from image_upload import MAX_IMAGE_BYTES, save_image, upload_destination


class ImageUploadTests(unittest.TestCase):
    def setUp(self):
        self.temporary = TemporaryDirectory()
        self.directory = Path(self.temporary.name).resolve()
        self.image = b'\x89PNG\r\n\x1a\n' + b'x' * 100

    def tearDown(self):
        self.temporary.cleanup()

    def save(self, name='攻略.png', stream=None, length=None, active=lambda: None):
        return save_image(self.directory, name, stream or io.BytesIO(self.image),
                          len(self.image) if length is None else length, active)

    def test_names_are_confined_and_collisions_preserve_existing_file(self):
        first = self.save('../../攻略.png')
        second = self.save('C:\\tmp\\攻略.png')
        self.assertEqual(first, self.directory / '攻略.png')
        self.assertEqual(second.name, '攻略 (2).png')
        self.assertEqual(first.read_bytes(), self.image)
        self.assertEqual(second.read_bytes(), self.image)

    def test_invalid_image_size_truncation_and_cancellation_leave_no_partial_file(self):
        for kwargs in [dict(length=MAX_IMAGE_BYTES + 1), dict(name='a.html'),
                       dict(stream=io.BytesIO(b'invalid')), dict(length=len(self.image) + 10)]:
            with self.subTest(kwargs=kwargs), self.assertRaises(ValueError):
                self.save(**kwargs)
            self.assertEqual(list(self.directory.iterdir()), [])
        calls = 0
        def cancel_after_write():
            nonlocal calls
            calls += 1
            if calls >= 3:
                raise TimeoutError()
        with self.assertRaises(TimeoutError):
            self.save(active=cancel_after_write)
        self.assertEqual(list(self.directory.iterdir()), [])

    def test_upload_uses_bounded_reads_and_handles_long_chinese_names(self):
        class Stream(io.BytesIO):
            def read(self, size=-1):
                if not 0 < size <= 65536:
                    raise AssertionError(size)
                return super().read(size)
        image = self.image * 1000
        path = self.save(name='中文' * 100 + '.png', stream=Stream(image), length=len(image))
        self.assertLessEqual(len(path.name.encode()), 200)
        self.assertEqual(path.read_bytes(), image)

    def test_automatic_destination_prefers_sd_and_falls_back_to_internal(self):
        with patch('image_upload.sd_mounts', return_value=[Path('/run/media/deck/SD')]):
            self.assertEqual(upload_destination(), Path('/run/media/deck/SD/UmeYc-Portal/uploads'))
        with patch('image_upload.sd_mounts', return_value=[]), patch.dict('os.environ', {'DECKY_USER_HOME': str(self.directory)}):
            self.assertEqual(upload_destination(), self.directory / 'Pictures/UmeYc-Portal')
        self.assertEqual(upload_destination(str(self.directory)), self.directory)
        with self.assertRaises(ValueError):
            upload_destination(str(self.directory / 'missing'))

    def test_unmounted_sd_is_not_recreated_on_internal_storage(self):
        with patch('image_upload.media_mount', return_value=Path('/run/media/deck/SD')), \
             patch('image_upload.os.path.ismount', return_value=False):
            with self.assertRaisesRegex(ValueError, 'SD 卡'):
                self.save()
        self.assertEqual(list(self.directory.iterdir()), [])


if __name__ == '__main__':
    unittest.main()
