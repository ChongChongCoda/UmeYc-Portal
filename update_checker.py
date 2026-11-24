"""Fetch the latest UmeYc-Portal release ZIP into the Deck's Downloads folder.

The plugin never installs the ZIP itself. It validates the download, replaces
the previous UmeYc-Portal.zip, and leaves installation to Decky's ZIP picker.
"""

import http.client
import ipaddress
import json
import os
from pathlib import Path
import re
import socket
import ssl
import sys
import threading
import time
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
    "github-releases.githubusercontent.com",
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


_ssl_context = None


def _ca_files():
    files = []
    try:
        import certifi
        files.append(certifi.where())
    except Exception:
        pass
    files.extend([
        "/etc/ssl/certs/ca-certificates.crt",
        "/etc/ssl/cert.pem",
        "/usr/lib/ssl/cert.pem",
        "/usr/local/etc/openssl/cert.pem",
    ])
    return [path for path in files if path and os.path.isfile(path)]


def _get_ssl_context():
    global _ssl_context
    if _ssl_context is None:
        context = ssl.create_default_context()
        for cafile in _ca_files():
            try:
                context.load_verify_locations(cafile=cafile)
            except (OSError, ssl.SSLError):
                pass
        _ssl_context = context
    return _ssl_context


def _open(url, headers=None, timeout=API_TIMEOUT, direct=False):
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "application/vnd.github+json",
            **(headers or {}),
        },
    )
    # Decky's bundled Python can miss the system CA bundle, and Decky's service
    # environment may carry a stale proxy that the desktop shell does not have.
    handlers = [urllib.request.HTTPSHandler(context=_get_ssl_context())]
    handlers.append(urllib.request.ProxyHandler({} if direct else None))
    opener = urllib.request.build_opener(*handlers)
    return opener.open(request, timeout=timeout)


def github_resolves_to_loopback():
    try:
        infos = socket.getaddrinfo("github.com", 443, type=socket.SOCK_STREAM)
    except Exception:
        return False
    addresses = []
    for info in infos:
        try:
            addresses.append(ipaddress.ip_address(info[4][0]))
        except ValueError:
            continue
    return bool(addresses) and all(address.is_loopback for address in addresses)


def diagnostics():
    """Collect non-secret environment facts for the on-disk error report."""
    lines = [
        f"time: {time.strftime('%Y-%m-%d %H:%M:%S')}",
        f"python: {sys.version.split()[0]}",
        f"ssl: {ssl.OPENSSL_VERSION}",
    ]
    try:
        lines.append(f"version: {current_version()}")
    except Exception as error:
        lines.append(f"version: {type(error).__name__}: {error}")
    try:
        paths = ssl.get_default_verify_paths()
        lines.append(
            f"ssl paths: cafile={paths.cafile} capath={paths.capath} "
            f"openssl={paths.openssl_cafile}"
        )
    except Exception as error:
        lines.append(f"ssl paths: {type(error).__name__}: {error}")
    try:
        import certifi
        lines.append(f"certifi: {certifi.where()}")
    except Exception:
        lines.append("certifi: unavailable")
    try:
        with open("/etc/hosts", encoding="utf-8") as handle:
            entries = [line.strip() for line in handle if "github" in line.lower()]
        lines.append(f"hosts github: {' | '.join(entries) if entries else 'none'}")
    except OSError:
        lines.append("hosts github: unreadable")
    for key in sorted(os.environ):
        if "proxy" not in key.lower():
            continue
        value = os.environ[key]
        try:
            parsed = urlsplit(value if "://" in value else "http://" + value)
            safe = f"{parsed.scheme}://{parsed.hostname}:{parsed.port}"
        except ValueError:
            safe = "<invalid>"
        lines.append(f"env {key}: {safe}")
    for host in ("github.com", "api.github.com"):
        try:
            addresses = sorted(
                {info[4][0] for info in socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)}
            )
            lines.append(f"dns {host}: {', '.join(addresses)}")
        except Exception as error:
            lines.append(f"dns {host}: {type(error).__name__}: {error}")
    return "\n".join(lines)


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
    except Exception:
        # The API is rate-limited, proxied, or malformed on some networks. The
        # direct releases/latest URL still serves the asset, so download it and
        # compare the package version instead.
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


def _download_once(url, part, expected_version, direct):
    part.unlink(missing_ok=True)
    size = 0
    with _open(url, headers={"Accept": "application/octet-stream"},
               timeout=DOWNLOAD_TIMEOUT, direct=direct) as response:
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


def _fetch_to_part(url, part, expected_version=None):
    part.parent.mkdir(parents=True, exist_ok=True)
    last = None
    # First use the environment's proxy (if any), then retry without it. Decky
    # may inherit a stale proxy that the desktop shell does not have.
    for direct in (False, True):
        try:
            return _download_once(url, part, expected_version, direct)
        except Exception as error:
            last = error
            part.unlink(missing_ok=True)
    if isinstance(last, UpdateError):
        raise last
    hint = ""
    if github_resolves_to_loopback():
        hint = (
            "；检测到 github.com 被本机 hosts/代理指向 127.0.0.1，"
            "请启动对应代理工具或在 /etc/hosts 中移除 GitHub 条目后重试"
        )
    raise UpdateError("无法下载更新包，请检查 Deck 网络后重试" + hint) from last


def check_and_download():
    try:
        return _check_and_download()
    except UpdateError:
        raise
    except Exception as error:
        raise UpdateError(
            f"检查更新失败（{type(error).__name__}: {error}）"
        ) from error


def _check_and_download():
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
