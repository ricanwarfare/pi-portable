"""Linux integration tests, including actual pseudo-terminal key setup. No cloud calls."""
import hashlib
import json
import os
from pathlib import Path
import pty
import select
import shutil
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parent.parent
BINARY = ROOT / "dist/pi-portable-linux-x64"
SCRATCH = Path(tempfile.mkdtemp(prefix="linux launcher ", dir=ROOT / ".build"))


def environment(home):
    return {**os.environ, "PI_PORTABLE_HOME": str(home), "OLLAMA_API_KEY": ""}


def run(args, home):
    return subprocess.run([str(BINARY), *args], env=environment(home), capture_output=True, timeout=40)


def terminal(args, home, response):
    master, slave = pty.openpty()
    child = subprocess.Popen([str(BINARY), *args], env=environment(home), stdin=slave, stdout=slave, stderr=slave)
    os.close(slave)
    output = bytearray()
    sent = False
    deadline = time.monotonic() + 40
    try:
        while time.monotonic() < deadline:
            if select.select([master], [], [], 0.1)[0]:
                try:
                    chunk = os.read(master, 65536)
                except OSError:
                    break
                if not chunk:
                    break
                output.extend(chunk)
                if not sent and b"API key: " in output:
                    os.write(master, response)
                    sent = True
            if child.poll() is not None:
                break
        code = child.wait(timeout=5)
        assert sent, f"Expected setup prompt, got: {output.decode(errors='replace')}"
        return code, bytes(output)
    finally:
        if child.poll() is None:
            child.kill()
            child.wait()
        os.close(master)


def main():
    # One copied executable must work outside the checkout, without companion files.
    folder = SCRATCH / "USB drive"
    folder.mkdir()
    copied = folder / BINARY.name
    shutil.copy2(BINARY, copied)
    env = {**os.environ, "OLLAMA_API_KEY": ""}
    env.pop("PI_PORTABLE_HOME", None)
    info = subprocess.run([str(copied), "--portable-info"], env=env, capture_output=True, timeout=20)
    assert info.returncode == 0 and b"Linux x64" in info.stdout
    assert not (folder / "pi-portable-data").exists()
    result = subprocess.run([str(copied), "--version"], env=env, capture_output=True, timeout=40)
    assert result.returncode == 0 and b"1.3.0" in result.stdout, result.stderr
    home = folder / "pi-portable-data"
    assert (home / "agent/models.json").is_file()
    assert json.loads((home / "agent/settings.json").read_text())["defaultProvider"] == "ollama-cloud"
    # Automatic first-run prompt must allow cancellation, with no credential written.
    code, output = terminal([], home, b"\x1b")
    assert code == 130 and not (home / "agent/ollama-cloud.key").exists(), output
    # Explicit setup plus --version tests the real terminal and child launch without inference.
    for secret in (b"synthetic-first", b"synthetic-replacement"):
        code, output = terminal(["--portable-setup", "--version"], home, secret + b"\r")
        assert code == 0 and b"Key saved. Starting Pi" in output, output
        assert secret not in output, "Prompt echoed key"
        key = home / "agent/ollama-cloud.key"
        assert key.read_bytes() == secret and key.stat().st_mode & 0o777 == 0o600
    code, _ = terminal(["--portable-setup", "--version"], home, b"\x03")
    assert code == 130 and (home / "agent/ollama-cloud.key").read_bytes() == b"synthetic-replacement"
    rejected = run(["--portable-setup"], SCRATCH / "redirected")
    assert rejected.returncode == 1 and b"interactive terminal" in rejected.stderr
    # Launches share a locked, complete runtime and preserve existing presets.
    first = subprocess.Popen([str(BINARY), "--version"], env=environment(home), stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    second = subprocess.Popen([str(BINARY), "--version"], env=environment(home), stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    assert first.communicate(timeout=40)[1] == b"" and first.returncode == 0
    assert second.communicate(timeout=40)[1] == b"" and second.returncode == 0
    models = home / "agent/models.json"
    models.write_text('{"providers":{}}\n')
    assert run(["--version"], home).returncode == 0
    assert models.read_text() == '{"providers":{}}\n'
    runtime = next((home / "runtime").iterdir())
    with (runtime / "pi").open("ab") as file:
        file.write(b"tamper")
    rejected = run(["--version"], home)
    assert rejected.returncode == 1 and b"incomplete or modified" in rejected.stderr
    link = SCRATCH / "symlink-home"
    link.symlink_to(home, target_is_directory=True)
    rejected = run(["--version"], link)
    assert rejected.returncode == 1 and b"symlink" in rejected.stderr
    expected = (ROOT / "dist/pi-portable-linux-x64.sha256").read_text().split()[0]
    assert hashlib.sha256(BINARY.read_bytes()).hexdigest() == expected
    print("PASS: copied executable, portable config, first-run hidden prompt, replacement, cancellation, 0600 key permissions, concurrency, config preservation, tamper and symlink rejection, checksum.")
    print(f"Test artifacts: {SCRATCH}")


if __name__ == "__main__":
    main()
