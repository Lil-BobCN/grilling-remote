#!/usr/bin/env python3
"""检查上传的工作区 zip，并只解出 .scratch 目录。

用法：checkzip.py inspect <zip 文件> <输出目录>

结果是一行 JSON，正常拒绝也返回 0；脚本自身出错返回 2。
"""

import json
import os
import sys
import zipfile

IGNORED_TOP = {".DS_Store", "__MACOSX"}
SOFTWARE_FILE = "软件.md"
SOFTWARE_MAX_BYTES = 64 * 1024
REQUIREMENT_FILES = {
    "map.md",
    "需求草稿.md",
    "验收场景.md",
    "问答记录.md",
    "问题树.md",
    "pending.md",
}


def env_int(name, fallback):
    try:
        value = int(os.environ.get(name, ""))
        return value if value > 0 else fallback
    except ValueError:
        return fallback


MAX_ENTRIES = env_int("AFK_MAX_ENTRIES", 20000)
MAX_TOTAL = env_int("AFK_MAX_UNCOMPRESSED", 512 * 1024 * 1024)
MAX_FILE = env_int("AFK_MAX_FILE", 128 * 1024 * 1024)


def emit(payload):
    print(json.dumps(payload, ensure_ascii=False))
    sys.exit(0)


def parts(name):
    return [part for part in name.split("/") if part not in ("", ".")]


def unsafe_name(name):
    normalized = name.replace("\\", "/")
    if not normalized or "\x00" in normalized:
        return True
    if normalized.startswith("/"):
        return True
    if len(normalized) >= 2 and normalized[1] == ":":
        return True
    return any(part == ".." for part in normalized.split("/"))


def is_symlink(info):
    mode = (info.external_attr >> 16) & 0o170000
    return mode == 0o120000


def entry_name(info):
    """取条目名。没有 UTF-8 标记时先按 UTF-8 解码，失败再保留 CP437。

    macOS 的 zip 和 ditto 写中文名时用 UTF-8 字节，却不置 0x800 标记。
    Python 按 CP437 解码，名字变乱码，校验就找不到验收场景.md。
    """
    name = info.filename
    if not info.flag_bits & 0x800:
        try:
            raw = name.encode("cp437")
        except UnicodeEncodeError:
            raw = None
        if raw is not None:
            try:
                name = raw.decode("utf-8")
            except UnicodeDecodeError:
                pass
    return name.replace("\\", "/")


def read_software(archive, infos, names, root):
    """读工作区根目录 `软件.md` 的第一行。没有、空、读不出名字都算没有。"""
    target = f"{root}/{SOFTWARE_FILE}" if root else SOFTWARE_FILE
    for info, name in zip(infos, names):
        if name != target or info.is_dir():
            continue
        try:
            with archive.open(info) as source:
                raw = source.readline(SOFTWARE_MAX_BYTES)
        except (OSError, RuntimeError, zipfile.BadZipFile):
            return None
        try:
            text = raw.decode("utf-8-sig")
        except UnicodeDecodeError:
            return None
        line = text.split("\n", 1)[0].strip()
        if not line or "/" in line or "\\" in line or "\x00" in line:
            return None
        return line
    return None


def main():
    if len(sys.argv) != 4 or sys.argv[1] != "inspect":
        print("用法：checkzip.py inspect <zip 文件> <输出目录>", file=sys.stderr)
        return 2

    zip_path, out_dir = sys.argv[2], sys.argv[3]
    if not zipfile.is_zipfile(zip_path):
        emit({"ok": False, "code": "not_zip"})

    try:
        archive = zipfile.ZipFile(zip_path)
    except (zipfile.BadZipFile, OSError):
        emit({"ok": False, "code": "not_zip"})

    with archive:
        infos = archive.infolist()
        if len(infos) > MAX_ENTRIES:
            emit({"ok": False, "code": "too_large", "detail": "entries"})

        total = 0
        names = []
        for info in infos:
            if info.flag_bits & 0x1:
                emit({"ok": False, "code": "encrypted"})
            name = entry_name(info)
            if unsafe_name(name):
                emit({"ok": False, "code": "unsafe", "detail": name})
            if is_symlink(info):
                emit({"ok": False, "code": "unsafe", "detail": name})
            if info.file_size > MAX_FILE:
                emit({"ok": False, "code": "too_large", "detail": name})
            total += info.file_size
            if total > MAX_TOTAL:
                emit({"ok": False, "code": "too_large", "detail": "total"})
            names.append(name)

        top_dirs = set()
        top_files = set()
        for name in names:
            pieces = parts(name)
            if not pieces:
                continue
            if len(pieces) == 1 and not name.endswith("/"):
                top_files.add(pieces[0])
            else:
                top_dirs.add(pieces[0])

        def under(prefix, name):
            return name == prefix or name.startswith(prefix + "/")

        root = ""
        if any(under(".scratch", name) for name in names):
            root = ""
        else:
            candidates = sorted(top_dirs - IGNORED_TOP)
            if len(candidates) == 1:
                candidate = candidates[0]
                if any(name == f"{candidate}/.scratch" or name.startswith(f"{candidate}/.scratch/") for name in names):
                    root = candidate

        if root == "" and not any(under(".scratch", name) for name in names):
            kind = "wrong-folder"
            if "AGENTS.md" in top_files or ".dsh" in top_dirs:
                kind = "original-package"
            elif (top_files & REQUIREMENT_FILES) or "issues" in top_dirs:
                kind = "requirement-only"
            elif len(names) == 1 and names[0].lower().endswith(".zip"):
                kind = "not-unzipped"
            emit({"ok": False, "code": "missing_scratch", "kind": kind})

        prefix = f"{root}/.scratch/" if root else ".scratch/"
        requirements = set()
        for name in names:
            if not name.startswith(prefix):
                continue
            rest = name[len(prefix):]
            pieces = parts(rest)
            if not pieces:
                continue
            if len(pieces) >= 2 or name.endswith("/"):
                requirements.add(pieces[0])

        if not requirements:
            emit({"ok": False, "code": "no_requirements"})

        software = read_software(archive, infos, names, root)

        scratch_out = os.path.join(out_dir, "scratch")
        os.makedirs(scratch_out, mode=0o700, exist_ok=True)
        written = 0

        for info in infos:
            name = entry_name(info)
            if not name.startswith(prefix) or name.endswith("/"):
                continue
            rest = name[len(prefix):]
            pieces = parts(rest)
            if not pieces:
                continue
            target = os.path.normpath(os.path.join(scratch_out, *pieces))
            if not (target == scratch_out or target.startswith(scratch_out + os.sep)):
                emit({"ok": False, "code": "unsafe", "detail": name})
            os.makedirs(os.path.dirname(target), mode=0o700, exist_ok=True)
            with archive.open(info) as source, open(target, "wb") as sink:
                os.chmod(target, 0o600)
                while True:
                    chunk = source.read(65536)
                    if not chunk:
                        break
                    written += len(chunk)
                    if written > MAX_TOTAL:
                        emit({"ok": False, "code": "too_large", "detail": "extract"})
                    sink.write(chunk)

        emit(
            {
                "ok": True,
                "root": root,
                "software": software,
                "requirements": sorted(requirements),
                "counts": {"entries": len(infos), "uncompressed": total, "extracted": written},
            }
        )


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as error:  # noqa: BLE001
        print(json.dumps({"ok": False, "code": "internal", "detail": str(error)}, ensure_ascii=False))
        sys.exit(2)
