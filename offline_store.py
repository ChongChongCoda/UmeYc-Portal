"""Saved offline web collections, stored beside uploaded guide files.

Each collection is one directory under ``<upload directory>/offline``:

    <id>/
      manifest.json   title, source URL, page list and per-page status
      ...             saved pages and their resources

The library never accepts a path from the frontend: listing issues
capability tokens, and opening or deleting is only possible with a token
that still matches the collection's on-disk identity.
"""

from collections import OrderedDict
import json
from pathlib import Path
import secrets
import shutil
import tempfile
import time
from urllib.parse import urlsplit


MANIFEST_NAME = "manifest.json"
MANIFEST_VERSION = 1
MAX_TITLE_LENGTH = 200


class OfflineLibrary:
    def __init__(self):
        self._delete_grants = OrderedDict()
        self._open_grants = OrderedDict()

    @staticmethod
    def root(directory):
        if not isinstance(directory, str) or not directory:
            raise ValueError("请先选择离线保存位置")
        base = Path(directory)
        if not base.is_absolute():
            raise ValueError("请选择离线保存位置")
        try:
            base = base.resolve(strict=True)
        except OSError as error:
            raise ValueError("离线保存位置不可用，请插卡或重新选择文件夹") from error
        if not base.is_dir():
            raise ValueError("离线保存位置不是文件夹")
        root = base / "offline"
        try:
            root.mkdir(exist_ok=True)
        except OSError as error:
            raise ValueError("无法创建离线网页目录，请检查剩余空间") from error
        return root

    @staticmethod
    def _identity(path):
        info = path.stat()
        return (info.st_dev, info.st_ino)

    @staticmethod
    def _title(value):
        if not isinstance(value, str):
            return "未命名网页"
        cleaned = "".join(
            character for character in value if character >= " " and character != "\x7f"
        ).strip()
        return cleaned[:MAX_TITLE_LENGTH] or "未命名网页"

    @staticmethod
    def _source_url(value):
        if not isinstance(value, str):
            raise ValueError("请输入网页地址")
        value = value.strip()
        if not value or len(value) > 8192:
            raise ValueError("请输入有效网址")
        try:
            parsed = urlsplit(value)
        except ValueError as error:
            raise ValueError("请输入有效网址") from error
        if parsed.scheme not in {"http", "https"} or not parsed.hostname:
            raise ValueError("仅支持 http:// 或 https:// 网页地址")
        return value

    @staticmethod
    def _read_manifest(path):
        try:
            manifest = json.loads((path / MANIFEST_NAME).read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None
        if not isinstance(manifest, dict) or manifest.get("version") != MANIFEST_VERSION:
            return None
        if manifest.get("id") != path.name or not isinstance(manifest.get("pages"), list):
            return None
        return manifest

    @staticmethod
    def _write_manifest(path, manifest):
        payload = json.dumps(manifest, ensure_ascii=False, indent=2) + "\n"
        handle, temporary = tempfile.mkstemp(dir=path, prefix=".manifest-", suffix=".tmp")
        try:
            with open(handle, "w", encoding="utf-8") as destination:
                destination.write(payload)
                destination.flush()
            Path(temporary).replace(path / MANIFEST_NAME)
        except BaseException:
            Path(temporary).unlink(missing_ok=True)
            raise

    def create(self, directory, title, url, options=None):
        """Create an empty collection and return its id, path and manifest."""
        root = self.root(directory)
        source = self._source_url(url)
        stamp = time.strftime("%Y%m%d-%H%M%S", time.localtime())
        for _ in range(8):
            identifier = f"{stamp}-{secrets.token_hex(3)}"
            path = root / identifier
            try:
                path.mkdir()
                break
            except FileExistsError:
                continue
        else:
            raise ValueError("无法创建离线目录，请重试")
        manifest = {
            "version": MANIFEST_VERSION,
            "id": identifier,
            "title": self._title(title),
            "url": source,
            "created_at": int(time.time()),
            "options": options if isinstance(options, dict) else {},
            "status": "empty",
            "pages": [],
        }
        try:
            self._write_manifest(path, manifest)
        except BaseException:
            shutil.rmtree(path, ignore_errors=True)
            raise
        return {"id": identifier, "directory": str(path), "manifest": manifest}

    def write(self, directory, identifier, manifest):
        """Replace a collection manifest after adding a page."""
        root = self.root(directory)
        if not isinstance(identifier, str) or not identifier:
            raise ValueError("离线网页无效")
        path = root / identifier
        if path.is_symlink() or not path.is_dir() or path.parent != root:
            raise ValueError("离线网页不存在")
        current = self._read_manifest(path)
        if current is None:
            raise ValueError("离线网页已损坏，请删除后重新保存")
        if not isinstance(manifest, dict) or manifest.get("version") != MANIFEST_VERSION:
            raise ValueError("离线网页数据无效")
        manifest["id"] = identifier
        manifest["created_at"] = current.get("created_at") or manifest.get("created_at") or 0
        self._write_manifest(path, manifest)
        return manifest

    def list(self, directory):
        root = self.root(directory)
        entries = []
        for path in root.iterdir():
            if path.is_symlink() or not path.is_dir():
                continue
            manifest = self._read_manifest(path)
            if manifest is None:
                continue
            try:
                created_at = int(manifest.get("created_at") or 0)
            except (TypeError, ValueError):
                created_at = 0
            entries.append(
                {
                    "id": path.name,
                    "title": self._title(manifest.get("title")),
                    "url": manifest.get("url") or "",
                    "created_at": created_at,
                    "pages": len(manifest.get("pages") or []),
                    "status": manifest.get("status") or "saved",
                    "open_token": self._open_token(root, path),
                    "delete_token": self._delete_token(root, path),
                }
            )
        entries.sort(key=lambda entry: entry["created_at"], reverse=True)
        while len(self._delete_grants) > 2048:
            self._delete_grants.popitem(last=False)
        return {"directory": str(root), "entries": entries}

    def _open_token(self, root, path):
        for token, granted in self._open_grants.items():
            if granted[1] == path:
                return token
        token = secrets.token_urlsafe(32)
        self._open_grants[token] = (root, path, self._identity(path))
        while len(self._open_grants) > 1024:
            self._open_grants.popitem(last=False)
        return token

    def _delete_token(self, root, path):
        token = secrets.token_urlsafe(32)
        self._delete_grants[token] = (root, path, self._identity(path))
        return token

    def _granted(self, token, grants):
        if not isinstance(token, str):
            raise ValueError("离线网页无效")
        granted = grants.get(token)
        if granted is None:
            raise ValueError("离线网页列表已更新，请重新选择")
        root, path, identity = granted
        if path.is_symlink() or path.parent != root or not path.is_dir():
            raise ValueError("离线网页已变化，请刷新后重试")
        try:
            current = self._identity(path)
        except OSError as error:
            raise ValueError("离线网页已变化，请刷新后重试") from error
        if current != identity or self._read_manifest(path) is None:
            raise ValueError("离线网页已变化，请刷新后重试")
        return path

    def authorize(self, token):
        """Resolve a stable open token to a collection directory."""
        return self._granted(token, self._open_grants)

    def delete(self, token):
        path = self._granted(token, self._delete_grants)
        manifest = self._read_manifest(path)
        if manifest is None:
            raise ValueError("离线网页已损坏，请刷新后重试")
        shutil.rmtree(path)
        self.forget(path)
        self._delete_grants.pop(token, None)
        return {
            "id": path.name,
            "title": self._title(manifest.get("title")),
            "directory": str(path),
        }

    def forget(self, path):
        path = Path(path)
        for grants in (self._open_grants, self._delete_grants):
            for token, granted in list(grants.items()):
                if granted[1] == path:
                    grants.pop(token, None)
