import os
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from local_library import LocalLibrary


class LocalLibraryTests(unittest.TestCase):
    def setUp(self):
        self.temporary = TemporaryDirectory()
        self.root = Path(self.temporary.name).resolve()
        self.owner = patch.dict(os.environ, {'DECKY_USER_HOME': str(self.root)})
        self.owner.start()
        self.library = LocalLibrary({'.png', '.jpg', '.txt'})
        self.file = self.root / '中文攻略.png'
        self.file.write_bytes(b'image')

    def tearDown(self):
        self.owner.stop()
        self.temporary.cleanup()

    def token(self):
        return next(e['delete_token'] for e in self.library.list(str(self.root))['entries'] if e['name'] == self.file.name)

    def test_lists_folders_and_supported_files_and_deletes_only_granted_file(self):
        (self.root / '下一章').mkdir()
        (self.root / 'keep.exe').write_bytes(b'keep')
        (self.root / '.hidden.png').write_bytes(b'keep')
        result = self.library.list(str(self.root))
        self.assertEqual([e['name'] for e in result['entries']], ['下一章', '中文攻略.png'])
        token = result['entries'][1]['delete_token']
        self.assertEqual(self.library.delete(token), str(self.file))
        self.assertFalse(self.file.exists())
        self.assertTrue((self.root / 'keep.exe').exists())
        with self.assertRaises(ValueError):
            self.library.delete(token)

    def test_modified_file_or_symlink_replacement_cannot_be_deleted_by_stale_grant(self):
        token = self.token()
        self.file.write_bytes(b'changed file')
        with self.assertRaisesRegex(ValueError, '已变化'):
            self.library.delete(token)
        token = self.token()
        other = self.root / 'other.png'
        other.write_bytes(b'keep')
        self.file.unlink()
        self.file.symlink_to(other)
        with self.assertRaisesRegex(ValueError, '已变化'):
            self.library.delete(token)
        self.assertTrue(other.exists())
        self.assertIsNone(next(e['delete_token'] for e in self.library.list(str(self.root))['entries'] if e['name'] == self.file.name))

    def test_unlisted_tokens_and_files_outside_user_storage_are_not_deletable(self):
        with self.assertRaises(ValueError):
            self.library.delete(str(self.file))
        with patch.dict(os.environ, {'DECKY_USER_HOME': str(self.root / 'other')}):
            self.assertIsNone(self.token())
        self.assertTrue(self.file.exists())


if __name__ == '__main__':
    unittest.main()
