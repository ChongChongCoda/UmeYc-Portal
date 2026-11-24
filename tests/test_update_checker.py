import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch
from zipfile import ZipFile, ZIP_DEFLATED

import update_checker
from update_checker import (
    UpdateError,
    _release_from_payload,
    check_and_download,
    validate_zip,
    version_number,
)


def write_package(path, version):
    with ZipFile(path, "w", ZIP_DEFLATED) as archive:
        archive.writestr("UmeYc-Portal/package.json", json.dumps({"version": version}))
        archive.writestr("UmeYc-Portal/main.py", "print('ok')")
        archive.writestr("UmeYc-Portal/dist/index.js", "console.log(1)")


def release(number, version):
    return {
        "tag": f"fork-{version}",
        "version": version,
        "number": number,
        "url": "https://github.com/ChongChongCoda/UmeYc-Portal/releases/download/x/UmeYc-Portal.zip",
        "size": 1,
    }


class ReleaseParsingTests(unittest.TestCase):
    def test_version_numbers(self):
        self.assertEqual(version_number("1.0.0-zh-cn.36"), 36)
        self.assertEqual(version_number("1.0.0-zh-cn.100"), 100)
        self.assertIsNone(version_number("1.0.0"))
        self.assertIsNone(version_number(None))

    def test_accepts_only_this_repository_tag_and_asset(self):
        payload = {
            "tag_name": "fork-1.0.0-zh-cn.37",
            "assets": [
                {
                    "name": "UmeYc-Portal.zip",
                    "browser_download_url": "https://github.com/ChongChongCoda/UmeYc-Portal/releases/download/fork-1.0.0-zh-cn.37/UmeYc-Portal.zip",
                    "size": 619552,
                }
            ],
        }
        result = _release_from_payload(payload)
        self.assertEqual(result["version"], "1.0.0-zh-cn.37")
        self.assertEqual(result["number"], 37)
        for broken in [
            {**payload, "tag_name": "v1.0.0-zh-cn.37"},
            {**payload, "assets": []},
            {
                **payload,
                "assets": [
                    {
                        "name": "UmeYc-Portal.zip",
                        "browser_download_url": "https://evil.example/UmeYc-Portal.zip",
                    }
                ],
            },
        ]:
            with self.subTest(broken=broken.get("tag_name")), self.assertRaises(UpdateError):
                _release_from_payload(broken)


class PackageValidationTests(unittest.TestCase):
    def test_accepts_a_complete_package(self):
        with TemporaryDirectory() as directory:
            package = Path(directory) / "UmeYc-Portal.zip"
            write_package(package, "1.0.0-zh-cn.37")
            self.assertEqual(validate_zip(package), "1.0.0-zh-cn.37")

    def test_rejects_corrupt_or_incomplete_packages(self):
        with TemporaryDirectory() as directory:
            corrupt = Path(directory) / "corrupt.zip"
            corrupt.write_bytes(b"not a zip")
            with self.assertRaises(UpdateError):
                validate_zip(corrupt)
            incomplete = Path(directory) / "incomplete.zip"
            with ZipFile(incomplete, "w") as archive:
                archive.writestr("UmeYc-Portal/package.json", json.dumps({"version": "1.0.0-zh-cn.37"}))
            with self.assertRaises(UpdateError):
                validate_zip(incomplete)


class DownloadFlowTests(unittest.TestCase):
    def test_stays_put_when_already_current(self):
        with patch("update_checker.current_version", return_value="1.0.0-zh-cn.36"), patch(
            "update_checker.latest_release",
            return_value=release(36, "1.0.0-zh-cn.36"),
        ), patch("update_checker.downloads_directory", return_value=Path("/nonexistent")), patch(
            "update_checker._fetch_to_part"
        ) as fetch:
            self.assertEqual(check_and_download()["status"], "latest")
            fetch.assert_not_called()

    def test_reuses_an_already_downloaded_newer_zip(self):
        with TemporaryDirectory() as directory:
            target = Path(directory) / "UmeYc-Portal.zip"
            write_package(target, "1.0.0-zh-cn.37")
            with patch("update_checker.current_version", return_value="1.0.0-zh-cn.36"), patch(
                "update_checker.latest_release",
                return_value=release(37, "1.0.0-zh-cn.37"),
            ), patch("update_checker.downloads_directory", return_value=Path(directory)), patch(
                "update_checker._fetch_to_part"
            ) as fetch:
                result = check_and_download()
                fetch.assert_not_called()
            self.assertEqual(result["status"], "ready")
            self.assertEqual(result["version"], "1.0.0-zh-cn.37")

    def test_replaces_the_previous_zip_only_after_validation(self):
        with TemporaryDirectory() as directory:
            target = Path(directory) / "UmeYc-Portal.zip"
            target.write_bytes(b"old package")

            def fetch(_url, part, expected_version=None):
                write_package(part, "1.0.0-zh-cn.37")
                return part.stat().st_size, "1.0.0-zh-cn.37"

            with patch("update_checker.current_version", return_value="1.0.0-zh-cn.36"), patch(
                "update_checker.latest_release",
                return_value=release(37, "1.0.0-zh-cn.37"),
            ), patch("update_checker.downloads_directory", return_value=Path(directory)), patch(
                "update_checker._fetch_to_part", side_effect=fetch
            ):
                result = check_and_download()
            self.assertEqual(result["status"], "downloaded")
            self.assertEqual(result["version"], "1.0.0-zh-cn.37")
            self.assertEqual(result["path"], str(target))
            self.assertTrue(result["replaced"])
            self.assertEqual(validate_zip(target), "1.0.0-zh-cn.37")
            self.assertFalse((Path(directory) / "UmeYc-Portal.zip.part").exists())

    def test_download_retries_without_the_environment_proxy(self):
        with TemporaryDirectory() as directory:
            part = Path(directory) / "UmeYc-Portal.zip.part"
            calls = []

            def download(_url, target, expected, direct, _deadline):
                calls.append(direct)
                if not direct:
                    raise OSError("stale proxy")
                write_package(target, "1.0.0-zh-cn.37")
                return target.stat().st_size, "1.0.0-zh-cn.37"

            with patch("update_checker._download_once", side_effect=download):
                size, version = update_checker._fetch_to_part(
                    "https://github.com/x", part)
            self.assertEqual(calls, [False, True])
            self.assertEqual(version, "1.0.0-zh-cn.37")
            self.assertEqual(size, part.stat().st_size)

    def test_wraps_unexpected_errors_as_update_errors(self):
        with patch("update_checker.current_version", side_effect=RuntimeError("boom")):
            with self.assertRaisesRegex(UpdateError, "RuntimeError: boom"):
                check_and_download()

    def test_fallback_download_does_not_replace_an_older_zip_with_an_equal_one(self):
        with TemporaryDirectory() as directory:
            target = Path(directory) / "UmeYc-Portal.zip"
            target.write_bytes(b"existing")

            def fetch(_url, part, expected_version=None):
                write_package(part, "1.0.0-zh-cn.36")
                return part.stat().st_size, "1.0.0-zh-cn.36"

            with patch("update_checker.current_version", return_value="1.0.0-zh-cn.36"), patch(
                "update_checker.latest_release",
                return_value={"tag": None, "version": None, "number": None,
                              "url": "https://github.com/latest", "size": None},
            ), patch("update_checker.downloads_directory", return_value=Path(directory)), patch(
                "update_checker._fetch_to_part", side_effect=fetch
            ):
                result = check_and_download()
            self.assertEqual(result["status"], "latest")
            self.assertEqual(target.read_bytes(), b"existing")
            self.assertFalse((Path(directory) / "UmeYc-Portal.zip.part").exists())


if __name__ == "__main__":
    unittest.main()
