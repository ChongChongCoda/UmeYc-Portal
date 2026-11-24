import base64
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from mhtml_bundle import convert_mhtml, wrap_screenshot


PAGE_URL = "https://example.com/guide"


def build_mhtml(html, resources):
    boundary = "PORTAL-BOUNDARY"
    lines = [
        "MIME-Version: 1.0",
        f'Content-Type: multipart/related; boundary="{boundary}"; type="text/html"',
        "",
    ]

    def add(content_type, location, data):
        lines.extend(
            [
                f"--{boundary}",
                f"Content-Type: {content_type}",
                "Content-Transfer-Encoding: base64",
                f"Content-Location: {location}",
                "",
                base64.b64encode(data).decode(),
                "",
            ]
        )

    add("text/html; charset=utf-8", PAGE_URL, html.encode("utf-8"))
    for content_type, location, data in resources:
        add(content_type, location, data)
    lines.append(f"--{boundary}--")
    return "\r\n".join(lines).encode("utf-8")


class MhtmlBundleTests(unittest.TestCase):
    def setUp(self):
        self.temporary = TemporaryDirectory()
        self.destination = Path(self.temporary.name)

    def tearDown(self):
        self.temporary.cleanup()

    def test_rewrites_resources_removes_scripts_and_forces_utf8(self):
        html = """<html><head>
<base href="https://example.com/">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'">
<script>window.bad = true;</script>
<link rel="stylesheet" href="https://example.com/style.css">
</head><body><h1>女王魔域攻略</h1>
<img src="https://example.com/img/a.png">
<img src="https://example.com/img/q.png?x=1&amp;y=2">
<noscript>需要脚本</noscript>
</body></html>"""
        css = (
            b"body{background:url(/img/a.png)}"
            b"h1{background:url('https://example.com/img/q.png?x=1&y=2')}"
        )
        mhtml = build_mhtml(
            html,
            [
                ("image/png", "https://example.com/img/a.png", b"png-a"),
                ("image/png", "https://example.com/img/q.png?x=1&y=2", b"png-q"),
                ("text/css; charset=utf-8", "https://example.com/style.css", css),
            ],
        )
        summary = convert_mhtml(mhtml, self.destination, PAGE_URL)
        self.assertEqual(summary["mode"], "html")
        self.assertGreaterEqual(summary["resources"], 3)
        page = (self.destination / "index.html").read_text(encoding="utf-8")
        self.assertNotIn("<script", page)
        self.assertNotIn("<base", page)
        self.assertNotIn("Content-Security-Policy", page)
        self.assertNotIn("<noscript", page)
        self.assertIn('<meta charset="utf-8">', page)
        self.assertIn("女王魔域攻略", page)
        self.assertNotIn("https://example.com/img/a.png", page)
        self.assertNotIn("https://example.com/img/q.png", page)
        self.assertNotIn("https://example.com/style.css", page)
        self.assertRegex(page, r"assets/\d{4}-a\.png")
        self.assertRegex(page, r"assets/\d{4}-q\.png")
        self.assertRegex(page, r"assets/\d{4}-style\.css")
        styles = list((self.destination / "assets").glob("*-style.css"))
        self.assertEqual(len(styles), 1)
        css_out = styles[0].read_text(encoding="utf-8")
        self.assertNotIn("/img/a.png", css_out)
        self.assertNotIn("https://example.com/img/q.png", css_out)
        self.assertRegex(css_out, r"assets/\d{4}-a\.png")
        self.assertRegex(css_out, r"assets/\d{4}-q\.png")
        self.assertEqual(next((self.destination / "assets").glob("*-a.png")).read_bytes(), b"png-a")

    def test_uses_first_html_part_when_location_differs(self):
        mhtml = build_mhtml(
            "<html><head></head><body>正文</body></html>",
            [("image/png", "https://cdn.example.com/x.png", b"x")],
        )
        summary = convert_mhtml(mhtml, self.destination, "https://example.com/other")
        self.assertEqual(summary["file"], "index.html")
        self.assertIn("正文", (self.destination / "index.html").read_text(encoding="utf-8"))

    def test_rejects_snapshot_without_html(self):
        boundary = "ONLY-IMAGE"
        mhtml = "\r\n".join(
            [
                "MIME-Version: 1.0",
                f'Content-Type: multipart/related; boundary="{boundary}"',
                "",
                f"--{boundary}",
                "Content-Type: image/png",
                "Content-Transfer-Encoding: base64",
                "Content-Location: https://example.com/a.png",
                "",
                base64.b64encode(b"a").decode(),
                "",
                f"--{boundary}--",
            ]
        ).encode("utf-8")
        with self.assertRaises(ValueError):
            convert_mhtml(mhtml, self.destination, PAGE_URL)

    def test_screenshot_wrapper_escapes_title_and_filename(self):
        html = wrap_screenshot('page"1.png', '<攻略>')
        self.assertIn("&lt;攻略&gt;", html)
        self.assertIn('src="page&quot;1.png"', html)
        self.assertIn("<img", html)
