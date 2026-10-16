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
BINARY = ROOT / "dist/pi-response-linux-x64"
SCRATCH = Path(tempfile.mkdtemp(prefix="linux launcher ", dir=ROOT / ".build"))


def environment(home):
    return {**os.environ, "PI_RESPONSE_HOME": str(home), "OLLAMA_API_KEY": ""}


def run(args, home):
    return subprocess.run([str(BINARY), *args], env=environment(home), capture_output=True, timeout=40)


def terminal(args, home, response, storage=None):
    master, slave = pty.openpty()
    child = subprocess.Popen([str(BINARY), *args], env=environment(home), stdin=slave, stdout=slave, stderr=slave)
    os.close(slave)
    output = bytearray()
    sent = False
    stored = False
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
                if storage is not None and not stored and b"Storage [1]" in output:
                    os.write(master, storage)
                    stored = True
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
    env.pop("PI_RESPONSE_HOME", None)
    info = subprocess.run([str(copied), "--response-info"], env=env, capture_output=True, timeout=20)
    assert info.returncode == 0 and b"Linux x64" in info.stdout
    assert not (folder / "pi-response-data").exists()
    result = subprocess.run([str(copied), "--version"], env=env, capture_output=True, timeout=40)
    expected_version = json.loads((ROOT / 'upstream-linux-release.json').read_text())['version'].encode()
    assert result.returncode == 0 and expected_version in result.stdout, result.stderr
    home = folder / "pi-response-data"
    assert (home / "agent/models.json").is_file()
    assert json.loads((home / "agent/settings.json").read_text())["defaultProvider"] == "ollama-cloud"
    # Automatic first-run prompt must allow cancellation, with no credential written.
    code, output = terminal([], home, b"\x1b")
    assert code == 130 and not (home / "agent/ollama-cloud.key").exists(), output
    # Explicit setup plus --version tests the real terminal and child launch without inference.
    for secret in (b"synthetic-first", b"synthetic-replacement"):
        code, output = terminal(["--response-setup", "--version"], home, secret + b"\r", b"2\r")
        assert code == 0 and b"Key saved. Starting Pi" in output, output
        assert secret not in output, "Prompt echoed key"
        key = home / "agent/ollama-cloud.key"
        assert key.read_bytes() == secret and key.stat().st_mode & 0o777 == 0o600
    # Help/version and explicit setup must not need to read the old key first.
    if os.geteuid() != 0:
        key.chmod(0)
        try:
            for args in (["--version"], ["--tools", "read", "--help"]):
                result = run(args, home)
                assert result.returncode == 0, result.stderr
            result = run(["--response-setup"], home)
            assert result.returncode == 1 and b"interactive terminal" in result.stderr, result.stderr
        finally:
            key.chmod(0o600)
    # Session-only is the default; explicit mode never prompts for storage or overwrites a saved key.
    transient = SCRATCH / "transient"
    code, output = terminal(["--response-setup", "--version"], transient, b"synthetic-session\r", b"\r")
    assert code == 0 and b"Using session-only key" in output, output
    assert b"synthetic-session" not in output
    assert not (transient / "agent/ollama-cloud.key").exists()
    code, output = terminal(["--response-session-key", "--version"], home, b"synthetic-once\r")
    assert code == 0 and b"Storage [1]" not in output and b"synthetic-once" not in output, output
    assert (home / "agent/ollama-cloud.key").read_bytes() == b"synthetic-replacement"
    code, _ = terminal(["--response-setup", "--version"], home, b"synthetic-cancelled\r", b"\x1b")
    assert code == 130 and (home / "agent/ollama-cloud.key").read_bytes() == b"synthetic-replacement"
    code, _ = terminal(["--response-setup", "--version"], home, b"\x03")
    assert code == 130 and (home / "agent/ollama-cloud.key").read_bytes() == b"synthetic-replacement"
    rejected = run(["--response-setup"], SCRATCH / "redirected")
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
    expected = (ROOT / "dist/pi-response-linux-x64.sha256").read_text().split()[0]
    assert hashlib.sha256(BINARY.read_bytes()).hexdigest() == expected
    print("PASS: copied executable, portable config, first-run hidden prompt, replacement, cancellation, 0600 key permissions, concurrency, config preservation, tamper and symlink rejection, checksum.")
    print(f"Test artifacts: {SCRATCH}")


if __name__ == "__main__":
    main()
