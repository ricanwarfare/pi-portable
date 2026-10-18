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
                if (valid)
                {
                    var expected = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                    foreach (var entry in zip.Entries)
                        if (!String.IsNullOrEmpty(entry.Name)) expected.Add(EntryPath(runtime, entry.FullName));
                    var directories = new Stack<string>();
                    directories.Push(runtime);
                    while (directories.Count > 0)
                    {
                        var directory = directories.Pop();
                        CheckPath(directory);
                        foreach (var item in Directory.EnumerateFileSystemEntries(directory))
                        {
                            CheckPath(item);
                            if (Directory.Exists(item)) directories.Push(item);
                            else if (!expected.Contains(Path.GetFullPath(item)))
                                throw new IOException("Unexpected runtime file. Move this runtime directory aside and retry: " + item);
                        }
                    }
                }
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

    private static string Text(Dictionary<string, object> config, string key, string fallback)
    {
        object value;
        if (!config.TryGetValue(key, out value)) return fallback;
        if (!(value is string)) throw new IOException(key + " must be a string.");
        return (string)value;
    }

    private static void WriteJson(string path, object value)
    {
        CheckPath(path);
        File.WriteAllText(path, new JavaScriptSerializer().Serialize(value), new UTF8Encoding(false));
    }

    private static string ProjectRoot(string path)
    {
        path = Path.GetFullPath(path);
        if (!Directory.Exists(path)) throw new IOException("Project directory does not exist.");
        for (var item = path; !String.IsNullOrEmpty(item); item = Path.GetDirectoryName(item))
            if (Directory.Exists(Path.Combine(item, ".git")) || File.Exists(Path.Combine(item, ".git"))) return item;
        return path;
    }

    private static string Tools(string profile)
    {
        switch (profile)
        {
            case "review": return "read,grep,find,ls";
            case "edit": return "read,grep,find,ls,write,edit";
            case "full": return "read,grep,find,ls,write,edit,powershell";
            default: throw new IOException("Profile must be review, edit, or full.");
        }
    }

    private static int Main(string[] args)
    {
        AppContext.SetSwitch("Switch.System.IO.UseLegacyPathHandling", false);
        AppContext.SetSwitch("Switch.System.IO.BlockLongPaths", false);
        string run = null;
        try
        {
            var home = Environment.GetEnvironmentVariable("PI_PORTABLE_HOME");
            var storage = Environment.GetEnvironmentVariable("PI_PORTABLE_STORAGE") ?? "portable";
            string configPath = null, project = Environment.CurrentDirectory, projectId = null, profile = null, forkSession = null;
            bool info = false, configure = false, promptKey = false;
            bool? webEnabled = null;
            var forwarded = new List<string>();
            // Deliberately narrow upstream surface: wrapper policy cannot be disabled by flag order.
            var values = new[] { "--name", "-n", "--thinking", "--mode", "--system-prompt", "--append-system-prompt", "--tui-mode" };
            var flags = new[] { "--print", "-p", "--continue", "-c", "--resume", "-r", "--no-session", "--verbose", "--help", "-h", "--version", "-v" };
            for (var i = 0; i < args.Length; i++)
            {
                var arg = args[i];
                if (arg == "--") { for (; i < args.Length; i++) forwarded.Add(args[i]); break; }
                if (arg == "--portable-notices")
                {
                    using (var notice = new StreamReader(Assembly.GetExecutingAssembly().GetManifestResourceStream("NOTICE.txt"))) Console.Write(notice.ReadToEnd());
                    return 0;
                }
                if (arg == "--portable-info") { info = true; continue; }
                if (arg == "--configure") { configure = true; continue; }
                if (arg == "--session-key") { promptKey = true; continue; }
                if (arg == "--web") { webEnabled = true; continue; }
                if (arg == "--no-web") { webEnabled = false; continue; }
                if (Array.IndexOf(new[] { "--portable-home", "--portable-storage", "--portable-config", "--project", "--project-id", "--profile", "--fork-session" }, arg) >= 0)
                {
                    if (++i == args.Length) throw new IOException("Missing value for " + arg);
                    switch (arg)
                    {
                        case "--portable-home": home = args[i]; break;
                        case "--portable-storage": storage = args[i]; break;
                        case "--portable-config": configPath = args[i]; break;
                        case "--project": project = args[i]; break;
                        case "--project-id": projectId = args[i]; break;
                        case "--profile": profile = args[i]; break;
                        case "--fork-session": forkSession = args[i]; break;
                    }
                    continue;
                }
                if (Array.IndexOf(values, arg) >= 0)
                {
                    forwarded.Add(arg);
                    if (++i == args.Length) throw new IOException("Missing value for " + arg);
                    if (arg == "--mode" && args[i] != "rpc" && args[i] != "json" && args[i] != "text") throw new IOException("Unsupported mode.");
                    forwarded.Add(args[i]); continue;
                }
                if (arg.StartsWith("-") && Array.IndexOf(flags, arg) < 0) throw new IOException("Unsupported option: " + arg + ". Use --profile and portable.json to configure tools and providers.");
                if (forwarded.Count == 0 && Array.IndexOf(new[] { "auth", "install", "remove", "uninstall", "update", "list", "config", "mcp" }, arg) >= 0)
                    throw new IOException("Network/package/auth subcommands are disabled in Pi Portable.");
                forwarded.Add(arg);
            }
            if (storage != "portable" && storage != "user") throw new IOException("Storage must be portable or user.");
            if (String.IsNullOrWhiteSpace(home)) home = storage == "user"
                ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "PiPortable")
                : Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "pi-portable-data");
            home = Path.GetFullPath(home);
            configPath = Path.GetFullPath(configPath ?? Path.Combine(home, "portable.json"));
            project = ProjectRoot(project);
            if (projectId == null)
                using (var bytes = new MemoryStream(Encoding.UTF8.GetBytes(project.TrimEnd('\\').ToUpperInvariant()))) projectId = Hash(bytes).Substring(0, 24);
            if (!System.Text.RegularExpressions.Regex.IsMatch(projectId, "^[a-zA-Z0-9_-]{1,64}$")) throw new IOException("Project id must use 1-64 letters, digits, underscores or hyphens.");
            if (info)
            {
                Console.WriteLine("Pi Portable " + BuildInfo.Version + " / Windows x64\nPayload SHA256: " + BuildInfo.PayloadHash + "\nState: " + home + "\nConfig: " + configPath + "\nProject: " + project + "\nProject id: " + projectId);
                return 0;
            }
            if (configure)
            {
                CheckPath(configPath);
                Directory.CreateDirectory(Path.GetDirectoryName(configPath));
                if (File.Exists(configPath)) throw new IOException("Configuration already exists; edit it directly: " + configPath);
                WriteJson(configPath, new { kind = "openai", baseUrl = "https://model.internal.example/v1", model = "your-model-id", auth = "bearer", keyEnv = "PI_PORTABLE_API_KEY", profile = "review", proxy = "env", caFile = "", contextWindow = 32768, maxTokens = 4096 });
                Console.WriteLine("Edit the endpoint and model in " + configPath + ". No connection was made.");
                return 0;
            }
            var localOnly = false;
            for (var i = 0; i < forwarded.Count && forwarded[i] != "--"; i++)
            {
                if (Array.IndexOf(new[] { "--help", "-h", "--version", "-v" }, forwarded[i]) >= 0) localOnly = true;
                if (Array.IndexOf(values, forwarded[i]) >= 0) i++;
            }
            var config = ReadObject(configPath);
            var known = new[] { "kind", "baseUrl", "model", "auth", "keyEnv", "profile", "proxy", "caFile", "contextWindow", "maxTokens", "api", "apiVersion", "headers", "compat", "allowHttp", "web" };
            foreach (var key in config.Keys) if (Array.IndexOf(known, key) < 0) throw new IOException("Unknown configuration field: " + key);
            var kind = Text(config, "kind", "openai");
            if (Array.IndexOf(new[] { "openai", "ollama", "azure", "custom" }, kind) < 0) throw new IOException("Unknown endpoint kind.");
            var endpoint = Text(config, "baseUrl", "").TrimEnd('/');
            var model = Text(config, "model", "");
            Uri uri;
            if (!localOnly && (!Uri.TryCreate(endpoint, UriKind.Absolute, out uri) || (uri.Scheme != "https" && uri.Scheme != "http") || !String.IsNullOrEmpty(uri.UserInfo) || !String.IsNullOrEmpty(uri.Query) || !String.IsNullOrEmpty(uri.Fragment) || String.IsNullOrWhiteSpace(model)))
                throw new IOException("Configure baseUrl (HTTP(S), no credentials/query/fragment) and model with --configure, then edit portable.json.");
            profile = profile ?? Text(config, "profile", "review");
            var tools = Tools(profile);
            var auth = Text(config, "auth", kind == "ollama" ? "none" : kind == "azure" ? "api-key" : "bearer");
            if (Array.IndexOf(new[] { "none", "bearer", "api-key" }, auth) < 0) throw new IOException("auth must be none, bearer, or api-key.");
            var keyEnv = Text(config, "keyEnv", "PI_PORTABLE_API_KEY");
            if (!System.Text.RegularExpressions.Regex.IsMatch(keyEnv, "^[A-Za-z_][A-Za-z0-9_]*$")) throw new IOException("Invalid keyEnv name.");
            var keyValue = Environment.GetEnvironmentVariable(keyEnv);
            if (!localOnly && auth != "none" && (promptKey || String.IsNullOrWhiteSpace(keyValue)))
            {
                if (Console.IsInputRedirected || Console.IsOutputRedirected || Console.IsErrorRedirected) throw new IOException("Set " + keyEnv + " in this process environment; interactive key entry requires a terminal.");
                var previous = Console.TreatControlCAsInput;
                try
                {
                    Console.TreatControlCAsInput = true;
                    Console.Error.Write("Session API key (hidden; Esc cancels): ");
                    keyValue = ReadSecret(delegate { return Console.ReadKey(true); }); Console.Error.WriteLine();
                    if (keyValue == null) return 130;
                    if (keyValue.Length == 0) throw new IOException("Empty API key.");
                }
                finally { Console.TreatControlCAsInput = previous; }
            }
            var api = Text(config, "api", "openai-completions");
            if (api != "openai-completions" && api != "openai-responses") throw new IOException("api must be openai-completions or openai-responses.");
            var ca = Text(config, "caFile", "");
            if (ca.Length > 0) { ca = Path.GetFullPath(Path.Combine(Path.GetDirectoryName(configPath), ca)); CheckPath(ca); if (!File.Exists(ca)) throw new IOException("CA bundle not found."); }
            config["caFile"] = ca; config["auth"] = auth; config["baseUrl"] = endpoint;
            if (webEnabled.HasValue)
            {
                object existingWeb;
                var web = config.TryGetValue("web", out existingWeb) ? existingWeb as Dictionary<string, object> : new Dictionary<string, object>();
                if (web == null) throw new IOException("web must be an object.");
                web["enabled"] = webEnabled.Value; config["web"] = web;
            }
            object webConfigValue, webIsEnabled;
            if (config.TryGetValue("web", out webConfigValue))
            {
                var webConfig = webConfigValue as Dictionary<string, object>;
                if (webConfig != null && webConfig.TryGetValue("enabled", out webIsEnabled) && Object.Equals(webIsEnabled, true)) tools += ",web_search,fetch_content";
            }
            CheckPath(home); Directory.CreateDirectory(home);
            var runtime = Prepare(home);
            run = Path.Combine(home, "runs", Guid.NewGuid().ToString("N"));
            var agent = Path.Combine(run, "agent");
            var temp = Path.Combine(run, "tmp");
            var sessions = Path.Combine(home, "sessions", projectId);
            foreach (var path in new[] { agent, sessions, temp }) { CheckPath(path); Directory.CreateDirectory(path); }
            var webState = Path.Combine(home, "web"); CheckPath(webState); Directory.CreateDirectory(webState);
            if (forkSession != null)
            {
                if (!System.Text.RegularExpressions.Regex.IsMatch(forkSession, "^[A-Za-z0-9_-][A-Za-z0-9_.-]*\\.jsonl$") || forkSession != Path.GetFileName(forkSession)) throw new IOException("Fork session must be a JSONL filename in this project's session directory.");
                var sessionPath = Path.Combine(sessions, forkSession); CheckPath(sessionPath);
                if (!File.Exists(sessionPath)) throw new IOException("Session file not found for this project.");
                forwarded.InsertRange(0, new[] { "--fork", sessionPath });
            }
            var provider = new Dictionary<string, object> {
                { "name", "Configured internal endpoint" }, { "baseUrl", endpoint }, { "api", api },
                { "apiKey", "${PI_PORTABLE_RUNTIME_KEY}" }, { "authHeader", false },
                { "models", new object[] { new Dictionary<string, object> { { "id", model }, { "name", model }, { "reasoning", false }, { "input", new[] { "text" } }, { "contextWindow", config.ContainsKey("contextWindow") ? config["contextWindow"] : 32768 }, { "maxTokens", config.ContainsKey("maxTokens") ? config["maxTokens"] : 4096 } } } }
            };
            object compat;
            if (config.TryGetValue("compat", out compat)) provider["compat"] = compat;
            else provider["compat"] = new { supportsStore = false, supportsDeveloperRole = false, supportsReasoningEffort = false, maxTokensField = "max_tokens" };
            WriteJson(Path.Combine(agent, "models.json"), new { providers = new Dictionary<string, object> { { "portable", provider } } });
            WriteJson(Path.Combine(agent, "settings.json"), new { defaultProvider = "portable", defaultModel = model, defaultThinkingLevel = "off" });
            var defaults = new List<string> { "--offline", "--no-approve", "--no-extensions", "--no-mcp", "--no-skills", "--no-prompt-templates", "--no-themes", "--no-context-files", "--extension", Path.Combine(runtime, "portable", "policy.ts"), "--tools", tools };
            if (!localOnly) defaults.AddRange(new[] { "--provider", "portable", "--model", model });
            defaults.AddRange(forwarded);
            var commandLine = new List<string>(); foreach (var arg in defaults) commandLine.Add(Quote(arg));
            var start = new ProcessStartInfo(Path.Combine(runtime, "pi.exe"), String.Join(" ", commandLine));
            start.UseShellExecute = false; start.WorkingDirectory = project;
            start.EnvironmentVariables["PI_CODING_AGENT_DIR"] = agent;
            start.EnvironmentVariables["PI_CODING_AGENT_SESSION_DIR"] = sessions;
            start.EnvironmentVariables["PI_PACKAGE_DIR"] = runtime;
            start.EnvironmentVariables["PI_OFFLINE"] = "1"; start.EnvironmentVariables["PI_TELEMETRY"] = "0";
            start.EnvironmentVariables["PI_PORTABLE_VERSION"] = BuildInfo.Version;
            start.EnvironmentVariables["PI_PORTABLE_UPSTREAM_VERSION"] = BuildInfo.UpstreamVersion;
            start.EnvironmentVariables["PI_PORTABLE_NETWORK"] = new JavaScriptSerializer().Serialize(config);
            start.EnvironmentVariables["PI_PORTABLE_TOOLS"] = tools;
            start.EnvironmentVariables["PI_PORTABLE_WEB_STATE"] = webState;
            start.EnvironmentVariables["PI_PORTABLE_RUNTIME_KEY"] = auth == "none" ? "no-auth" : keyValue ?? "";
            // Pinned Bun versions differ in their proxy:false support. Remove inherited
            // proxy variables from this child only for deterministic direct mode.
            if (Text(config, "proxy", "env") == "direct")
                foreach (var variable in new[] { "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy" }) start.EnvironmentVariables.Remove(variable);
            // Keep transport verification enabled even if the parent requested insecure TLS.
            start.EnvironmentVariables["NODE_TLS_REJECT_UNAUTHORIZED"] = "1";
            start.EnvironmentVariables["BUN_CONFIG_NO_CLEAR_TERMINAL"] = "1";
            start.EnvironmentVariables["PATH"] = Path.Combine(runtime, "tools", "rg") + ";" + Path.Combine(runtime, "tools", "fd") + ";" + Environment.GetEnvironmentVariable("PATH");
            start.EnvironmentVariables["TEMP"] = temp; start.EnvironmentVariables["TMP"] = temp; start.EnvironmentVariables["BUN_TMPDIR"] = temp;
            Console.CancelKeyPress += delegate(object sender, ConsoleCancelEventArgs e) { e.Cancel = true; };
            using (var child = Process.Start(start)) { child.WaitForExit(); return child.ExitCode; }
        }
        catch (Exception error) { Console.Error.WriteLine("pi-portable: " + error.Message); return 1; }
        finally
        {
            // Never recursively delete a user-selected path. Remove only our per-launch auth/config files.
            if (run != null)
                foreach (var name in new[] { "auth.json", "models.json", "settings.json" })
                    try { var path = Path.Combine(run, "agent", name); CheckPath(path); File.Delete(path); } catch (IOException) { } catch (UnauthorizedAccessException) { }
        }
    }
}

