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
        Console.SetOut(output);
        if (edited != "ab" || empty != "" || escaped != null || canceled != null || capture.ToString() != "") return 1;
        Console.WriteLine("Hidden input: editing, empty input, Escape, Ctrl+C, and no echo passed.");
        return 0;
    }
}
