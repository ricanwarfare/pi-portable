package main

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"
	"unsafe"
)

//go:embed bundle/*
var bundle embed.FS

type payloadFile struct {
	Path   string
	SHA256 string
	Mode   uint32
}
type metadata struct {
	Version       string
	PayloadSHA256 string
	Files         []payloadFile
}

func checkPath(path string) error {
	path, err := filepath.Abs(path)
	if err != nil {
		return err
	}
	for {
		info, err := os.Lstat(path)
		if err != nil && !os.IsNotExist(err) {
			return err
		}
		if err == nil && info.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("portable paths cannot contain symlinks: %s", path)
		}
		parent := filepath.Dir(path)
		if parent == path {
			return nil
		}
		path = parent
	}
}

func entryPath(root, name string) (string, error) {
	if name == "" || name == "." || filepath.IsAbs(name) || strings.Contains(name, "\\") {
		return "", fmt.Errorf("unsafe archive path: %s", name)
	}
	for _, part := range strings.Split(name, "/") {
		if part == ".." {
			return "", fmt.Errorf("unsafe archive path: %s", name)
		}
	}
	path := filepath.Join(root, name)
	if err := checkPath(path); err != nil {
		return "", err
	}
	return path, nil
}

func hashReader(reader io.Reader) (string, error) {
	hash := sha256.New()
	_, err := io.Copy(hash, reader)
	return hex.EncodeToString(hash.Sum(nil)), err
}

func lock(home string) (*os.File, error) {
	path := filepath.Join(home, "runtime.lock")
	if err := checkPath(path); err != nil {
		return nil, err
	}
	fd, err := syscall.Open(path, syscall.O_CREAT|syscall.O_RDWR|syscall.O_NOFOLLOW|syscall.O_CLOEXEC, 0600)
	if err != nil {
		return nil, err
	}
	file := os.NewFile(uintptr(fd), path)
	for i := 0; i < 120; i++ {
		err = syscall.Flock(fd, syscall.LOCK_EX|syscall.LOCK_NB)
		if err == nil {
			return file, nil
		}
		if err != syscall.EWOULDBLOCK && err != syscall.EAGAIN {
			file.Close()
			return nil, err
		}
		time.Sleep(250 * time.Millisecond)
	}
	file.Close()
	return nil, errors.New("timed out waiting for portable runtime lock")
}

func verifyRuntime(root string, files []payloadFile) error {
	expected := make(map[string]bool)
	for _, file := range files {
		path, err := entryPath(root, file.Path)
		if err != nil {
			return err
		}
		info, err := os.Lstat(path)
		if err != nil {
			return err
		}
		if !info.Mode().IsRegular() {
			return fmt.Errorf("not a regular runtime file: %s", path)
		}
		input, err := os.Open(path)
		if err != nil {
			return err
		}
		hash, err := hashReader(input)
		input.Close()
		if err != nil {
			return err
		}
		if hash != file.SHA256 {
			return fmt.Errorf("modified runtime file: %s", path)
		}
		if file.Mode&0111 != 0 && info.Mode().Perm()&0100 == 0 {
			return fmt.Errorf("runtime file is not executable: %s", path)
		}
		expected[filepath.Clean(path)] = true
	}
	return filepath.WalkDir(root, func(path string, item os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if item.Type()&os.ModeSymlink != 0 {
			return fmt.Errorf("symlink in runtime: %s", path)
		}
		if !item.IsDir() && !expected[path] {
			return fmt.Errorf("unexpected runtime file: %s", path)
		}
		return nil
	})
}

func extract(root string, payload []byte, files []payloadFile) error {
	expected := make(map[string]payloadFile)
	for _, file := range files {
		expected[file.Path] = file
	}
	compressed, err := gzip.NewReader(bytes.NewReader(payload))
	if err != nil {
		return err
	}
	defer compressed.Close()
	archive := tar.NewReader(compressed)
	seen := make(map[string]bool)
	for {
		header, err := archive.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return err
		}
		path, err := entryPath(root, header.Name)
		if err != nil {
			return err
		}
		file, ok := expected[header.Name]
		if header.Typeflag != tar.TypeReg || !ok || seen[header.Name] {
			return fmt.Errorf("unsupported or duplicate payload entry: %s", header.Name)
		}
		seen[header.Name] = true
		if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
			return err
		}
		mode := os.FileMode(0600)
		if file.Mode&0111 != 0 {
			mode = 0700
		}
		output, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, mode)
		if err != nil {
			return err
		}
		hash := sha256.New()
		_, copyErr := io.Copy(io.MultiWriter(output, hash), archive)
		closeErr := output.Close()
		if copyErr != nil {
			return copyErr
		}
		if closeErr != nil {
			return closeErr
		}
		if hex.EncodeToString(hash.Sum(nil)) != file.SHA256 {
			return fmt.Errorf("payload file checksum mismatch: %s", header.Name)
		}
	}
	if len(seen) != len(expected) {
		return errors.New("incomplete embedded payload")
	}
	return nil
}

func prepare(home string, meta metadata) (string, error) {
	runtime := filepath.Join(home, "runtime", meta.PayloadSHA256)
	if err := checkPath(runtime); err != nil {
		return "", err
	}
	if err := os.MkdirAll(filepath.Dir(runtime), 0700); err != nil {
		return "", err
	}
	guard, err := lock(home)
	if err != nil {
		return "", err
	}
	defer guard.Close()
	payload, err := bundle.ReadFile("bundle/payload.tar.gz")
	if err != nil {
		return "", err
	}
	hash := sha256.Sum256(payload)
	if hex.EncodeToString(hash[:]) != meta.PayloadSHA256 {
		return "", errors.New("embedded payload checksum mismatch")
	}
	if _, err := os.Lstat(runtime); err == nil {
		if err := verifyRuntime(runtime, meta.Files); err != nil {
			return "", fmt.Errorf("runtime is incomplete or modified; move it aside and retry: %s: %w", runtime, err)
		}
	} else if os.IsNotExist(err) {
		stage, err := os.MkdirTemp(filepath.Dir(runtime), meta.PayloadSHA256+".staging-")
		if err != nil {
			return "", err
		}
		if err := extract(stage, payload, meta.Files); err != nil {
			return "", err
		}
		if err := os.Rename(stage, runtime); err != nil {
			return "", err
		}
	} else {
		return "", err
	}
	return runtime, nil
}

func readObject(path string) (map[string]json.RawMessage, error) {
	if err := checkPath(path); err != nil {
		return nil, err
	}
	data, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return map[string]json.RawMessage{}, nil
	}
	if err != nil {
		return nil, err
	}
	var object map[string]json.RawMessage
	if json.Unmarshal(data, &object) != nil || object == nil {
		return nil, fmt.Errorf("invalid JSON configuration: %s", path)
	}
	return object, nil
}

func tty(fd uintptr) (*syscall.Termios, error) {
	var state syscall.Termios
	_, _, errno := syscall.Syscall(syscall.SYS_IOCTL, fd, syscall.TCGETS, uintptr(unsafe.Pointer(&state)))
	if errno != 0 {
		return nil, errno
	}
	return &state, nil
}

func setTTY(state *syscall.Termios) error {
	_, _, errno := syscall.Syscall(syscall.SYS_IOCTL, os.Stdin.Fd(), syscall.TCSETS, uintptr(unsafe.Pointer(state)))
	if errno != 0 {
		return errno
	}
	return nil
}

func interactive() bool {
	for _, stream := range []*os.File{os.Stdin, os.Stdout, os.Stderr} {
		if _, err := tty(stream.Fd()); err != nil {
			return false
		}
	}
	return true
}

var canceled = errors.New("setup canceled")

func readSecret(reader io.Reader) (string, error) {
	var key []byte
	buffer := make([]byte, 1)
	for {
		if _, err := io.ReadFull(reader, buffer); err != nil {
			return "", err
		}
		switch buffer[0] {
		case 3, 27:
			return "", canceled
		case '\r', '\n':
			return strings.TrimSpace(string(key)), nil
		case 8, 127:
			if len(key) > 0 {
				key = key[:len(key)-1]
			}
		default:
			if buffer[0] >= 32 {
				key = append(key, buffer[0])
			}
		}
	}
}

func promptKey() (string, error) {
	original, err := tty(os.Stdin.Fd())
	if err != nil {
		return "", err
	}
	hidden := *original
	hidden.Lflag &^= syscall.ECHO | syscall.ICANON | syscall.ISIG
	hidden.Cc[syscall.VMIN] = 1
	hidden.Cc[syscall.VTIME] = 0
	if err := setTTY(&hidden); err != nil {
		return "", err
	}
	defer setTTY(original)
	signals := make(chan os.Signal, 1)
	signal.Notify(signals, syscall.SIGINT, syscall.SIGTERM, syscall.SIGHUP)
	defer signal.Stop(signals)
	for {
		fmt.Fprint(os.Stderr, "API key: ")
		type result struct {
			key string
			err error
		}
		input := make(chan result, 1)
		go func() { key, err := readSecret(os.Stdin); input <- result{key, err} }()
		select {
		case <-signals:
			fmt.Fprintln(os.Stderr)
			return "", canceled
		case value := <-input:
			fmt.Fprintln(os.Stderr)
			if value.err != nil {
				return "", value.err
			}
			if value.key != "" {
				return value.key, nil
			}
			fmt.Fprintln(os.Stderr, "Enter a non-empty key, or press Esc to cancel.")
		}
	}
}

func needsSetup(agent string, args []string) (bool, error) {
	if !interactive() {
		return false, nil
	}
	if len(args) > 0 && subcommand(args[0]) {
		return false, nil
	}
	settings, err := readObject(filepath.Join(agent, "settings.json"))
	if err != nil {
		return false, err
	}
	var provider string
	json.Unmarshal(settings["defaultProvider"], &provider)
	for i := 0; i < len(args) && args[i] != "--"; i++ {
		switch args[i] {
		case "--help", "-h", "--version", "-v", "--list-models", "--export", "--api-key", "--continue", "-c", "--resume", "-r", "--session", "--session-id", "--fork":
			return false, nil
		case "--mode":
			if i+1 < len(args) && args[i+1] == "rpc" {
				return false, nil
			}
		case "--provider":
			if i+1 < len(args) {
				i++
				provider = args[i]
			}
		case "--model":
			if i+1 < len(args) {
				i++
				if strings.Contains(args[i], "/") {
					provider = strings.SplitN(args[i], "/", 2)[0]
				}
			}
		}
	}
	if provider != "ollama-cloud" {
		return false, nil
	}
	auth, err := readObject(filepath.Join(agent, "auth.json"))
	if err != nil {
		return false, err
	}
	if _, ok := auth["ollama-cloud"]; ok {
		return false, nil
	}
	models, err := readObject(filepath.Join(agent, "models.json"))
	if err != nil {
		return false, err
	}
	var providers map[string]struct{ APIKey string }
	json.Unmarshal(models["providers"], &providers)
	key := providers["ollama-cloud"].APIKey
	return key == "${OLLAMA_API_KEY}" || key == "$OLLAMA_API_KEY", nil
}

func subcommand(arg string) bool {
	switch arg {
	case "auth", "install", "remove", "uninstall", "update", "list", "config", "mcp":
		return true
	}
	return false
}

func writeKey(home, path, key string) error {
	guard, err := lock(home)
	if err != nil {
		return err
	}
	defer guard.Close()
	if err := checkPath(path); err != nil {
		return err
	}
	file, err := os.CreateTemp(filepath.Dir(path), "ollama-cloud.key.pending-")
	if err != nil {
		return err
	}
	if _, err := file.WriteString(key); err != nil {
		file.Close()
		return err
	}
	if err := file.Sync(); err != nil {
		file.Close()
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	return os.Rename(file.Name(), path)
}

func environment(runtime, agent, home, cloudKey, version string) []string {
	overrides := map[string]string{"PI_CODING_AGENT_DIR": agent, "PI_CODING_AGENT_SESSION_DIR": filepath.Join(home, "sessions"), "PI_PACKAGE_DIR": runtime, "PI_OFFLINE": "1", "PI_TELEMETRY": "0", "PI_PORTABLE_VERSION": version,
		"PATH": filepath.Join(runtime, "tools/rg") + ":" + filepath.Join(runtime, "tools/fd") + ":" + os.Getenv("PATH"), "TMPDIR": filepath.Join(home, "tmp"), "TMP": filepath.Join(home, "tmp"), "TEMP": filepath.Join(home, "tmp"), "BUN_TMPDIR": filepath.Join(home, "tmp")}
	if cloudKey != "" {
		overrides["OLLAMA_API_KEY"] = cloudKey
	}
	var result []string
	for _, entry := range os.Environ() {
		key := strings.SplitN(entry, "=", 2)[0]
		if _, ok := overrides[key]; !ok {
			result = append(result, entry)
		}
	}
	for key, value := range overrides {
		result = append(result, key+"="+value)
	}
	return result
}

func run(args []string) error {
	collectOnly := len(args) == 1 && args[0] == "--portable-triage"
	for _, arg := range args {
		if arg == "--" {
			break
		}
		if arg == "--portable-triage" && !collectOnly {
			return errors.New("use --portable-triage by itself; for labeled collection use /triage inside Pi")
		}
	}
	if collectOnly {
		args = []string{"--no-session", "--print", "/triage"}
	}
	var meta metadata
	data, err := bundle.ReadFile("bundle/metadata.json")
	if err != nil {
		return err
	}
	if err := json.Unmarshal(data, &meta); err != nil {
		return err
	}
	executable, err := os.Executable()
	if err != nil {
		return err
	}
	home := os.Getenv("PI_PORTABLE_HOME")
	if home == "" {
		home = filepath.Join(filepath.Dir(executable), "pi-portable-data")
	}
	home, err = filepath.Abs(home)
	if err != nil {
		return err
	}
	var forwarded []string
	info, setup, literal, hasTools := false, false, false, false
	for _, arg := range args {
		if !literal {
			switch arg {
			case "--portable-notices":
				notice, err := bundle.ReadFile("bundle/NOTICE.txt")
				if err != nil {
					return err
				}
				fmt.Print(string(notice))
				return nil
			case "--portable-info":
				info = true
				continue
			case "--portable-setup":
				setup = true
				continue
			case "--tools", "-t", "--no-tools", "-nt", "--no-builtin-tools", "-nbt":
				hasTools = true
			}
		}
		forwarded = append(forwarded, arg)
		if arg == "--" {
			literal = true
		}
	}
	if info {
		fmt.Printf("Pi Portable %s / Linux x64\nPayload SHA256: %s\nPortable home: %s\nCloud preset: Ollama Cloud; first interactive launch prompts for a key.\n", meta.Version, meta.PayloadSHA256, home)
		return nil
	}
	if err := checkPath(home); err != nil {
		return err
	}
	if err := os.MkdirAll(home, 0700); err != nil {
		return err
	}
	runtime, err := prepare(home, meta)
	if err != nil {
		return err
	}
	agent := filepath.Join(home, "agent")
	for _, path := range []string{agent, filepath.Join(home, "sessions"), filepath.Join(home, "tmp")} {
		if err := checkPath(path); err != nil {
			return err
		}
		if err := os.MkdirAll(path, 0700); err != nil {
			return err
		}
	}
	guard, err := lock(home)
	if err != nil {
		return err
	}
	err = func() error {
		defer guard.Close()
		for _, name := range []string{"models.json", "settings.json"} {
			path := filepath.Join(agent, name)
			if err := checkPath(path); err != nil {
				return err
			}
			data, err := bundle.ReadFile("bundle/" + name)
			if err != nil {
				return err
			}
			file, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
			if os.IsExist(err) {
				continue
			}
			if err != nil {
				return err
			}
			_, writeErr := file.Write(data)
			closeErr := file.Close()
			if writeErr != nil {
				return writeErr
			}
			if closeErr != nil {
				return closeErr
			}
		}
		return nil
	}()
	if err != nil {
		return err
	}
	keyPath := filepath.Join(agent, "ollama-cloud.key")
	if err := checkPath(keyPath); err != nil {
		return err
	}
	cloudKey := strings.TrimSpace(os.Getenv("OLLAMA_API_KEY"))
	if !collectOnly && cloudKey == "" {
		data, err := os.ReadFile(keyPath)
		if err != nil && !os.IsNotExist(err) {
			return err
		}
		cloudKey = strings.TrimSpace(string(data))
	}
	ask := setup
	if !collectOnly && !ask && cloudKey == "" {
		ask, err = needsSetup(agent, forwarded)
		if err != nil {
			return err
		}
	}
	if ask {
		if !interactive() {
			return errors.New("API key setup requires an interactive terminal; use --portable-setup in a terminal or set OLLAMA_API_KEY")
		}
		fmt.Fprintln(os.Stderr, "Ollama Cloud setup: input is hidden; Enter saves, Esc/Ctrl+C cancels.")
		fmt.Fprintln(os.Stderr, "The key will be saved in plaintext on this drive:", keyPath)
		cloudKey, err = promptKey()
		if err != nil {
			return err
		}
		if err := writeKey(home, keyPath, cloudKey); err != nil {
			return err
		}
		fmt.Fprintln(os.Stderr, "Key saved. Starting Pi...")
	}
	defaults := []string{"--offline", "--no-approve", "--no-extensions", "--no-mcp", "--no-skills", "--no-prompt-templates", "--no-themes", "--no-context-files"}
	defaults = append(defaults, "--extension", filepath.Join(runtime, "portable", "triage.mjs"))
	defaults = append(defaults, "--extension", filepath.Join(runtime, "portable", "web", "index.ts"))
	if !hasTools {
		defaults = append(defaults, "--tools", "read,bash,grep,find,ls,web_search,url_context")
	}
	if len(forwarded) > 0 && subcommand(forwarded[0]) {
		defaults = nil
	}
	child := filepath.Join(runtime, "pi")
	childArgs := append([]string{child}, append(defaults, forwarded...)...)
	childEnv := environment(runtime, agent, home, cloudKey, meta.Version)
	if err := syscall.Exec(child, childArgs, childEnv); err != nil {
		return fmt.Errorf("cannot execute Pi (check Linux compatibility and noexec mount settings): %w", err)
	}
	return nil
}

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, "pi-portable:", err)
		if errors.Is(err, canceled) {
			os.Exit(130)
		}
		os.Exit(1)
	}
}
