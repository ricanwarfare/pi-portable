using System;
using System.Collections.Generic;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Windows.Forms;
using System.Drawing;

internal static partial class Program
{
    private static bool NeedsSetup(string home, string configPath)
    {
        if (!File.Exists(configPath)) return true;
        var config = ReadObject(configPath);
        if (!config.ContainsKey("rememberKey")) return true;
        if (String.IsNullOrWhiteSpace(Text(config, "model", "")) || !Directory.Exists(Text(config, "defaultProject", ""))) return true;
        var auth = Text(config, "auth", Text(config, "kind", "openai") == "ollama" ? "none" : Text(config, "kind", "openai") == "azure" ? "api-key" : "bearer");
        try { KeyScope(Text(config, "baseUrl", ""), auth); } catch (IOException) { return true; }
        if (RememberKey(config) && auth != "none" && String.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable(Text(config, "keyEnv", "PI_PORTABLE_API_KEY")))) {
            try { return String.IsNullOrWhiteSpace(LoadKey(home, Text(config, "baseUrl", ""), auth)); }
            catch (IOException) { return true; }
        }
        return false;
    }

    private static bool RememberKey(Dictionary<string, object> config)
    {
        object value;
        if (!config.TryGetValue("rememberKey", out value)) return false;
        if (!(value is bool)) throw new IOException("rememberKey must be boolean.");
        return (bool)value;
    }

    private static byte[] KeyScope(string endpoint, string auth)
    {
        Uri uri;
        if (!Uri.TryCreate(endpoint.TrimEnd('/'), UriKind.Absolute, out uri) || (uri.Scheme != "https" && uri.Scheme != "http") || !String.IsNullOrEmpty(uri.UserInfo) || !String.IsNullOrEmpty(uri.Query) || !String.IsNullOrEmpty(uri.Fragment))
            throw new IOException("Enter a valid HTTP(S) API base URL without credentials, query or fragment.");
        return Encoding.UTF8.GetBytes(uri.AbsoluteUri.TrimEnd('/') + "\n" + auth);
    }

    private static string KeyPath(string home, string endpoint, string auth)
    {
        using (var scope = new MemoryStream(KeyScope(endpoint, auth))) {
            var path = Path.Combine(home, "credentials", Hash(scope) + ".dpapi"); CheckPath(path); return path;
        }
    }

    private static string LoadKey(string home, string endpoint, string auth)
    {
        var path = KeyPath(home, endpoint, auth);
        if (!File.Exists(path)) return null;
        try {
            var bytes = ProtectedData.Unprotect(File.ReadAllBytes(path), KeyScope(endpoint, auth), DataProtectionScope.CurrentUser);
            try { return Encoding.UTF8.GetString(bytes); } finally { Array.Clear(bytes, 0, bytes.Length); }
        } catch (CryptographicException) { throw new IOException("The saved key cannot be decrypted by this Windows account. Open --settings and enter a replacement key."); }
    }

    private static void AtomicBytes(string path, byte[] bytes)
    {
        CheckPath(path); Directory.CreateDirectory(Path.GetDirectoryName(path));
        using (Lock(path + ".lock")) {
            var temporary = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
            try {
                using (var file = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None)) { file.Write(bytes, 0, bytes.Length); file.Flush(true); }
                CheckPath(path);
                if (File.Exists(path)) File.Replace(temporary, path, null); else File.Move(temporary, path);
            } finally { if (File.Exists(temporary)) File.Delete(temporary); }
        }
    }

    private static void SaveKey(string home, string endpoint, string auth, string key)
    {
        var bytes = Encoding.UTF8.GetBytes(key);
        try { AtomicBytes(KeyPath(home, endpoint, auth), ProtectedData.Protect(bytes, KeyScope(endpoint, auth), DataProtectionScope.CurrentUser)); }
        finally { Array.Clear(bytes, 0, bytes.Length); }
    }

    private static string[] RestartArguments(string[] args)
    {
        var result = new List<string>(); bool literal = false;
        for (var index = 0; index < args.Length; index++) {
            var arg = args[index];
            if (arg == "--") literal = true;
            if (!literal && Array.IndexOf(new[] { "--web", "--no-web", "--subagents", "--no-subagents", "--session-key" }, arg) >= 0) continue;
            if (!literal && (arg == "--profile" || arg == "--project")) { index++; continue; }
            result.Add(arg);
        }
        if (!result.Contains("--continue") && !result.Contains("-c") && !result.Contains("--no-session")) result.Insert(0, "--continue");
        return result.ToArray();
    }

    private static void SaveSettings(string home, string configPath, Dictionary<string, object> config, string key)
    {
        var endpoint = Text(config, "baseUrl", "").TrimEnd('/'); var auth = Text(config, "auth", "bearer");
        KeyScope(endpoint, auth);
        if (String.IsNullOrWhiteSpace(Text(config, "model", ""))) throw new IOException("Enter the model ID supplied by your service.");
        Tools(Text(config, "profile", "review"));
        var project = Text(config, "defaultProject", "");
        if (!Directory.Exists(project)) throw new IOException("Choose an existing project folder.");
        var ca = Text(config, "caFile", "");
        if (ca.Length > 0) { var caPath = Path.GetFullPath(Path.Combine(Path.GetDirectoryName(configPath), ca)); CheckPath(caPath); if (!File.Exists(caPath)) throw new IOException("CA bundle not found."); }
        var proxy = Text(config, "proxy", "env");
        if (proxy != "env" && proxy != "direct") {
            Uri proxyUri;
            if (!Uri.TryCreate(proxy, UriKind.Absolute, out proxyUri) || (proxyUri.Scheme != "http" && proxyUri.Scheme != "https") || proxyUri.AbsolutePath != "/" || proxyUri.UserInfo.Length > 0 || proxyUri.Query.Length > 0 || proxyUri.Fragment.Length > 0) throw new IOException("Proxy must be env, direct, or an HTTP(S) origin without credentials.");
        }
        var old = ReadObject(configPath);
        var oldEndpoint = Text(old, "baseUrl", ""); var oldAuth = Text(old, "auth", Text(old, "kind", "openai") == "ollama" ? "none" : Text(old, "kind", "openai") == "azure" ? "api-key" : "bearer");
        var remember = RememberKey(config) && auth != "none";
        if (remember) {
            if (!String.IsNullOrWhiteSpace(key)) SaveKey(home, endpoint, auth, key);
            else if (String.IsNullOrWhiteSpace(LoadKey(home, endpoint, auth))) throw new IOException("Enter an API key to remember, or turn off Remember API key.");
        }
        // Persist only settings and a boolean preference; never the clear-text key.
        AtomicBytes(configPath, new UTF8Encoding(false).GetBytes(new System.Web.Script.Serialization.JavaScriptSerializer().Serialize(config)));
        if (!remember) { var path = KeyPath(home, endpoint, auth); if (File.Exists(path)) File.Delete(path); }
        Uri oldUri;
        if (oldEndpoint.Length > 0 && Uri.TryCreate(oldEndpoint, UriKind.Absolute, out oldUri) && (oldUri.Scheme == "http" || oldUri.Scheme == "https") && oldUri.UserInfo.Length == 0 && oldUri.Query.Length == 0 && oldUri.Fragment.Length == 0) {
            var oldPath = KeyPath(home, oldEndpoint, oldAuth);
            if (!String.Equals(oldPath, KeyPath(home, endpoint, auth), StringComparison.OrdinalIgnoreCase) && File.Exists(oldPath)) File.Delete(oldPath);
        }
    }

    private static bool ShowSettings(string home, string configPath, string project)
    {
        Application.EnableVisualStyles();
        using (var form = CreateSettingsForm(home, configPath, project)) return form.ShowDialog() == DialogResult.OK;
    }

    private static Form CreateSettingsForm(string home, string configPath, string project)
    {
        var config = ReadObject(configPath);
        var form = new Form { Text = "Pi Portable settings", Width = 720, Height = 790, StartPosition = FormStartPosition.CenterScreen, MinimumSize = new Size(680, 740), AutoScaleMode = AutoScaleMode.Dpi };
        {
            var layout = new TableLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(18), ColumnCount = 2, RowCount = 15, AutoScroll = true };
            layout.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 170)); layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100)); form.Controls.Add(layout);
            int row = 0;
            Func<string, Control, Control> add = (label, control) => { control.Name = label; layout.RowStyles.Add(new RowStyle(SizeType.AutoSize)); layout.Controls.Add(new Label { Text = label, AutoSize = true, Padding = new Padding(0, 8, 0, 8) }, 0, row); control.Dock = DockStyle.Top; control.Margin = new Padding(3, 5, 3, 5); layout.Controls.Add(control, 1, row++); return control; };
            Func<string, string[], string, ComboBox> choice = (label, options, selected) => { var box = new ComboBox { DropDownStyle = ComboBoxStyle.DropDownList }; box.Items.AddRange(options); box.SelectedItem = selected; if (box.SelectedIndex < 0) box.SelectedIndex = 0; add(label, box); return box; };
            var kind = choice("Provider type", new[] { "custom", "openai", "ollama", "azure" }, Text(config, "kind", "custom"));
            var endpoint = (TextBox)add("API base URL", new TextBox { Text = Text(config, "baseUrl", "https://") });
            var model = (TextBox)add("Model ID", new TextBox { Text = Text(config, "model", "") });
            var api = choice("API format", new[] { "openai-completions", "openai-responses" }, Text(config, "api", "openai-completions"));
            var apiVersion = (TextBox)add("Azure API version", new TextBox { Text = Text(config, "apiVersion", "") });
            var auth = choice("Authentication", new[] { "bearer", "api-key", "none" }, Text(config, "auth", Text(config, "kind", "custom") == "ollama" ? "none" : Text(config, "kind", "custom") == "azure" ? "api-key" : "bearer"));
            var key = (TextBox)add("API key (hidden)", new TextBox { UseSystemPasswordChar = true });
            var remember = (CheckBox)add("", new CheckBox { Text = "Remember API key for this Windows account", AutoSize = true, Checked = config.ContainsKey("rememberKey") ? RememberKey(config) : true });
            remember.Name = "Remember key";
            EventHandler keyState = delegate { key.Enabled = remember.Checked && auth.Text != "none"; };
            remember.CheckedChanged += keyState; auth.SelectedIndexChanged += keyState; keyState(null, EventArgs.Empty);
            add("", new Label { Text = "Blank key keeps the saved key for this endpoint.\nEncrypted keys cannot travel to a different Windows account.\nUncheck Remember to remove the saved key; use session entry instead.", AutoSize = true });
            var folder = new FlowLayoutPanel { AutoSize = true, WrapContents = false };
            var projectBox = new TextBox { Name = "Project folder", Text = Text(config, "defaultProject", project), Width = 320 }; var browse = new Button { Text = "Browse…", AutoSize = true };
            browse.Click += delegate { using (var picker = new FolderBrowserDialog { SelectedPath = projectBox.Text }) if (picker.ShowDialog(form) == DialogResult.OK) projectBox.Text = picker.SelectedPath; }; folder.Controls.Add(projectBox); folder.Controls.Add(browse); add("Default project", folder);
            var profile = choice("Coding permissions", new[] { "review", "edit", "full" }, Text(config, "profile", "review"));
            var proxyBox = (TextBox)add("Proxy: env / direct / URL", new TextBox { Text = Text(config, "proxy", "env") });
            var caBox = (TextBox)add("CA bundle (optional)", new TextBox { Text = Text(config, "caFile", "") });
            object value; var webConfig = config.TryGetValue("web", out value) ? value as Dictionary<string, object> : null;
            var web = (CheckBox)add("Web access", new CheckBox { Text = "Enable web search and page reading on every launch", AutoSize = true, Checked = webConfig != null && webConfig.ContainsKey("enabled") && Object.Equals(webConfig["enabled"], true) });
            var childConfig = config.TryGetValue("subagents", out value) ? value as Dictionary<string, object> : null;
            var delegation = (CheckBox)add("Delegation", new CheckBox { Text = "Enable bundled subagents on every launch", AutoSize = true, Checked = childConfig != null && childConfig.ContainsKey("enabled") && Object.Equals(childConfig["enabled"], true) });
            add("", new Label { Text = "Web search uses external services unless internal mirrors are configured.\nCustom headers and search mirrors stay in portable.json.\nSaving from /portable restarts the agent and continues its saved session.", AutoSize = true });
            var buttons = new FlowLayoutPanel { AutoSize = true, Dock = DockStyle.Bottom, Padding = new Padding(18, 8, 18, 8) }; var save = new Button { Name = "Save", Text = "Save", AutoSize = true }; var cancel = new Button { Name = "Cancel", Text = "Cancel", AutoSize = true, DialogResult = DialogResult.Cancel }; buttons.Controls.Add(save); buttons.Controls.Add(cancel); form.Controls.Add(buttons); layout.BringToFront(); form.CancelButton = cancel; form.AcceptButton = save;
            save.Click += delegate {
                try {
                    var next = new Dictionary<string, object>(config); next["kind"] = kind.Text; next["baseUrl"] = endpoint.Text.Trim().TrimEnd('/'); next["model"] = model.Text.Trim(); next["api"] = api.Text; next["auth"] = auth.Text; next["rememberKey"] = remember.Checked; next["defaultProject"] = Path.GetFullPath(projectBox.Text); next["profile"] = profile.Text;
                    next["proxy"] = proxyBox.Text.Trim(); next["caFile"] = caBox.Text.Trim();
                    if (apiVersion.Text.Trim().Length > 0) next["apiVersion"] = apiVersion.Text.Trim(); else next.Remove("apiVersion");
                    var webNext = webConfig == null ? new Dictionary<string, object>() : new Dictionary<string, object>(webConfig); webNext["enabled"] = web.Checked; next["web"] = webNext; next["subagents"] = new { enabled = delegation.Checked };
                    if (kind.Text == "azure" && String.IsNullOrWhiteSpace(Text(next, "apiVersion", ""))) throw new IOException("Azure requires apiVersion in portable.json. Use an OpenAI-compatible Azure /openai/v1 endpoint with provider type openai, or configure the deployment API version first.");
                    SaveSettings(home, configPath, next, key.Text); key.Clear(); form.DialogResult = DialogResult.OK; form.Close();
                } catch (Exception error) { Console.Error.WriteLine("Pi Portable settings: " + error.Message); MessageBox.Show(form, error.Message, "Settings were not saved", MessageBoxButtons.OK, MessageBoxIcon.Warning); }
            };
            return form;
        }
    }
}
