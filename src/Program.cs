using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Threading;

internal static class Program
{
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
                    Directory.Move(stage, runtime);
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
            var home = Environment.GetEnvironmentVariable("PI_PORTABLE_HOME");
            if (String.IsNullOrWhiteSpace(home)) home = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "pi-portable-data");
            home = Path.GetFullPath(home);
            var forwarded = new List<string>();
            var info = false;
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
                if (!literal && (arg == "--tools" || arg == "-t" || arg == "--no-tools" || arg == "-nt" || arg == "--no-builtin-tools" || arg == "-nbt")) hasTools = true;
                forwarded.Add(arg);
                if (arg == "--") literal = true;
            }
            if (info)
            {
                Console.WriteLine("Pi Portable " + BuildInfo.Version + " / Windows x64\nPayload SHA256: " + BuildInfo.PayloadHash + "\nPortable home: " + home);
                Console.WriteLine("Runtime: <home>\\runtime\\<payload-sha256>\nConfig/auth: <home>\\agent\nSessions: <home>\\sessions\nTemp: <home>\\tmp");
                Console.WriteLine("Cloud preset: Ollama Cloud (set OLLAMA_API_KEY). Defaults are created only when config files are absent.");
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
            var defaults = new List<string> { "--offline", "--no-approve", "--no-extensions", "--no-mcp", "--no-skills", "--no-prompt-templates", "--no-themes", "--no-context-files" };
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
