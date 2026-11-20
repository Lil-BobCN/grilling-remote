#!/usr/bin/env python3
"""列出回传 zip 里的条目，按需打印某个文本条目的内容。

用法：list-zip.py <zip> [要打印的条目名]
"""
import sys
import zipfile

if len(sys.argv) < 2:
    print("用法：list-zip.py <zip> [条目名]", file=sys.stderr)
    sys.exit(2)

path = sys.argv[1]
want = sys.argv[2] if len(sys.argv) > 2 else None

with zipfile.ZipFile(path) as archive:
    names = [info.filename for info in archive.infolist()]
    for name in names:
        print(name)
    if want:
        if want not in names:
            print(f"没有条目：{want}", file=sys.stderr)
            sys.exit(1)
        with archive.open(want) as source:
            sys.stdout.write(source.read().decode("utf-8-sig", "replace"))
