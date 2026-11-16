"""Bounded, streamed image uploads into a Deck-selected directory."""

import os
from pathlib import Path
import re
import shutil


MAX_IMAGE_BYTES = 64 * 1024 * 1024
IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".avif", ".ico"}


def sd_mounts():
    roots = [Path("/run/media/deck"), Path("/run/media")]
    return sorted({child for root in roots if root.is_dir() for child in root.iterdir()
                   if child.is_dir() and os.path.ismount(child)})


def upload_destination(preferred=""):
    if not isinstance(preferred, str):
        raise ValueError("请在 Deck 上重新选择图片保存位置")
    if preferred:
        if not Path(preferred).is_absolute():
            raise ValueError("请在 Deck 上重新选择图片保存位置")
        try:
            selected = Path(preferred).resolve(strict=True)
        except OSError as error:
            raise ValueError("图片保存位置不可用，请插卡或重新选择文件夹") from error
        if not selected.is_dir():
            raise ValueError("图片保存位置不是文件夹，请重新选择")
        mount = media_mount(selected)
        if mount is not None and not os.path.ismount(mount):
            raise ValueError("所选 SD 卡未挂载，请插卡或重新选择图片保存位置")
        return selected
    mounts = sd_mounts()
    if mounts:
        return mounts[0] / "UmeYc-Portal" / "uploads"
    return Path(os.environ.get("DECKY_USER_HOME", "/home/deck")) / "Pictures" / "UmeYc-Portal"


def media_mount(path):
    for root in [Path("/run/media/deck"), Path("/run/media")]:
        try:
            relative = path.relative_to(root)
        except ValueError:
            continue
        if relative.parts:
            return root / relative.parts[0]
    return None


def image_name(filename):
    if not isinstance(filename, str):
        raise ValueError("请选择图片")
    name = filename.replace("\\", "/").rsplit("/", 1)[-1]
    name = re.sub(r"[\x00-\x1f\x7f]", "_", name).strip()
    suffix = Path(name).suffix.lower()
    if suffix not in IMAGE_SUFFIXES:
        raise ValueError("支持 JPG、PNG、GIF、WebP、BMP、AVIF 和 ICO 图片")
    # Bound filesystem component bytes while preserving Chinese names and extension.
    stem = Path(name).stem.strip(". ") or "图片"
    while len((stem + suffix).encode("utf-8")) > 200:
        stem = stem[:-1]
    return stem + suffix


def matches_image(header, suffix):
    return {
        ".jpg": header.startswith(b"\xff\xd8\xff"),
        ".jpeg": header.startswith(b"\xff\xd8\xff"),
        ".png": header.startswith(b"\x89PNG\r\n\x1a\n"),
        ".gif": header.startswith((b"GIF87a", b"GIF89a")),
        ".webp": header.startswith(b"RIFF") and header[8:12] == b"WEBP",
        ".bmp": header.startswith(b"BM"),
        ".ico": header.startswith(b"\x00\x00\x01\x00"),
        ".avif": header[4:8] == b"ftyp" and any(
            header[i:i + 4] in {b"avif", b"avis"} for i in range(8, len(header) - 3, 4)
        ),
    }.get(suffix, False)


def ensure_upload_directory(directory):
    mount = media_mount(directory)
    if mount is not None and not os.path.ismount(mount):
        raise ValueError("SD 卡已断开，请插卡或重新选择图片保存位置")
    missing = []
    parent = directory
    while not parent.exists():
        missing.append(parent)
        parent = parent.parent
    directory.mkdir(parents=True, exist_ok=True)
    owner = Path(os.environ.get("DECKY_USER_HOME", "/home/deck"))
    user = owner.stat() if os.geteuid() == 0 and owner.is_dir() else None
    if user is not None:
        for created in missing:
            os.chown(created, user.st_uid, user.st_gid)
    return user


def save_image(directory, filename, stream, length, check_active):
    name = image_name(filename)
    if not 0 < length <= MAX_IMAGE_BYTES:
        raise ValueError("请选择不超过 64 MB 的图片")
    check_active()
    user = ensure_upload_directory(directory)
    if shutil.disk_usage(directory).free < length + 1024 * 1024:
        raise ValueError("保存位置空间不足，请清理空间或选择其他文件夹")
    target = None
    handle = None
    try:
        for index in range(1, 10001):
            candidate = directory / (name if index == 1 else f"{Path(name).stem} ({index}){Path(name).suffix}")
            try:
                handle = candidate.open("xb")
                target = candidate
                if user is not None:
                    os.fchown(handle.fileno(), user.st_uid, user.st_gid)
                break
            except FileExistsError:
                continue
        if handle is None:
            raise ValueError("同名图片过多，请更换文件名")
        with handle:
            remaining = length
            first = True
            while remaining:
                check_active()
                chunk = stream.read(min(64 * 1024, remaining))
                if not chunk:
                    raise ValueError("图片传输中断，请重新上传")
                if first and not matches_image(chunk[:64], target.suffix):
                    raise ValueError("文件内容与图片格式不符，请重新选择图片")
                first = False
                handle.write(chunk)
                remaining -= len(chunk)
        check_active()
        return target.resolve()
    except BaseException:
        if handle is not None and not handle.closed:
            handle.close()
        if target is not None:
            target.unlink(missing_ok=True)
        raise
