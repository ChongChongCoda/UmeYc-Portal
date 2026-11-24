"""Move plugin-managed images and offline web collections to a new save root.

Only two kinds of content are considered: top-level supported image files and
``offline/<collection>`` directories that contain a valid manifest. Other
files, subdirectories and hidden entries are never touched. Each item is moved
atomically when possible; when the move fails, the source is left in place and
the failure is reported instead of being silently discarded.
"""

import json
import os
from pathlib import Path
import secrets
import shutil
import tempfile
import threading
import time

from image_upload import IMAGE_SUFFIXES, media_mount


MANIFEST_NAME = "manifest.json"
FREE_SPACE_MARGIN = 64 * 1024 * 1024


class MigrationError(ValueError):
    pass


def _resolve_directory(value, label):
    if not isinstance(value, str) or not value:
        raise MigrationError(f"请选择{label}")
    path = Path(value)
    if not path.is_absolute():
        raise MigrationError(f"请选择{label}")
    try:
        path = path.resolve(strict=True)
    except OSError as error:
        raise MigrationError(f"{label}不可用，请插卡或重新选择文件夹") from error
    if not path.is_dir():
        raise MigrationError(f"{label}不是文件夹")
    mount = media_mount(path)
    if mount is not None and not os.path.ismount(mount):
        raise MigrationError("所选 SD 卡未挂载，请插卡或重新选择保存位置")
    return path


def scan(root):
    """Return managed images and collection directories under one save root."""
    images = []
    collections = []
    if root is None or not root.is_dir() or root.is_symlink():
        return images, collections
    try:
        children = list(root.iterdir())
    except OSError:
        return images, collections
    for path in children:
        try:
            if path.name.startswith(".") or path.is_symlink() or not path.is_file():
                continue
            if path.suffix.lower() in IMAGE_SUFFIXES:
                images.append(path)
        except OSError:
            continue
    offline = root / "offline"
    if offline.is_dir() and not offline.is_symlink():
        try:
            children = list(offline.iterdir())
        except OSError:
            children = []
        for path in children:
            try:
                if path.is_symlink() or not path.is_dir():
                    continue
                if (path / MANIFEST_NAME).is_file() and not (path / MANIFEST_NAME).is_symlink():
                    collections.append(path)
            except OSError:
                continue
    return sorted(images, key=lambda item: item.name), sorted(collections, key=lambda item: item.name)


def tree_size(path):
    if path.is_file():
        try:
            return path.stat().st_size
        except OSError:
            return 0
    total = 0
    for current, directories, files in os.walk(path):
        directories[:] = [name for name in directories if not os.path.islink(os.path.join(current, name))]
        for name in files:
            item = os.path.join(current, name)
            if os.path.islink(item):
                continue
            try:
                total += os.stat(item).st_size
            except OSError:
                continue
    return total


def plan_migration(old, new):
    """Validate two save roots and report what a migration would move."""
    new_path = _resolve_directory(new, "保存位置")
    if not os.access(new_path, os.W_OK):
        raise MigrationError("保存位置不可写，请重新选择文件夹")
    old_path = None
    if isinstance(old, str) and old:
        try:
            candidate = Path(old)
            if candidate.is_absolute():
                old_path = candidate.resolve(strict=True)
        except OSError:
            old_path = None
    if new_path == old_path:
        return {
            "old": str(old_path) if old_path else "",
            "new": str(new_path),
            "images": 0,
            "collections": 0,
            "total": 0,
            "bytes": 0,
            "conflicts": 0,
            "same_device": True,
        }
    if old_path is not None and (
        new_path.is_relative_to(old_path) or old_path.is_relative_to(new_path)
    ):
        raise MigrationError("新保存位置不能位于旧保存位置内部，或反过来包含旧保存位置")
    images, collections = scan(old_path)
    offline_target = new_path / "offline"
    if offline_target.exists() and not offline_target.is_dir():
        raise MigrationError("新保存位置存在同名 offline 文件，无法迁移")
    total = len(images) + len(collections)
    size = sum(tree_size(path) for path in images) + sum(tree_size(path) for path in collections)
    conflicts = 0
    for path in images:
        if (new_path / path.name).exists() or (new_path / path.name).is_symlink():
            conflicts += 1
    for path in collections:
        if (new_path / "offline" / path.name).exists():
            conflicts += 1
    same_device = True
    if old_path is not None:
        try:
            same_device = os.stat(old_path).st_dev == os.stat(new_path).st_dev
        except OSError:
            same_device = False
    if not same_device and shutil.disk_usage(new_path).free < size + FREE_SPACE_MARGIN:
        raise MigrationError("目标保存位置空间不足，请清理空间或选择其他文件夹")
    return {
        "old": str(old_path) if old_path else "",
        "new": str(new_path),
        "images": len(images),
        "collections": len(collections),
        "total": total,
        "bytes": size,
        "conflicts": conflicts,
        "same_device": same_device,
    }


def _unique_path(directory, name):
    stem = Path(name).stem
    suffix = Path(name).suffix
    candidate = directory / name
    index = 1
    while candidate.exists() or candidate.is_symlink():
        candidate = directory / f"{stem} ({index}){suffix}"
        index += 1
        if index > 10000:
            raise MigrationError("同名文件过多，请更换文件名")
    return candidate


def _unique_directory(directory, name):
    candidate = directory / name
    index = 1
    while candidate.exists() or candidate.is_symlink():
        candidate = directory / f"{name}-{index}"
        index += 1
        if index > 10000:
            raise MigrationError("同名离线网页过多")
    return candidate


def _copy_file(source, target):
    temporary = target.with_name(f".{target.name}.portal-migrating-{secrets.token_hex(4)}")
    try:
        shutil.copy2(source, temporary)
        os.replace(temporary, target)
        source.unlink()
    except BaseException:
        temporary.unlink(missing_ok=True)
        raise


def _copy_directory(source, target):
    temporary = target.parent / f".portal-migrating-{secrets.token_hex(4)}"
    try:
        shutil.copytree(source, temporary, symlinks=True, copy_function=shutil.copy2)
        os.replace(temporary, target)
        shutil.rmtree(source)
    except BaseException:
        shutil.rmtree(temporary, ignore_errors=True)
        raise


def _check_tree(source):
    for current, directories, files in os.walk(source):
        for name in directories + files:
            if os.path.islink(os.path.join(current, name)):
                raise MigrationError("离线网页包含符号链接，为避免越界未迁移")


def _read_manifest(path):
    try:
        manifest = json.loads((path / MANIFEST_NAME).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return manifest if isinstance(manifest, dict) else None


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


class StorageMigration:
    """One background migration job with progress, cancellation and a report."""

    def __init__(self, old, new):
        self.plan = plan_migration(old, new)
        self.old = Path(self.plan["old"]) if self.plan["old"] else None
        self.new = Path(self.plan["new"])
        images, collections = scan(self.old)
        self.items = [("image", path) for path in images] + [
            ("collection", path) for path in collections
        ]
        self.sizes = [tree_size(path) for _, path in self.items]
        self._lock = threading.Lock()
        self._cancel = threading.Event()
        self._thread = None
        self.status = "running"
        self.current = ""
        self.done_items = 0
        self.done_bytes = 0
        self.bytes_total = sum(self.sizes)
        self.errors = []
        self.moved_images = []
        self.moved_collections = []
        self.started_at = int(time.time())
        self.finished_at = None

    def start(self):
        self._thread = threading.Thread(target=self.run, daemon=True)
        self._thread.start()
        return self

    def cancel(self):
        self._cancel.set()

    def snapshot(self):
        with self._lock:
            return {
                "status": self.status,
                "old": str(self.old) if self.old else "",
                "new": str(self.new),
                "current": self.current,
                "total_items": len(self.items),
                "done_items": self.done_items,
                "bytes_total": self.bytes_total,
                "bytes_done": self.done_bytes,
                "errors": list(self.errors),
                "images": list(self.moved_images),
                "collections": list(self.moved_collections),
                "started_at": self.started_at,
                "finished_at": self.finished_at,
            }

    def run(self):
        final = "done"
        try:
            for index, (kind, source) in enumerate(self.items):
                if self._cancel.is_set():
                    final = "cancelled"
                    break
                with self._lock:
                    self.current = source.name
                try:
                    if kind == "image":
                        target = self._move_image(source)
                        with self._lock:
                            self.moved_images.append({"from": str(source), "to": str(target)})
                    else:
                        target, identifier, title = self._move_collection(source)
                        with self._lock:
                            self.moved_collections.append(
                                {
                                    "from": source.name,
                                    "to": identifier,
                                    "title": title,
                                    "directory": str(target),
                                }
                            )
                except Exception as error:  # noqa: BLE001 - report every failed item
                    with self._lock:
                        self.errors.append({"path": str(source), "message": str(error)})
                finally:
                    with self._lock:
                        self.done_items += 1
                        self.done_bytes += self.sizes[index]
                        self.current = ""
            if final == "done":
                offline = self.old / "offline" if self.old else None
                if offline is not None and offline.is_dir():
                    try:
                        offline.rmdir()
                    except OSError:
                        pass
        except Exception as error:  # noqa: BLE001 - keep a terminal state
            with self._lock:
                self.errors.append({"path": "", "message": str(error)})
            final = "failed"
        finally:
            with self._lock:
                if self._cancel.is_set() and final == "done":
                    final = "cancelled"
                self.status = final
                self.finished_at = int(time.time())

    def _move_image(self, source):
        target = _unique_path(self.new, source.name)
        try:
            if source.stat().st_dev == target.parent.stat().st_dev:
                os.rename(source, target)
                return target
        except OSError:
            pass
        _copy_file(source, target)
        return target

    def _move_collection(self, source):
        destination = self.new / "offline"
        destination.mkdir(exist_ok=True)
        _check_tree(source)
        identifier = _unique_directory(destination, source.name).name
        target = destination / identifier
        manifest = _read_manifest(source)
        if manifest is None:
            raise MigrationError("离线网页缺少有效的 manifest，未迁移")
        title = manifest.get("title") or identifier
        moved = False
        if identifier == source.name:
            try:
                if source.stat().st_dev == destination.stat().st_dev:
                    os.rename(source, target)
                    moved = True
            except OSError:
                moved = False
        if not moved:
            temporary = destination / f".portal-migrating-{secrets.token_hex(4)}"
            try:
                shutil.copytree(source, temporary, symlinks=True, copy_function=shutil.copy2)
                manifest["id"] = identifier
                _write_manifest(temporary, manifest)
                os.replace(temporary, target)
                shutil.rmtree(source)
            except BaseException:
                shutil.rmtree(temporary, ignore_errors=True)
                raise
        return target, identifier, title
