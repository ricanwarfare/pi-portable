using System;
using System.Text;
internal static class Fixture
{
    private static string Encode(string value) { return Convert.ToBase64String(Encoding.UTF8.GetBytes(value ?? "")); }
    private static int Main(string[] args)
    {
        Console.WriteLine("C:" + Encode(Environment.CurrentDirectory));
        foreach (var arg in args) Console.WriteLine("A:" + Encode(arg));
        foreach (var key in new[] { "PI_CODING_AGENT_DIR", "PI_CODING_AGENT_SESSION_DIR", "PI_PACKAGE_DIR", "PI_OFFLINE", "PI_TELEMETRY", "TEMP", "TMP", "BUN_TMPDIR", "PATH" })
            Console.WriteLine("E:" + key + ":" + Encode(Environment.GetEnvironmentVariable(key)));
        if (Array.IndexOf(args, "--fixture-stdin") >= 0) Console.WriteLine("I:" + Encode(Console.In.ReadToEnd()));
        return Array.IndexOf(args, "--fixture-fail") >= 0 ? 23 : 0;
    }
}
