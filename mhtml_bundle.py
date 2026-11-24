"""Turn a CDP MHTML snapshot into a self-contained, script-free folder bundle.

The saved page is served later by the loopback offline server, so resource
references are resolved against the page (or stylesheet) URL, rewritten to
relative paths, and scripts, site CSP and base hints are removed.
"""

import email
from html import escape, unescape
import mimetypes
from pathlib import Path
import re
from urllib.parse import quote, unquote, urljoin, urlsplit


MAX_RESOURCES = 5000
SCRIPT_RE = re.compile(r"<script\b[^>]*>.*?</script\s*>|<script\b[^>]*/\s*>", re.I | re.S)
NOSCRIPT_RE = re.compile(r"<noscript\b[^>]*>.*?</noscript\s*>", re.I | re.S)
BASE_RE = re.compile(r"<base\b[^>]*>", re.I)
META_CSP_RE = re.compile(
    r"<meta\b[^>]*http-equiv\s*=\s*[\"']?\s*content-security-policy[^>]*>", re.I
)
HEAD_RE = re.compile(r"<head\b[^>]*>", re.I)
URL_ATTRIBUTE_RE = re.compile(
    r"""(?P<name>\b(?:href|src|poster|action|data-src|data-original|data-lazy-src|data-bg)\b)"""
    r"""(?P<sep>\s*=\s*)(?P<quote>["'])(?P<value>.*?)(?P=quote)""",
    re.I | re.S,
)
SRCSET_RE = re.compile(
    r"""(?P<name>\bsrcset\b)(?P<sep>\s*=\s*)(?P<quote>["'])(?P<value>.*?)(?P=quote)""",
    re.I | re.S,
)
CSS_URL_RE = re.compile(r"""url\(\s*(?P<q>['"]?)(?P<value>.*?)(?P=q)\s*\)""", re.I | re.S)
CSS_IMPORT_RE = re.compile(r"""@import\s+(?P<q>['"])(?P<value>.*?)(?P=q)""", re.I | re.S)
SKIP_PREFIXES = ("data:", "blob:", "javascript:", "mailto:", "tel:", "about:")


def _walk(message):
    yield message
    if message.is_multipart():
        for part in message.get_payload():
            if isinstance(part, email.message.Message):
                yield from _walk(part)


def _decode(payload):
    if isinstance(payload, str):
        return payload.encode("utf-8", "replace")
    return payload


def _normalize_page_url(value):
    try:
        parsed = urlsplit(value)
    except ValueError:
        return value
    return f"{parsed.scheme}://{parsed.netloc}{parsed.path or '/'}"


def _asset_name(location, content_type, index):
    path = urlsplit(location).path
    suffix = Path(unquote(path)).suffix.lower()
    if not re.fullmatch(r"\.[a-z0-9]{1,8}", suffix or ""):
        suffix = mimetypes.guess_extension((content_type or "").split(";")[0].strip()) or ".bin"
    stem = Path(unquote(path)).stem
    stem = re.sub(r"[^A-Za-z0-9._-]+", "-", stem).strip("-._")[:48] or "file"
    return f"{index:04d}-{stem}{suffix}"


def _url_candidates(value):
    candidates = {value, unquote(value)}
    try:
        candidates.add(quote(unquote(value), safe=":/?&=%#+~@,;!$'()*[]"))
    except (LookupError, TypeError):
        pass
    return candidates


def _resolver(mapping, base):
    def resolve(value):
        value = value.strip()
        if not value or value.startswith("#") or value.lower().startswith(SKIP_PREFIXES):
            return None
        try:
            absolute = urljoin(base, unescape(value))
            if urlsplit(absolute).scheme not in {"http", "https"}:
                return None
            address, _, fragment = absolute.partition("#")
        except ValueError:
            return None
        for candidate in _url_candidates(address):
            relative = mapping.get(candidate)
            if relative:
                return relative + (f"#{fragment}" if fragment else "")
        return None

    return resolve


def _rewrite_html(html, resolve):
    def attribute(match):
        local = resolve(match.group("value"))
        if local is None:
            return match.group(0)
        return (
            f'{match.group("name")}{match.group("sep")}{match.group("quote")}'
            f'{escape(local, quote=True)}{match.group("quote")}'
        )

    def srcset(match):
        entries = []
        for entry in match.group("value").split(","):
            bits = entry.strip().split()
            if not bits:
                continue
            local = resolve(bits[0])
            if local:
                bits[0] = local
            entries.append(" ".join(bits))
        return (
            f'{match.group("name")}{match.group("sep")}{match.group("quote")}'
            f'{escape(", ".join(entries), quote=True)}{match.group("quote")}'
        )

    def css_url(match):
        local = resolve(match.group("value"))
        return f'url("{escape(local, quote=True)}")' if local else match.group(0)

    def css_import(match):
        local = resolve(match.group("value"))
        return f'@import "{escape(local, quote=True)}"' if local else match.group(0)

    html = URL_ATTRIBUTE_RE.sub(attribute, html)
    html = SRCSET_RE.sub(srcset, html)
    html = CSS_URL_RE.sub(css_url, html)
    html = CSS_IMPORT_RE.sub(css_import, html)
    return html


def _rewrite_css(text, resolve):
    def css_url(match):
        local = resolve(match.group("value"))
        return f'url("{escape(local, quote=True)}")' if local else match.group(0)

    def css_import(match):
        local = resolve(match.group("value"))
        return f'@import "{escape(local, quote=True)}"' if local else match.group(0)

    text = CSS_URL_RE.sub(css_url, text)
    text = CSS_IMPORT_RE.sub(css_import, text)
    return text


def _clean_html(html):
    html = SCRIPT_RE.sub("", html)
    html = NOSCRIPT_RE.sub("", html)
    html = BASE_RE.sub("", html)
    html = META_CSP_RE.sub("", html)
    if HEAD_RE.search(html):
        html = HEAD_RE.sub(lambda match: match.group(0) + '<meta charset="utf-8">', html, count=1)
    else:
        html = '<meta charset="utf-8">' + html
    return html


def wrap_screenshot(filename, title):
    """Build the minimal HTML page used when only a screenshot was captured."""
    safe_title = escape(title or "未命名网页")
    return (
        "<!doctype html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\">"
        f"<title>{safe_title}</title>"
        "<style>html,body{margin:0;padding:0;background:#111;}"
        "img{display:block;width:100%;height:auto}</style>"
        f"</head><body><img src=\"{escape(filename, quote=True)}\" alt=\"\"></body></html>"
    )


def convert_mhtml(payload, destination, page_url):
    """Write an MHTML snapshot into ``destination`` and return a summary."""
    data = _decode(payload)
    message = email.message_from_bytes(data)
    destination = Path(destination)
    assets = destination / "assets"
    parts = []
    for part in _walk(message):
        body = part.get_payload(decode=True)
        if body is None or part.is_multipart():
            continue
        parts.append(
            {
                "content_type": part.get_content_type(),
                "charset": part.get_content_charset() or "utf-8",
                "location": part.get("Content-Location") or "",
                "bytes": body,
            }
        )
    if not parts:
        raise ValueError("离线快照没有可用的内容")
    normalized = _normalize_page_url(page_url)
    main = next(
        (
            part
            for part in parts
            if part["content_type"] == "text/html"
            and _normalize_page_url(part["location"]) == normalized
        ),
        None,
    )
    if main is None:
        main = next((part for part in parts if part["content_type"] == "text/html"), None)
    if main is None:
        raise ValueError("离线快照中没有主页面")
    mapping = {}
    resources = 0
    failed = 0
    css_parts = []
    for index, part in enumerate(parts):
        if part is main or index > MAX_RESOURCES:
            if part is not main:
                failed += 1
            continue
        location = part["location"]
        name = _asset_name(location, part["content_type"], index)
        relative = f"assets/{name}"
        try:
            assets.mkdir(parents=True, exist_ok=True)
            target = assets / name
            target.write_bytes(part["bytes"])
        except OSError:
            failed += 1
            continue
        if location:
            for variant in _url_candidates(location):
                mapping[variant] = relative
        resources += 1
        if part["content_type"] == "text/css" or name.endswith(".css"):
            css_parts.append((target, part["charset"], location or page_url))
    for target, charset, location in css_parts:
        try:
            text = target.read_text(encoding=charset, errors="replace")
        except (LookupError, OSError):
            continue
        try:
            target.write_text(
                _rewrite_css(text, _resolver(mapping, location)), encoding="utf-8"
            )
        except OSError:
            failed += 1
    charset = main["charset"] or "utf-8"
    try:
        html = main["bytes"].decode(charset, errors="replace")
    except LookupError:
        html = main["bytes"].decode("utf-8", errors="replace")
    html = _clean_html(html)
    html = _rewrite_html(html, _resolver(mapping, main["location"] or page_url))
    (destination / "index.html").write_text(html, encoding="utf-8")
    return {
        "file": "index.html",
        "resources": resources,
        "failed": failed,
        "mode": "html",
    }
