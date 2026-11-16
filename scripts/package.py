#!/usr/bin/env python3
"""Package a prebuilt frontend with the Python backend and viewer assets."""

import json
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED


root = Path(__file__).resolve().parent.parent
name = json.loads((root / "plugin.json").read_text())["name"]
required = ["plugin.json", "package.json", "main.py", "LICENSE", "README.zh-CN.md",
            "dist/index.js", "assets/image-viewer.html"]
for relative in required:
    if not (root / relative).is_file():
        raise SystemExit(f"Missing {relative}; run pnpm build first")
files = [root / relative for relative in required if not relative.startswith(("dist/", "assets/"))]
for directory in ("dist", "assets"):
    files.extend(path for path in (root / directory).rglob("*") if path.is_file())
output = root / "out" / f"{name}.zip"
output.parent.mkdir(exist_ok=True)
with ZipFile(output, "w", ZIP_DEFLATED) as archive:
    for path in sorted(files):
        archive.write(path, f"{name}/{path.relative_to(root).as_posix()}")
print(output)
