using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;

internal static class SecretInputTest
{
    private static string Read(MethodInfo method, params ConsoleKeyInfo[] keys)
    {
        var queue = new Queue<ConsoleKeyInfo>(keys);
        return (string)method.Invoke(null, new object[] { new Func<ConsoleKeyInfo>(queue.Dequeue) });
    }

    private static int Main(string[] args)
    {
        var method = Assembly.LoadFrom(args[0]).GetType("Program").GetMethod("ReadSecret", BindingFlags.NonPublic | BindingFlags.Static);
        var enter = new ConsoleKeyInfo('\r', ConsoleKey.Enter, false, false, false);
        var capture = new StringWriter();
        var output = Console.Out;
        Console.SetOut(capture);
        var edited = Read(method, new ConsoleKeyInfo('a', ConsoleKey.A, false, false, false),
            new ConsoleKeyInfo('x', ConsoleKey.X, false, false, false),
            new ConsoleKeyInfo('\b', ConsoleKey.Backspace, false, false, false),
            new ConsoleKeyInfo('b', ConsoleKey.B, false, false, false), enter);
        var empty = Read(method, new ConsoleKeyInfo('\b', ConsoleKey.Backspace, false, false, false), enter);
        var escaped = Read(method, new ConsoleKeyInfo('\0', ConsoleKey.Escape, false, false, false));
        var canceled = Read(method, new ConsoleKeyInfo('\x03', ConsoleKey.C, false, false, true));
        var program = method.DeclaringType;
        var storage = program.GetMethod("KeyStorage", BindingFlags.NonPublic | BindingFlags.Static);
        var error = Console.Error;
        Console.SetError(new StringWriter());
        foreach (var choice in new[] { "", "1", "2", "x\r1" })
        {
            var keys = new Queue<ConsoleKeyInfo>();
            foreach (var c in choice) keys.Enqueue(new ConsoleKeyInfo(c, c == '\r' ? ConsoleKey.Enter : ConsoleKey.NoName, false, false, false));
            keys.Enqueue(enter);
            var saved = (bool?)storage.Invoke(null, new object[] { new Func<ConsoleKeyInfo>(keys.Dequeue) });
            if (saved != (choice == "2")) return 2;
        }
        var cancelKeys = new Queue<ConsoleKeyInfo>(new[] { new ConsoleKeyInfo('\0', ConsoleKey.Escape, false, false, false) });
        if (storage.Invoke(null, new object[] { new Func<ConsoleKeyInfo>(cancelKeys.Dequeue) }) != null) return 3;
        Console.SetError(error);
        var home = Path.Combine(Path.GetDirectoryName(args[0]), "key-storage-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(home);
        var keyPath = Path.Combine(home, "ollama-cloud.key");
        var store = program.GetMethod("StoreKey", BindingFlags.NonPublic | BindingFlags.Static);
        store.Invoke(null, new object[] { home, keyPath, "synthetic-session", false });
        if (File.Exists(keyPath) || Directory.GetFiles(home).Length != 0) return 4;
        store.Invoke(null, new object[] { home, keyPath, "synthetic-saved", true });
        store.Invoke(null, new object[] { home, keyPath, "synthetic-session", false });
        if (File.ReadAllText(keyPath) != "synthetic-saved") return 5;
        Console.SetOut(output);
        if (edited != "ab" || empty != "" || escaped != null || canceled != null || capture.ToString() != "") return 1;
        Console.WriteLine("Hidden input: editing, empty input, Escape, Ctrl+C, and no echo passed.");
        return 0;
    }
}
