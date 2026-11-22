"""Fetch the shared libraries Chromium needs into a local sysroot (no root here).

Reads the Debian trixie package index once, downloads the .deb for each requested
binary package, and unpacks data.tar.* into the local sysroot (see paths.py).
"""
import gzip
import io
import os
import subprocess
import sys
import urllib.request

MIRROR = "https://deb.debian.org/debian"
SUITE = "trixie"
ARCH = "amd64"
from paths import SYSROOT  # noqa: E402  (local sysroot, see paths.py)
CACHE = os.path.join(SYSROOT, ".debs")

PKGS = sys.argv[1:]


def index():
    url = f"{MIRROR}/dists/{SUITE}/main/binary-{ARCH}/Packages.gz"
    with urllib.request.urlopen(url, timeout=120) as r:
        raw = gzip.decompress(r.read()).decode("utf-8", "replace")
    entries = {}
    for block in raw.split("\n\n"):
        fields = {}
        for line in block.splitlines():
            if line[:1] in (" ", "\t") or ":" not in line:
                continue
            k, v = line.split(":", 1)
            fields[k] = v.strip()
        if "Package" in fields and "Filename" in fields:
            entries[fields["Package"]] = fields
    return entries


def ar_members(path):
    """A .deb is an ar archive; GNU tar cannot read it, so walk it by hand."""
    with open(path, "rb") as f:
        if f.read(8) != b"!<arch>\n":
            raise ValueError("not an ar archive: " + path)
        while True:
            header = f.read(60)
            if len(header) < 60:
                return
            name = header[:16].decode("ascii", "replace").strip().rstrip("/")
            size = int(header[48:58].decode("ascii").strip())
            body = f.read(size)
            if size % 2:
                f.read(1)
            yield name, body


def unpack(deb_path):
    os.makedirs(SYSROOT, exist_ok=True)
    for name, body in ar_members(deb_path):
        if not name.startswith("data.tar"):
            continue
        tar_path = os.path.join(os.path.dirname(deb_path), name)
        if name.endswith(".zst"):
            import zstandard
            body = zstandard.ZstdDecompressor().decompress(body, max_output_size=400 * 1024 * 1024)
            tar_path = tar_path[: -len(".zst")]
        elif name.endswith(".xz"):
            import lzma
            body = lzma.decompress(body)
            tar_path = tar_path[: -len(".xz")]
        with open(tar_path, "wb") as out:
            out.write(body)
        subprocess.run(["tar", "-xf", tar_path, "-C", SYSROOT], check=True)
        os.remove(tar_path)
        return True
    return False


def main():
    idx = index()
    os.makedirs(CACHE, exist_ok=True)
    for pkg in PKGS:
        field = idx.get(pkg)
        if not field:
            print("MISSING FROM INDEX:", pkg)
            continue
        fn = field["Filename"]
        dest = os.path.join(CACHE, os.path.basename(fn))
        if not os.path.exists(dest):
            url = f"{MIRROR}/{fn}"
            print("fetch", pkg, fn, flush=True)
            with urllib.request.urlopen(url, timeout=180) as r, open(dest, "wb") as f:
                f.write(r.read())
        ok = unpack(dest)
        print("unpacked" if ok else "NO DATA MEMBER", pkg)


main()
