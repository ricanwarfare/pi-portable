using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

internal static class Program
{
    private static Dictionary<string, object> ReadObject(string path)
    {
        CheckPath(path);
        if (!File.Exists(path)) return new Dictionary<string, object>();
        try
        {
            var value = new JavaScriptSerializer().DeserializeObject(File.ReadAllText(path)) as Dictionary<string, object>;
            if (value != null) return value;
        }
        catch (ArgumentException) { }
        catch (InvalidOperationException) { }
        throw new IOException("Invalid JSON configuration: " + path);
    }

    private static string ReadSecret(Func<ConsoleKeyInfo> readKey)
    {
        var key = new StringBuilder();
        while (true)
        {
            var pressed = readKey();
            if (pressed.Key == ConsoleKey.Escape || (pressed.Key == ConsoleKey.C && (pressed.Modifiers & ConsoleModifiers.Control) != 0)) return null;
            if (pressed.Key == ConsoleKey.Enter) return key.ToString().Trim();
            if (pressed.Key == ConsoleKey.Backspace) { if (key.Length > 0) key.Length--; }
            else if (!Char.IsControl(pressed.KeyChar)) key.Append(pressed.KeyChar);
        }
    }

    private static bool NeedsOllamaSetup(string agent, List<string> args)
    {
        if (Console.IsInputRedirected || Console.IsOutputRedirected || Console.IsErrorRedirected) return false;
        if (args.Count > 0 && Array.IndexOf(new[] { "auth", "install", "remove", "uninstall", "update", "list", "config", "mcp" }, args[0]) >= 0) return false;
        var settings = ReadObject(Path.Combine(agent, "settings.json"));
        object provider;
        var selected = settings.TryGetValue("defaultProvider", out provider) ? provider as string : null;
        for (var i = 0; i < args.Count && args[i] != "--"; i++)
        {
            if (Array.IndexOf(new[] { "--help", "-h", "--version", "-v", "--list-models", "--export", "--api-key", "--continue", "-c", "--resume", "-r", "--session", "--session-id", "--fork" }, args[i]) >= 0) return false;
            if (args[i] == "--mode" && i + 1 < args.Count && args[i + 1] == "rpc") return false;
            if (args[i] == "--provider" && i + 1 < args.Count) selected = args[++i];
            else if (args[i] == "--model" && i + 1 < args.Count)
            {
                var model = args[++i];
                if (model.Contains("/")) selected = model.Substring(0, model.IndexOf('/'));
            }
        }
        if (selected != "ollama-cloud") return false;
        var auth = ReadObject(Path.Combine(agent, "auth.json"));
        if (auth.ContainsKey("ollama-cloud")) return false; // Leave Pi's own credential handling in control.
        var models = ReadObject(Path.Combine(agent, "models.json"));
        object providersValue, configuredValue, apiKey;
        if (!models.TryGetValue("providers", out providersValue)) return false;
        var providers = providersValue as Dictionary<string, object>;
        if (providers == null || !providers.TryGetValue("ollama-cloud", out configuredValue)) return false;
        var configured = configuredValue as Dictionary<string, object>;
        return configured != null && configured.TryGetValue("apiKey", out apiKey) &&
            ((apiKey as string) == "${OLLAMA_API_KEY}" || (apiKey as string) == "$OLLAMA_API_KEY");
    }

    private static string Hash(Stream stream)
    {
        using (var sha = SHA256.Create())
            return BitConverter.ToString(sha.ComputeHash(stream)).Replace("-", "").ToLowerInvariant();
    }

    // Reject directory junctions and symlinks in paths we create or execute from.
    private static void CheckPath(string path)
    {
        for (var item = Path.GetFullPath(path); !String.IsNullOrEmpty(item); item = Path.GetDirectoryName(item))
            if ((Directory.Exists(item) || File.Exists(item)) && (File.GetAttributes(item) & FileAttributes.ReparsePoint) != 0)
                throw new IOException("Portable paths cannot contain symlinks or junctions: " + item);
    }

    private static string EntryPath(string root, string name)
    {
        var prefix = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        var path = Path.GetFullPath(Path.Combine(prefix, name.Replace('/', Path.DirectorySeparatorChar)));
        if (!path.StartsWith(prefix, StringComparison.OrdinalIgnoreCase) || name.IndexOf(':') >= 0)
            throw new IOException("Unsafe archive path: " + name);
        CheckPath(path);
        return path;
    }

    private static FileStream Lock(string path)
    {
        for (var attempt = 0; ; attempt++)
        {
            CheckPath(path);
            try { return new FileStream(path, FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None); }
            catch (IOException) { if (attempt >= 120) throw; Thread.Sleep(250); }
        }
    }

    private static string Prepare(string home)
    {
        var runtime = Path.Combine(home, "runtime", BuildInfo.PayloadHash);
        Directory.CreateDirectory(Path.GetDirectoryName(runtime));
        using (Lock(Path.Combine(home, "runtime.lock")))
        using (var payload = Assembly.GetExecutingAssembly().GetManifestResourceStream("payload.zip"))
        {
            if (Hash(payload) != BuildInfo.PayloadHash) throw new IOException("Embedded payload checksum mismatch.");
            payload.Position = 0;
            using (var zip = new ZipArchive(payload, ZipArchiveMode.Read))
            {
                // Validate all paths before extracting anything. Verify cached bytes on each run.
                foreach (var entry in zip.Entries) EntryPath(runtime, entry.FullName);
                var valid = Directory.Exists(runtime);
                foreach (var entry in zip.Entries)
                {
                    if (String.IsNullOrEmpty(entry.Name)) continue;
                    var path = EntryPath(runtime, entry.FullName);
                    if (!File.Exists(path)) { valid = false; continue; }
                    using (var disk = File.OpenRead(path))
                    using (var original = entry.Open())
                        if (disk.Length != entry.Length || Hash(disk) != Hash(original)) valid = false;
                }
                if (!valid)
                {
                    if (Directory.Exists(runtime))
                        throw new IOException("Runtime is incomplete or modified. Move this runtime directory aside and retry: " + runtime);
                    var stage = runtime + ".staging-" + Guid.NewGuid().ToString("N");
                    Directory.CreateDirectory(stage);
                    // Preserve a failed staging directory for inspection instead of recursive deletion.
                    foreach (var entry in zip.Entries)
                    {
                        var path = EntryPath(stage, entry.FullName);
                        if (String.IsNullOrEmpty(entry.Name)) { Directory.CreateDirectory(path); continue; }
                        Directory.CreateDirectory(Path.GetDirectoryName(path));
                        using (var source = entry.Open())
                        using (var target = new FileStream(path, FileMode.CreateNew, FileAccess.Write)) source.CopyTo(target);
                    }
                    // Antivirus/indexers can briefly hold a newly extracted directory open.
                    for (var attempt = 0; ; attempt++)
                    {
                        CheckPath(stage);
                        CheckPath(runtime);
                        try { Directory.Move(stage, runtime); break; }
                        catch (UnauthorizedAccessException) { if (attempt >= 20) throw; Thread.Sleep(100); }
                        catch (IOException) { if (attempt >= 20 || Directory.Exists(runtime)) throw; Thread.Sleep(100); }
                    }
                }
            }
        }
        if (!File.Exists(Path.Combine(runtime, "pi.exe"))) throw new IOException("Payload has no pi.exe at its root.");
        return runtime;
    }

    // CommandLineToArgvW-compatible quoting, including empty args and trailing backslashes.
    private static string Quote(string value)
    {
        var result = new StringBuilder("\"");
        var slashes = 0;
        foreach (var ch in value)
        {
            if (ch == '\\') { slashes++; continue; }
            if (ch == '"') result.Append('\\', slashes * 2 + 1);
            else result.Append('\\', slashes);
            result.Append(ch);
            slashes = 0;
        }
        result.Append('\\', slashes * 2);
        return result.Append('"').ToString();
    }

    private static int Main(string[] args)
    {
        try
        {
            var collectOnly = args.Length == 1 && args[0] == "--portable-triage";
            if (Array.IndexOf(args, "--") < 0 && Array.IndexOf(args, "--portable-triage") >= 0 && !collectOnly) throw new IOException("Use --portable-triage by itself. For labeled collection use /triage inside Pi.");
            if (collectOnly) args = new[] { "--no-session", "--print", "/triage" };
            var home = Environment.GetEnvironmentVariable("PI_PORTABLE_HOME");
            if (String.IsNullOrWhiteSpace(home)) home = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "pi-portable-data");
            home = Path.GetFullPath(home);
            var forwarded = new List<string>();
            var info = false;
            var setup = false;
            var hasTools = false;
            var literal = false;
            foreach (var arg in args)
            {
                if (!literal && arg == "--portable-notices")
                {
                    using (var notice = new StreamReader(Assembly.GetExecutingAssembly().GetManifestResourceStream("NOTICE.txt"))) Console.Write(notice.ReadToEnd());
                    return 0;
                }
                if (!literal && arg == "--portable-info") { info = true; continue; }
                if (!literal && arg == "--portable-setup") { setup = true; continue; }
                if (!literal && (arg == "--tools" || arg == "-t" || arg == "--no-tools" || arg == "-nt" || arg == "--no-builtin-tools" || arg == "-nbt")) hasTools = true;
                forwarded.Add(arg);
                if (arg == "--") literal = true;
            }
            if (info)
            {
                Console.WriteLine("Pi Portable " + BuildInfo.Version + " / Windows x64\nPayload SHA256: " + BuildInfo.PayloadHash + "\nPortable home: " + home);
                Console.WriteLine("Runtime: <home>\\runtime\\<payload-sha256>\nConfig/auth: <home>\\agent\nSessions: <home>\\sessions\nTemp: <home>\\tmp");
                Console.WriteLine("Cloud preset: Ollama Cloud. First interactive launch prompts for a key; --portable-setup replaces the saved key. OLLAMA_API_KEY overrides the saved key.");
                return 0;
            }
            CheckPath(home);
            Directory.CreateDirectory(home);
            var runtime = Prepare(home);
            var agent = Path.Combine(home, "agent");
            var sessions = Path.Combine(home, "sessions");
            var temp = Path.Combine(home, "tmp");
            foreach (var path in new[] { agent, sessions, temp }) { CheckPath(path); Directory.CreateDirectory(path); }
            using (Lock(Path.Combine(home, "runtime.lock")))
            {
                foreach (var name in new[] { "models.json", "settings.json" })
                {
                    var path = Path.Combine(agent, name);
                    CheckPath(path);
                    if (File.Exists(path)) continue;
                    using (var source = Assembly.GetExecutingAssembly().GetManifestResourceStream("defaults." + name))
                    using (var destination = new FileStream(path, FileMode.CreateNew, FileAccess.Write)) source.CopyTo(destination);
                }
            }
            var keyPath = Path.Combine(agent, "ollama-cloud.key");
            CheckPath(keyPath);
            var cloudKey = Environment.GetEnvironmentVariable("OLLAMA_API_KEY");
            if (!collectOnly && String.IsNullOrWhiteSpace(cloudKey) && File.Exists(keyPath)) cloudKey = File.ReadAllText(keyPath).Trim();
            if (!collectOnly && (setup || (String.IsNullOrWhiteSpace(cloudKey) && NeedsOllamaSetup(agent, forwarded))))
            {
                if (Console.IsInputRedirected || Console.IsOutputRedirected || Console.IsErrorRedirected)
                    throw new IOException("API key setup requires an interactive console. Run pi-portable.exe --portable-setup in a terminal, or set OLLAMA_API_KEY.");
                Console.Error.WriteLine("Ollama Cloud setup: paste your API key, then press Enter. Input is hidden; Esc or Ctrl+C cancels.");
                Console.Error.WriteLine("The key will be saved in plaintext on this drive: " + keyPath);
                var previousControlC = Console.TreatControlCAsInput;
                try
                {
                    Console.TreatControlCAsInput = true;
                    do
                    {
                        Console.Error.Write("API key: ");
                        cloudKey = ReadSecret(delegate { return Console.ReadKey(true); });
                        Console.Error.WriteLine();
                        if (cloudKey == null) return 130;
                        if (cloudKey.Length == 0) Console.Error.WriteLine("Enter a non-empty key, or press Esc to cancel.");
                    } while (cloudKey.Length == 0);
                }
                finally { Console.TreatControlCAsInput = previousControlC; }
                using (Lock(Path.Combine(home, "runtime.lock")))
                {
                    CheckPath(keyPath);
                    var pending = keyPath + ".pending-" + Guid.NewGuid().ToString("N");
                    File.WriteAllText(pending, cloudKey, new UTF8Encoding(false));
                    if (File.Exists(keyPath)) File.Replace(pending, keyPath, null);
                    else File.Move(pending, keyPath);
                }
                Console.Error.WriteLine("Key saved. Starting Pi...");
            }
            var defaults = new List<string> { "--offline", "--no-approve", "--no-extensions", "--no-mcp", "--no-skills", "--no-prompt-templates", "--no-themes", "--no-context-files" };
            defaults.AddRange(new[] { "--extension", Path.Combine(runtime, "portable", "triage.mjs") });
            if (!hasTools) defaults.AddRange(new[] { "--tools", "read,powershell,grep,find,ls" });
            // Upstream dispatches subcommands by args[0]; flags must not precede them.
            if (forwarded.Count > 0 && Array.IndexOf(new[] { "auth", "install", "remove", "uninstall", "update", "list", "config", "mcp" }, forwarded[0]) >= 0) defaults.Clear();
            defaults.AddRange(forwarded);
            var commandLine = new List<string>();
            foreach (var arg in defaults) commandLine.Add(Quote(arg));
            var start = new ProcessStartInfo(Path.Combine(runtime, "pi.exe"), String.Join(" ", commandLine));
            start.UseShellExecute = false;
            start.WorkingDirectory = Environment.CurrentDirectory;
            start.EnvironmentVariables["PI_CODING_AGENT_DIR"] = agent;
            start.EnvironmentVariables["PI_CODING_AGENT_SESSION_DIR"] = sessions;
            start.EnvironmentVariables["PI_PACKAGE_DIR"] = runtime;
            start.EnvironmentVariables["PI_OFFLINE"] = "1";
            start.EnvironmentVariables["PI_TELEMETRY"] = "0";
            start.EnvironmentVariables["PI_PORTABLE_VERSION"] = BuildInfo.Version;
            if (!String.IsNullOrWhiteSpace(cloudKey)) start.EnvironmentVariables["OLLAMA_API_KEY"] = cloudKey;
            start.EnvironmentVariables["PATH"] = Path.Combine(runtime, "tools", "rg") + ";" + Path.Combine(runtime, "tools", "fd") + ";" + Environment.GetEnvironmentVariable("PATH");
            start.EnvironmentVariables["TEMP"] = temp;
            start.EnvironmentVariables["TMP"] = temp;
            start.EnvironmentVariables["BUN_TMPDIR"] = temp;
            // Child shares the console, receives Ctrl+C itself, and owns terminal raw mode.
            Console.CancelKeyPress += delegate(object sender, ConsoleCancelEventArgs e) { e.Cancel = true; };
            using (var child = Process.Start(start)) { child.WaitForExit(); return child.ExitCode; }
        }
        catch (Exception error) { Console.Error.WriteLine("pi-portable: " + error.Message); return 1; }
    }
}
