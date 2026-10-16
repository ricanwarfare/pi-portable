package main

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func testPayload(t *testing.T, name, text string, kind byte) ([]byte, []payloadFile) {
	t.Helper()
	var buffer bytes.Buffer
	gzipWriter := gzip.NewWriter(&buffer)
	writer := tar.NewWriter(gzipWriter)
	header := &tar.Header{Name: name, Mode: 0755, Size: int64(len(text)), Typeflag: kind}
	if kind == tar.TypeSymlink {
		header.Linkname = "/tmp/outside"
		header.Size = 0
	}
	if err := writer.WriteHeader(header); err != nil {
		t.Fatal(err)
	}
	if header.Size > 0 {
		if _, err := writer.Write([]byte(text)); err != nil {
			t.Fatal(err)
		}
	}
	writer.Close()
	gzipWriter.Close()
	hash := sha256.Sum256([]byte(text))
	return buffer.Bytes(), []payloadFile{{Path: name, SHA256: hex.EncodeToString(hash[:]), Mode: 0755}}
}

func TestExtractionAndIntegrity(t *testing.T) {
	root := t.TempDir()
	payload, files := testPayload(t, "tools/test", "test", tar.TypeReg)
	if err := extract(root, payload, files); err != nil {
		t.Fatal(err)
	}
	if err := verifyRuntime(root, files); err != nil {
		t.Fatal(err)
	}
	info, _ := os.Stat(filepath.Join(root, "tools/test"))
	if info.Mode().Perm() != 0700 {
		t.Fatal("executable must be owner-only")
	}
	os.WriteFile(filepath.Join(root, "tools/test"), []byte("modified"), 0700)
	if verifyRuntime(root, files) == nil {
		t.Fatal("modified payload accepted")
	}
}

func TestUnsafePayloads(t *testing.T) {
	for _, name := range []string{"../outside", "/absolute", "dir/../../outside", "dir\\outside"} {
		t.Run(name, func(t *testing.T) {
			payload, files := testPayload(t, name, "data", tar.TypeReg)
			if extract(t.TempDir(), payload, files) == nil {
				t.Fatal("unsafe path accepted")
			}
		})
	}
	payload, files := testPayload(t, "link", "", tar.TypeSymlink)
	if extract(t.TempDir(), payload, files) == nil {
		t.Fatal("archive symlink accepted")
	}
}

func TestUnexpectedRuntimeAndSymlinks(t *testing.T) {
	root := t.TempDir()
	payload, files := testPayload(t, "pi", "test", tar.TypeReg)
	if err := extract(root, payload, files); err != nil {
		t.Fatal(err)
	}
	os.WriteFile(filepath.Join(root, "extra.so"), []byte("unexpected"), 0600)
	if verifyRuntime(root, files) == nil {
		t.Fatal("unexpected runtime file accepted")
	}
	link := filepath.Join(t.TempDir(), "link")
	if err := os.Symlink(root, link); err != nil {
		t.Fatal(err)
	}
	if checkPath(filepath.Join(link, "new/file")) == nil {
		t.Fatal("symlink parent accepted")
	}
}

func TestHiddenInput(t *testing.T) {
	for _, test := range []struct{ input, want string }{{"abc\x7fd\r", "abd"}, {"\x08\n", ""}, {" key \n", "key"}} {
		got, err := readSecret(strings.NewReader(test.input))
		if err != nil || got != test.want {
			t.Fatal("secret editing failed")
		}
	}
	for _, input := range []string{"\x03", "\x1b"} {
		if _, err := readSecret(strings.NewReader(input)); !errors.Is(err, canceled) {
			t.Fatal("cancellation failed")
		}
	}
}

func TestCredentialPermissionsAndReplacement(t *testing.T) {
	home := t.TempDir()
	path := filepath.Join(home, "ollama-cloud.key")
	for _, key := range []string{"synthetic-first", "synthetic-replacement"} {
		if err := writeKey(home, path, key); err != nil {
			t.Fatal(err)
		}
		data, _ := os.ReadFile(path)
		if string(data) != key {
			t.Fatal("saved key mismatch")
		}
		info, _ := os.Stat(path)
		if info.Mode().Perm() != 0600 {
			t.Fatal("saved key must be owner-only")
		}
	}
}

func TestEnvironmentAndLock(t *testing.T) {
	home := t.TempDir()
	guard, err := lock(home)
	if err != nil {
		t.Fatal(err)
	}
	finished := make(chan error, 1)
	go func() {
		next, err := lock(home)
		if next != nil {
			next.Close()
		}
		finished <- err
	}()
	guard.Close()
	if err := <-finished; err != nil {
		t.Fatal(err)
	}
	t.Setenv("PI_CODING_AGENT_DIR", "host-settings")
	t.Setenv("OLLAMA_API_KEY", "")
	t.Setenv("PI_PORTABLE_VERSION", "host-version")
	t.Setenv("PI_PORTABLE_UPSTREAM_VERSION", "host-upstream")
	values := environment("/runtime", "/case/agent", "/case", "synthetic", "0.4.0", "9.8.7")
	joined := strings.Join(values, "\n")
	if !strings.Contains(joined, "PI_CODING_AGENT_DIR=/case/agent") || strings.Contains(joined, "host-settings") || strings.Contains(joined, "host-version") || strings.Contains(joined, "host-upstream") || !strings.Contains(joined, "PI_PORTABLE_UPSTREAM_VERSION=9.8.7") || !strings.Contains(joined, "PI_PORTABLE_VERSION=0.4.0") || !strings.Contains(joined, "OLLAMA_API_KEY=synthetic") {
		t.Fatal("portable environment not applied")
	}
}
