import os
import sys
import zipfile


def add_tree(archive, root, prefix="", skip=None):
    for name in sorted(os.listdir(root)):
        path = os.path.join(root, name)
        if skip and os.path.abspath(path) == skip:
            continue
        arcname = f"{prefix}{name}"
        if os.path.isdir(path):
            archive.write(path, arcname)
            add_tree(archive, path, f"{arcname}/", skip)
        else:
            archive.write(path, arcname)


def main():
    root, out = sys.argv[1], sys.argv[2]
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as archive:
        add_tree(archive, root, skip=os.path.abspath(out))


if __name__ == "__main__":
    main()
