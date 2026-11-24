"""Fetch the latest UmeYc-Portal release ZIP into the Deck's Downloads folder.

The plugin never installs the ZIP itself. It validates the download, replaces
the previous UmeYc-Portal.zip, and leaves installation to Decky's ZIP picker.
"""

import json
import os
from pathlib import Path
import re
import threading
from urllib.parse import urlsplit
import urllib.error
import urllib.request
import zipfile


REPOSITORY = "ChongChongCoda/UmeYc-Portal"
RELEASE_API = f"https://api.github.com/repos/{REPOSITORY}/releases/latest"
DIRECT_LATEST = (
    f"https://github.com/{REPOSITORY}/releases/latest/download/UmeYc-Portal.zip"
)
ASSET_NAME = "UmeYc-Portal.zip"
TAG_PATTERN = re.compile(r"^fork-1\.0\.0-zh-cn\.(\d+)$")
VERSION_PATTERN = re.compile(r"-zh-cn\.(\d+)$")
MAX_BYTES = 20 * 1024 * 1024
API_TIMEOUT = 10
DOWNLOAD_TIMEOUT = 60
ALLOWED_HOSTS = {
    "github.com",
    "api.github.com",
    "objects.githubusercontent.com",
    "release-assets.githubusercontent.com",
}
DOWNLOAD_PATH_PREFIX = f"/{REPOSITORY}/releases/download/"
USER_AGENT = "UmeYc-Portal-UpdateChecker"

_lock = threading.Lock()


class UpdateError(Exception):
    pass


def current_version():
    package = Path(__file__).resolve().with_name("package.json")
    try:
        data = json.loads(package.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise UpdateError("无法读取当前插件版本") from error
    version = data.get("version")
    if not isinstance(version, str):
        raise UpdateError("当前插件版本无效")
    return version


def version_number(value):
    if not isinstance(value, str):
        return None
    match = VERSION_PATTERN.search(value)
    return int(match.group(1)) if match else None


def downloads_directory():
    home = os.environ.get("DECKY_USER_HOME") or str(Path.home())
    return Path(home) / "Downloads"


def _open(url, headers=None, timeout=API_TIMEOUT):
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "application/vnd.github+json",
            **(headers or {}),
        },
    )
    return urllib.request.urlopen(request, timeout=timeout)


def _trusted_download_url(url):
    try:
        parsed = urlsplit(url)
    except ValueError:
        return False
    return (
        parsed.scheme == "https"
        and parsed.hostname in ALLOWED_HOSTS
        and parsed.path.startswith(DOWNLOAD_PATH_PREFIX)
    )


def _release_from_payload(payload):
    if not isinstance(payload, dict):
        raise UpdateError("GitHub 返回了无法识别的版本信息")
    tag = payload.get("tag_name")
    match = TAG_PATTERN.fullmatch(tag) if isinstance(tag, str) else None
    if match is None:
        raise UpdateError("最新发布不是 UmeYc-Portal 的版本")
    assets = payload.get("assets")
    asset = None
    if isinstance(assets, list):
        asset = next(
            (
                item
                for item in assets
                if isinstance(item, dict) and item.get("name") == ASSET_NAME
            ),
            None,
        )
    if asset is None:
        raise UpdateError("最新发布里没有 UmeYc-Portal.zip")
    url = asset.get("browser_download_url")
    if not isinstance(url, str) or not _trusted_download_url(url):
        raise UpdateError("最新发布里的下载地址无效")
    return {
        "tag": tag,
        "version": tag[len("fork-"):],
        "number": int(match.group(1)),
        "url": url,
        "size": asset.get("size"),
    }


def latest_release():
    try:
        with _open(RELEASE_API) as response:
            payload = json.load(response)
        return _release_from_payload(payload)
    except UpdateError:
        raise
    except (OSError, ValueError, urllib.error.URLError) as error:
        # The API is rate-limited on some networks. The direct releases/latest
        # URL still serves the asset, so fall back to inspecting the ZIP.
        return {
            "tag": None,
            "version": None,
            "number": None,
            "url": DIRECT_LATEST,
            "size": None,
        }


def validate_zip(path):
    try:
        with zipfile.ZipFile(path) as archive:
            if archive.testzip() is not None:
                raise UpdateError("下载的更新包已损坏")
            names = set(archive.namelist())
            required = {
                "UmeYc-Portal/package.json",
                "UmeYc-Portal/main.py",
                "UmeYc-Portal/dist/index.js",
            }
            if not required.issubset(names):
                raise UpdateError("下载的更新包不完整")
            payload = json.loads(archive.read("UmeYc-Portal/package.json").decode("utf-8"))
    except (OSError, ValueError, zipfile.BadZipFile) as error:
        raise UpdateError("下载的更新包无法读取") from error
    version = payload.get("version") if isinstance(payload, dict) else None
    if not isinstance(version, str) or version_number(version) is None:
        raise UpdateError("下载的更新包版本无效")
    return version


def _fetch_to_part(url, part, expected_version=None):
    part.parent.mkdir(parents=True, exist_ok=True)
    part.unlink(missing_ok=True)
    size = 0
    try:
        with _open(url, headers={"Accept": "application/octet-stream"},
                   timeout=DOWNLOAD_TIMEOUT) as response:
            final = urlsplit(response.geturl())
            if final.scheme != "https" or final.hostname not in ALLOWED_HOSTS:
                raise UpdateError("更新包跳转到了不受信任的站点")
            length = response.headers.get("Content-Length")
            if length is not None:
                try:
                    if int(length) > MAX_BYTES:
                        raise UpdateError("更新包超过大小限制")
                except ValueError:
                    pass
            with part.open("wb") as handle:
                while True:
                    chunk = response.read(64 * 1024)
                    if not chunk:
                        break
                    size += len(chunk)
                    if size > MAX_BYTES:
                        raise UpdateError("更新包超过大小限制")
                    handle.write(chunk)
        if size == 0:
            raise UpdateError("下载内容为空")
        version = validate_zip(part)
        if expected_version is not None and version != expected_version:
            raise UpdateError("下载的版本与发布信息不一致")
        return size, version
    except BaseException:
        part.unlink(missing_ok=True)
        raise


def check_and_download():
    with _lock:
        current = current_version()
        current_number = version_number(current)
        if current_number is None:
            raise UpdateError("无法识别当前插件版本")
        release = latest_release()
        if (
            release["number"] is not None
            and release["number"] <= current_number
        ):
            return {
                "status": "latest",
                "current": current,
                "version": release["version"],
            }

        target = downloads_directory() / ASSET_NAME
        if release["number"] is not None and target.is_file():
            try:
                existing = validate_zip(target)
            except UpdateError:
                existing = None
            if existing == release["version"]:
                return {
                    "status": "ready",
                    "current": current,
                    "version": existing,
                    "path": str(target),
                    "size": target.stat().st_size,
                    "replaced": False,
                }

        part = target.with_name(target.name + ".part")
        try:
            size, version = _fetch_to_part(
                release["url"], part, expected_version=release["version"])
            downloaded_number = version_number(version)
            if downloaded_number is None or downloaded_number <= current_number:
                part.unlink(missing_ok=True)
                return {
                    "status": "latest",
                    "current": current,
                    "version": version,
                }
            replaced = target.exists()
            target.unlink(missing_ok=True)
            os.replace(part, target)
            return {
                "status": "downloaded",
                "current": current,
                "version": version,
                "path": str(target),
                "size": size,
                "replaced": replaced,
            }
        except UpdateError:
            part.unlink(missing_ok=True)
            raise
        except (OSError, urllib.error.URLError) as error:
            part.unlink(missing_ok=True)
            raise UpdateError("无法下载更新包，请检查 Deck 网络后重试") from error
