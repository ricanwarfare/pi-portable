using System;
using System.Text;
using System.IO;
internal static class Fixture
{
    private static string Encode(string value) { return Convert.ToBase64String(Encoding.UTF8.GetBytes(value ?? "")); }
    private static int Main(string[] args)
    {
        var restartConfig = Environment.GetEnvironmentVariable("PI_FIXTURE_RESTART_CONFIG");
        if (restartConfig != null && Array.IndexOf(args, "--continue") < 0) {
            File.WriteAllText(Environment.GetEnvironmentVariable("PI_PORTABLE_CONFIG"), restartConfig);
            File.WriteAllText(Environment.GetEnvironmentVariable("PI_PORTABLE_RESTART"), "settings-saved");
            return 0;
        }
        if (Array.IndexOf(args, "--fixture-quiet") >= 0) return 0;
        Console.WriteLine("C:" + Encode(Environment.CurrentDirectory));
        foreach (var arg in args) Console.WriteLine("A:" + Encode(arg));
        foreach (var key in new[] { "PI_CODING_AGENT_DIR", "PI_CODING_AGENT_SESSION_DIR", "PI_PACKAGE_DIR", "PI_OFFLINE", "PI_TELEMETRY", "PI_PORTABLE_VERSION", "PI_PORTABLE_UPSTREAM_VERSION", "TEMP", "TMP", "BUN_TMPDIR", "PATH", "PI_PORTABLE_RUNTIME_KEY" })
            Console.WriteLine("E:" + key + ":" + Encode(Environment.GetEnvironmentVariable(key)));
        if (Array.IndexOf(args, "--fixture-stdin") >= 0) Console.WriteLine("I:" + Encode(Console.In.ReadToEnd()));
        return Array.IndexOf(args, "--fixture-fail") >= 0 ? 23 : 0;
    }
}
