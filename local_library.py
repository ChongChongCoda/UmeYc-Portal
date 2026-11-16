"""Local browsing and deletion of explicitly listed user files."""

from collections import OrderedDict
import os
from pathlib import Path
import secrets


class LocalLibrary:
    def __init__(self, extensions):
        self.extensions = extensions
        self._deletions = OrderedDict()

    @staticmethod
    def _identity(path):
        info = path.stat()
        return (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns)

    @staticmethod
    def _user_file(path):
        home = Path(os.environ.get("DECKY_USER_HOME", "/home/deck")).resolve()
        if path.is_relative_to(home):
            return True
        return path.is_relative_to(Path('/run/media'))

    def list(self, directory):
        if not isinstance(directory, str) or not Path(directory).is_absolute():
            raise ValueError("请选择本地文件夹")
        root = Path(directory).resolve(strict=True)
        if not root.is_dir():
            raise ValueError("请选择文件夹")
        children = []
        for path in root.iterdir():
            try:
                if path.name.startswith('.'):
                    continue
                folder = path.is_dir()
                if not folder and (path.suffix.lower() not in self.extensions or not path.is_file()):
                    continue
                children.append((not folder, path.name.casefold(), path, folder))
            except OSError:
                continue
        entries = []
        for _, _, path, folder in sorted(children)[:500]:
            token = None
            try:
                if not folder and not path.is_symlink() and self._user_file(path):
                    token = secrets.token_urlsafe(24)
                    self._deletions[token] = (path, self._identity(path))
                entries.append({"name": path.name, "path": str(path), "directory": folder,
                                "delete_token": token})
            except OSError:
                continue
        while len(self._deletions) > 2048:
            self._deletions.popitem(last=False)
        return {"directory": str(root), "parent": str(root.parent), "entries": entries,
                "truncated": len(children) > 500}

    def delete(self, token):
        granted = self._deletions.get(token)
        if granted is None:
            raise ValueError("文件列表已更新，请重新选择要删除的文件")
        path, identity = granted
        # Replacing a file or a parent with a symlink must never redirect a deletion.
        if path.is_symlink() or path.resolve(strict=True) != path or self._identity(path) != identity:
            raise ValueError("文件已变化，请刷新列表后重新确认")
        if path.suffix.lower() not in self.extensions or not self._user_file(path):
            raise ValueError("只能删除已选择的本地攻略文件")
        path.unlink()
        self._deletions.pop(token, None)
        return str(path)
