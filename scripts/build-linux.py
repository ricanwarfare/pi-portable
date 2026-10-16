"""Build the Linux launcher using only Python's standard library and Go."""
import argparse
import gzip
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import subprocess
import tarfile
import urllib.request

ROOT = Path(__file__).resolve().parent.parent


def digest(data):
    return hashlib.sha256(data).hexdigest()


def safe_name(name):
    path = PurePosixPath(name)
    if path.is_absolute() or ".." in path.parts or "\\" in name:
        raise ValueError(f"Unsafe archive path: {name}")
    return path


def download(item, cache):
    path = cache / item["url"].rsplit("/", 1)[1]
    if not path.exists():
        request = urllib.request.Request(item["url"], headers={"User-Agent": "pi-portable-build"})
        with urllib.request.urlopen(request, timeout=120) as response:
            data = response.read()
        if digest(data) != item["sha256"]:
            raise ValueError(f"Download SHA256 mismatch: {path.name}")
        path.write_bytes(data)
    data = path.read_bytes()
    if digest(data) != item["sha256"]:
        raise ValueError(f"Cached archive SHA256 mismatch: {path.name}")
    return data


def prepare():
    release = json.loads((ROOT / "upstream-linux-release.json").read_text())
    version = json.loads((ROOT / "version.json").read_text())["version"]
    cache = ROOT / ".build/linux-downloads"
    cache.mkdir(parents=True, exist_ok=True)
    files = {}
    for item in [release, *release["tools"]]:
        data = download(item, cache)
        with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as archive:
            for member in archive:
                path = safe_name(member.name)
                if member.isdir():
                    continue
                if not member.isfile():
                    raise ValueError(f"Unsupported archive entry: {member.name}")
                # Official archives all use a single wrapper directory.
                if len(path.parts) < 2:
                    raise ValueError(f"Archive entry has no wrapper directory: {member.name}")
                name = PurePosixPath(*path.parts[1:]).as_posix()
                if "name" in item:
                    name = f"tools/{item['name']}/{name}"
                if name in files:
                    raise ValueError(f"Duplicate payload path: {name}")
                files[name] = (archive.extractfile(member).read(), 0o755 if member.mode & 0o111 else 0o644)
    for name in ("pi", "tools/rg/rg", "tools/fd/fd"):
        if name not in files:
            raise ValueError(f"Missing executable: {name}")
        files[name] = (files[name][0], 0o755)
    files["licenses/GO-LICENSE.txt"] = ((ROOT / "assets/licenses/GO-LICENSE.txt").read_bytes(), 0o644)
    files["portable/triage.mjs"] = ((ROOT / "src/ir/triage.mjs").read_bytes(), 0o644)
    web_release = json.loads((ROOT / 'web-search-release.json').read_text())
    for name, expected in web_release['files'].items():
        safe_name(name)
        data = (ROOT / 'vendor/pi-web-search' / name).read_bytes()
        if digest(data) != expected:
            raise ValueError(f'Web package checksum mismatch: {name}')
        files[f'vendor/pi-web-search/{name}'] = (data, 0o644)
    for name in ('index.ts', 'gate.mjs'):
        files[f'portable/web/{name}'] = ((ROOT / 'src/web' / name).read_bytes(), 0o644)
    bundle = ROOT / "src/linux/bundle"
    bundle.mkdir(parents=True, exist_ok=True)
    output = io.BytesIO()
    with gzip.GzipFile(fileobj=output, mode="wb", mtime=0) as zipped:
        with tarfile.open(fileobj=zipped, mode="w", format=tarfile.PAX_FORMAT) as archive:
            for name, (data, mode) in sorted(files.items()):
                info = tarfile.TarInfo(name)
                info.size, info.mode, info.mtime = len(data), mode, 0
                archive.addfile(info, io.BytesIO(data))
    payload = output.getvalue()
    (bundle / "payload.tar.gz").write_bytes(payload)
    metadata = {
        "version": version,
        "payloadSha256": digest(payload),
        "files": [{"path": name, "sha256": digest(data), "mode": mode}
                  for name, (data, mode) in sorted(files.items())],
    }
    (bundle / "metadata.json").write_text(json.dumps(metadata), encoding="utf-8")
    for name in ("models.json", "settings.json"):
        (bundle / name).write_bytes((ROOT / "config" / name).read_bytes())
    (bundle / "NOTICE.txt").write_bytes((ROOT / "NOTICE.txt").read_bytes())
    return release, metadata


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--prepare-only", action="store_true")
    args = parser.parse_args()
    release, metadata = prepare()
    if args.prepare_only:
        print(f"Prepared verified Linux payload ({len(metadata['files'])} files).")
        return
    output = ROOT / "dist/pi-portable-linux-x64"
    output.parent.mkdir(exist_ok=True)
    environment = {**os.environ, "GOOS": "linux", "GOARCH": "amd64", "CGO_ENABLED": "0"}
    subprocess.run(["go", "build", "-trimpath", "-ldflags=-s -w", "-o", str(output), "."],
                   cwd=ROOT / "src/linux", env=environment, check=True)
    sha = digest(output.read_bytes())
    Path(str(output) + ".sha256").write_text(f"{sha}  {output.name}\n", encoding="utf-8")
    commit = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip() if (ROOT / ".git").exists() else None
    manifest = {
        "schemaVersion": 1, "name": "pi-portable", "version": metadata["version"],
        "platform": "linux-x64", "sourceCommit": commit,
        "goVersion": subprocess.check_output(["go", "version"], text=True).strip(),
        "executable": {"name": output.name, "sha256": sha},
        "payloadSha256": metadata["payloadSha256"], "upstream": release,
        "webSearch": json.loads((ROOT / 'web-search-release.json').read_text()),
        "presets": {name: digest((ROOT / "config" / name).read_bytes()) for name in ("models.json", "settings.json")},
    }
    Path(str(output) + ".build.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"Built {output} ({output.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
