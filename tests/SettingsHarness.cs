using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Windows.Forms;
using System.Drawing;
using System.Web.Script.Serialization;

[assembly: System.Runtime.Versioning.TargetFramework(".NETFramework,Version=v4.8")]

internal static class SettingsHarness
{
    static Type program;
    static object Call(string name, params object[] args) { return program.GetMethod(name, BindingFlags.Static | BindingFlags.NonPublic).Invoke(null, args); }
    static void Assert(bool value, string message) { if (!value) throw new Exception(message); }
    static T Control<T>(Form form, string name) where T : Control { return (T)form.Controls.Find(name, true)[0]; }
    static Dictionary<string, object> Config(string path) { return (Dictionary<string, object>)new JavaScriptSerializer().DeserializeObject(File.ReadAllText(path)); }
    [STAThread]
    static int Main(string[] args)
    {
        try {
            AppContext.SetSwitch("Switch.System.IO.UseLegacyPathHandling", false);
            AppContext.SetSwitch("Switch.System.IO.BlockLongPaths", false);
            program = Assembly.LoadFrom(args[0]).GetType("Program");
            var home = args[1]; var path = Path.Combine(home, "portable.json"); var project = args[2]; Directory.CreateDirectory(home);
            Assert((bool)Call("NeedsSetup", home, path), "First double-click did not request setup");
            File.WriteAllText(path, new JavaScriptSerializer().Serialize(new { kind = "custom", baseUrl = "https://model.internal.example/v1", model = "initial-model", auth = "bearer", proxy = "direct", web = new { enabled = false, allowedOrigins = new[] { "https://docs.internal.example" } } }));
            using (var form = (Form)Call("CreateSettingsForm", home, path, project)) {
                Assert(Control<TextBox>(form, "API key (hidden)").UseSystemPasswordChar, "Key input is not masked");
                Control<TextBox>(form, "Model ID").Text = "remembered-model";
                Control<TextBox>(form, "API key (hidden)").Text = "synthetic-remembered-secret";
                Control<CheckBox>(form, "Remember key").Checked = true;
                Control<CheckBox>(form, "Web access").Checked = true;
                Control<CheckBox>(form, "Delegation").Checked = true;
                form.StartPosition = FormStartPosition.Manual; form.Location = new Point(-20000, -20000); form.ShowInTaskbar = false;
                form.Show(); Application.DoEvents(); form.PerformLayout();
                using (var bitmap = new Bitmap(form.Width, form.Height)) { form.DrawToBitmap(bitmap, new Rectangle(0, 0, bitmap.Width, bitmap.Height)); bitmap.Save(args[3]); }
                Control<Button>(form, "Save").PerformClick();
            }
            var config = Config(path);
            Assert(!(bool)Call("NeedsSetup", home, path), "Configured app would repeat setup");
            Assert((string)config["model"] == "remembered-model", "Model not saved");
            Assert((bool)((Dictionary<string, object>)config["web"])["enabled"], "Web not saved");
            Assert(((object[])((Dictionary<string, object>)config["web"])["allowedOrigins"]).Length == 1, "Advanced web settings lost");
            Assert((bool)((Dictionary<string, object>)config["subagents"])["enabled"], "Delegation not saved");
            Assert(!File.ReadAllText(path).Contains("synthetic-remembered-secret"), "Clear-text secret in config");
            Assert((string)Call("LoadKey", home, "https://model.internal.example/v1", "bearer") == "synthetic-remembered-secret", "Key round trip failed");
            Assert(Call("LoadKey", home, "https://other.internal.example/v1", "bearer") == null, "Key crossed endpoint scope");
            Assert(Call("LoadKey", home, "https://model.internal.example/v1", "api-key") == null, "Key crossed authentication scope");
            var keyPath = (string)Call("KeyPath", home, "https://model.internal.example/v1", "bearer");
            var cipher = File.ReadAllBytes(keyPath);
            Assert(!Encoding.UTF8.GetString(cipher).Contains("synthetic-remembered-secret"), "Key not encrypted");
            bool denied = false;
            try { ProtectedData.Unprotect(cipher, Encoding.UTF8.GetBytes("wrong scope"), DataProtectionScope.CurrentUser); } catch (CryptographicException) { denied = true; }
            Assert(denied, "DPAPI entropy not enforced");
            var moved = home + "-moved"; var movedPath = (string)Call("KeyPath", moved, "https://model.internal.example/v1", "bearer"); Directory.CreateDirectory(Path.GetDirectoryName(movedPath)); File.WriteAllBytes(movedPath, cipher);
            Assert((string)Call("LoadKey", moved, "https://model.internal.example/v1", "bearer") == "synthetic-remembered-secret", "Same-account relocation failed");
            File.WriteAllBytes(keyPath, new byte[] { 1, 2, 3 }); denied = false;
            try { Call("LoadKey", home, "https://model.internal.example/v1", "bearer"); } catch (TargetInvocationException error) { denied = error.InnerException is IOException; }
            Assert(denied, "Corrupted key did not fail closed"); File.WriteAllBytes(keyPath, cipher);
            config["baseUrl"] = "https://other.internal.example/v1"; denied = false;
            try { Call("SaveSettings", home, path, config, ""); } catch (TargetInvocationException error) { denied = error.InnerException is IOException; }
            Assert(denied && File.Exists(keyPath), "Endpoint change reused a saved key or deleted it before validation");
            Call("SaveSettings", home, path, config, "synthetic-other-secret"); Assert(!File.Exists(keyPath), "Old endpoint credential retained after change");
            config["baseUrl"] = "https://model.internal.example/v1"; Call("SaveSettings", home, path, config, "synthetic-remembered-secret");
            Call("SaveSettings", home, path, config, "");
            Assert((string)Call("LoadKey", home, "https://model.internal.example/v1", "bearer") == "synthetic-remembered-secret", "Blank field did not retain saved key");
            config["baseUrl"] = "https://MODEL.internal.example:443/v1/"; Call("SaveSettings", home, path, config, "");
            Assert((string)Call("LoadKey", home, "https://model.internal.example/v1", "bearer") == "synthetic-remembered-secret", "Equivalent URL normalization deleted the saved key");
            config["baseUrl"] = "https://model.internal.example/v1"; Call("SaveSettings", home, path, config, "");
            using (var reopened = (Form)Call("CreateSettingsForm", home, path, project)) {
                Assert(Control<TextBox>(reopened, "Model ID").Text == "remembered-model", "Reopened form forgot model");
                Assert(Control<CheckBox>(reopened, "Web access").Checked && Control<CheckBox>(reopened, "Delegation").Checked, "Reopened form forgot toggles");
                Assert(Control<TextBox>(reopened, "API key (hidden)").Text == "", "Reopened form revealed secret");
            }
            config["rememberKey"] = false; Call("SaveSettings", home, path, config, ""); Assert(!File.Exists(keyPath), "Forget key did not delete encrypted credential");
            config["rememberKey"] = true; Call("SaveSettings", home, path, config, "synthetic-remembered-secret");
            var restarted = (string[])Call("RestartArguments", (object)new[] { "--profile", "review", "--web", "--no-subagents", "--project", project, "--portable-home", home });
            Assert(Array.IndexOf(restarted, "--continue") >= 0 && Array.IndexOf(restarted, "--no-subagents") < 0 && Array.IndexOf(restarted, "--profile") < 0 && Array.IndexOf(restarted, home) >= 0, "Settings restart precedence failed");
            Console.WriteLine("SETTINGS_AND_DPAPI_OK"); return 0;
        } catch (Exception error) { Console.Error.WriteLine(error); return 1; }
    }
}
