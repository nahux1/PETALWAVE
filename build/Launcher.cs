// petalwave.exe — programa propio: arranca el servidor Node oculto y muestra la interfaz
// en una ventana nativa de Windows (WebView2). Al cerrar la ventana, apaga el servidor.
// Si WebView2 no estuviera disponible, usa como respaldo un navegador en modo app.
using System;
using System.Collections.Generic;
using System.Text;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

[assembly: AssemblyTitle("petalwave")]
[assembly: AssemblyProduct("petalwave")]
[assembly: AssemblyDescription("Descargador y reproductor de YouTube / YouTube Music")]
[assembly: AssemblyVersion("2.0.0.0")]

static class Launcher
{
    public const string Url = "http://127.0.0.1:3737";
    public const string Title = "petalwave";

    public static string AppDir { get { return AppDomain.CurrentDomain.BaseDirectory; } }
    public static string LibDir { get { return Path.Combine(AppDir, "lib"); } }
    public static string DataDir()
    {
        return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "petalwave");
    }

    public static void Trace(string msg)
    {
        try { File.AppendAllText(Path.Combine(DataDir(), "launcher.log"), DateTime.Now.ToString("HH:mm:ss ") + msg + Environment.NewLine); } catch { }
    }

    [STAThread]
    static int Main()
    {
        // las DLL de WebView2 viven en .\lib: resolverlas desde ahí
        AppDomain.CurrentDomain.AssemblyResolve += (s, e) =>
        {
            var f = Path.Combine(LibDir, new AssemblyName(e.Name).Name + ".dll");
            return File.Exists(f) ? Assembly.LoadFrom(f) : null;
        };
        try { Directory.CreateDirectory(DataDir()); File.WriteAllText(Path.Combine(DataDir(), "launcher.log"), ""); } catch { }
        try { return Run(); }
        catch (Exception ex)
        {
            Trace("ERROR " + ex);
            MessageBox.Show("Error inesperado:\n" + ex.Message + "\n\nDetalle en " + Path.Combine(DataDir(), "launcher.log"), Title, MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }

    static bool Alive()
    {
        try
        {
            var req = (HttpWebRequest)WebRequest.Create(Url + "/api/status");
            req.Timeout = 1500;
            req.Proxy = null;
            using (var res = (HttpWebResponse)req.GetResponse()) return res.StatusCode == HttpStatusCode.OK;
        }
        catch { return false; }
    }

    static string FindInPath(string exe, params string[] extra)
    {
        foreach (var c in extra) if (!string.IsNullOrEmpty(c) && File.Exists(c)) return c;
        var path = Environment.GetEnvironmentVariable("PATH") ?? "";
        foreach (var d in path.Split(';'))
        {
            try { var f = Path.Combine(d.Trim(), exe); if (File.Exists(f)) return f; } catch { }
        }
        return null;
    }

    static int Run()
    {
        string data = DataDir();
        if (!File.Exists(Path.Combine(AppDir, "server.js")))
        {
            MessageBox.Show("No encuentro server.js junto a petalwave.exe.\nDejá el .exe dentro de la carpeta petalwave.", Title, MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }

        // ---------- servidor local (oculto) ----------
        Process server = null;
        StreamWriter log = null;
        if (!Alive())
        {
            string pf = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
            // versión portable: Node viene dentro de la carpeta (runtime\node.exe), no hace falta instalar nada
            string bundled = Path.Combine(AppDir, "runtime", "node.exe");
            string node = File.Exists(bundled) ? bundled : FindInPath("node.exe", Path.Combine(pf, "nodejs", "node.exe"));
            if (node == null)
            {
                MessageBox.Show("No se encontró Node.js.\nInstalalo desde https://nodejs.org y volvé a abrir petalwave.", Title, MessageBoxButtons.OK, MessageBoxIcon.Error);
                return 1;
            }
            try
            {
                var fs = new FileStream(Path.Combine(data, "server.log"), FileMode.Create, FileAccess.Write, FileShare.ReadWrite);
                log = new StreamWriter(fs) { AutoFlush = true };
            }
            catch { log = new StreamWriter(Stream.Null); }
            var psi = new ProcessStartInfo(node, "\"" + Path.Combine(AppDir, "server.js") + "\" --no-open")
            {
                WorkingDirectory = AppDir,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
            };
            server = Process.Start(psi);
            var w = log;
            server.OutputDataReceived += (s, e) => { if (e.Data != null) lock (w) w.WriteLine(e.Data); };
            server.ErrorDataReceived += (s, e) => { if (e.Data != null) lock (w) w.WriteLine(e.Data); };
            server.BeginOutputReadLine();
            server.BeginErrorReadLine();

            for (int i = 0; i < 60 && !Alive(); i++)
            {
                if (server.HasExited) break;
                Thread.Sleep(200);
            }
            if (!Alive())
            {
                MessageBox.Show("El servidor no arrancó.\nMirá el log en:\n" + Path.Combine(data, "server.log"), Title, MessageBoxButtons.OK, MessageBoxIcon.Error);
                try { if (!server.HasExited) server.Kill(); } catch { }
                return 1;
            }
        }
        Trace("servidor OK");

        // ---------- ventana ----------
        string version;
        if (AppWindow.Available(out version))
        {
            Trace("ventana nativa con WebView2 " + version);
            AppWindow.Run(Url, data);
        }
        else
        {
            Trace("WebView2 no disponible: uso navegador en modo app");
            BrowserFallback.Run(Url, data);
        }

        Trace("ventana cerrada");
        if (server != null && !server.HasExited)
        {
            // cierre ordenado: el servidor guarda biblioteca, estadísticas y ajustes antes de salir
            try
            {
                var q = (HttpWebRequest)WebRequest.Create(Url + "/api/quit");
                q.Method = "POST"; q.ContentLength = 0; q.Timeout = 1500; q.Proxy = null;
                using (q.GetResponse()) { }
            }
            catch { }
            try { if (!server.WaitForExit(3000)) server.Kill(); } catch { }
        }
        if (log != null) log.Dispose();
        return 0;
    }
}

// ================= ventana nativa (WebView2) =================
static class AppWindow
{
    [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);
    const int DWMWA_USE_IMMERSIVE_DARK_MODE = 20, DWMWA_BORDER_COLOR = 34, DWMWA_CAPTION_COLOR = 35, DWMWA_TEXT_COLOR = 36;
    static readonly Color Deep = Color.FromArgb(42, 16, 36);

    public static bool Available(out string version)
    {
        version = null;
        try
        {
            CoreWebView2Environment.SetLoaderDllFolderPath(Launcher.LibDir);
            version = CoreWebView2Environment.GetAvailableBrowserVersionString();
            return !string.IsNullOrEmpty(version);
        }
        catch (Exception ex) { Launcher.Trace("WebView2: " + ex.Message); return false; }
    }

    static int ColorRef(Color c) { return c.R | (c.G << 8) | (c.B << 16); }

    static void SetDwm(IntPtr h, int attr, int v) { try { DwmSetWindowAttribute(h, attr, ref v, 4); } catch { } }

    // barra de título del color del tema (Windows 11)
    static void SetCaption(Form f, Color c)
    {
        if (!f.IsHandleCreated) return;
        SetDwm(f.Handle, DWMWA_USE_IMMERSIVE_DARK_MODE, 1);
        SetDwm(f.Handle, DWMWA_CAPTION_COLOR, ColorRef(c));
        SetDwm(f.Handle, DWMWA_BORDER_COLOR, ColorRef(ControlPaint.Light(c, 0.6f)));
        SetDwm(f.Handle, DWMWA_TEXT_COLOR, ColorRef(Color.FromArgb(247, 219, 230)));
    }

    static void OpenExternal(string uri)
    {
        try
        {
            var u = new Uri(uri);
            if (u.Scheme == "http" || u.Scheme == "https") Process.Start(new ProcessStartInfo(uri) { UseShellExecute = true });
        }
        catch { }
    }

    // ---- recordar tamaño y posición ----
    static string BoundsFile(string data) { return Path.Combine(data, "window.txt"); }
    static void RestoreBounds(Form f, string data)
    {
        var wa = Screen.PrimaryScreen.WorkingArea;
        int w = Math.Min(1400, wa.Width - 40), h = Math.Min(900, wa.Height - 40);
        f.Bounds = new Rectangle(wa.Left + (wa.Width - w) / 2, wa.Top + (wa.Height - h) / 2, w, h);
        try
        {
            var p = File.ReadAllText(BoundsFile(data)).Trim().Split(' ');
            var r = new Rectangle(int.Parse(p[0]), int.Parse(p[1]), int.Parse(p[2]), int.Parse(p[3]));
            bool visible = false;
            foreach (var s in Screen.AllScreens) if (s.WorkingArea.IntersectsWith(r)) visible = true;
            if (visible && r.Width >= 420 && r.Height >= 400) f.Bounds = r;
            if (p.Length > 4 && p[4] == "max") f.WindowState = FormWindowState.Maximized;
        }
        catch { }
    }
    static void SaveBounds(Rectangle r, bool max, string data)
    {
        try { File.WriteAllText(BoundsFile(data), r.X + " " + r.Y + " " + r.Width + " " + r.Height + (max ? " max" : "")); } catch { }
    }

    // selector de carpeta con el explorador moderno de Windows (truco: diálogo de archivo que acepta carpetas)
    static string PickFolder(IWin32Window owner, string title)
    {
        using (var d = new OpenFileDialog())
        {
            d.Title = string.IsNullOrEmpty(title) ? "Elegí una carpeta" : title;
            d.ValidateNames = false; d.CheckFileExists = false; d.CheckPathExists = true;
            d.FileName = "Elegir esta carpeta";
            d.Filter = "Carpetas|*.carpeta";
            if (d.ShowDialog(owner) != DialogResult.OK) return "";
            var dir = Path.GetDirectoryName(d.FileName);
            return Directory.Exists(dir) ? dir : "";
        }
    }

    // ================= inicio de sesión en YouTube Music =================
    // El usuario escribe su usuario y contraseña en la página oficial de Google (petalwave nunca los ve).
    // Al volver a YouTube con la sesión iniciada, se copian las cookies de youtube.com a cookies.txt
    // y se borran de esta ventana: así el navegador interno no las "renueva" y la copia no se vence.
    const string LoginUrl = "https://accounts.google.com/ServiceLogin?service=youtube&uilel=3&passive=true&continue=https%3A%2F%2Fwww.youtube.com%2Fsignin%3Faction_handle_signin%3Dtrue%26app%3Ddesktop%26next%3Dhttps%253A%252F%252Fmusic.youtube.com%252F";
    static bool loginOpen;

    static string ToNetscape(IEnumerable<CoreWebView2Cookie> cookies)
    {
        var sb = new StringBuilder("# Netscape HTTP Cookie File\n# generado por petalwave al iniciar sesión\n");
        var epoch = new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc);
        foreach (var c in cookies)
        {
            var dom = c.Domain;
            long exp = c.IsSession ? 0 : (long)(c.Expires.ToUniversalTime() - epoch).TotalSeconds;
            if (exp < 0) exp = 0;
            sb.Append(c.IsHttpOnly ? "#HttpOnly_" : "").Append(dom).Append('\t')
              .Append(dom.StartsWith(".") ? "TRUE" : "FALSE").Append('\t')
              .Append(string.IsNullOrEmpty(c.Path) ? "/" : c.Path).Append('\t')
              .Append(c.IsSecure ? "TRUE" : "FALSE").Append('\t')
              .Append(exp).Append('\t').Append(c.Name).Append('\t').Append(c.Value).Append('\n');
        }
        return sb.ToString();
    }

    static string PostCookies(string text)
    {
        try
        {
            var q = (HttpWebRequest)WebRequest.Create(Launcher.Url + "/api/cookies");
            q.Method = "POST"; q.ContentType = "text/plain"; q.Proxy = null; q.Timeout = 10000;
            var bytes = Encoding.UTF8.GetBytes(text);
            q.ContentLength = bytes.Length;
            using (var s = q.GetRequestStream()) s.Write(bytes, 0, bytes.Length);
            using (q.GetResponse()) { }
            return null;
        }
        catch (WebException ex)
        {
            try { using (var r = new StreamReader(ex.Response.GetResponseStream())) return r.ReadToEnd(); } catch { return ex.Message; }
        }
        catch (Exception ex) { return ex.Message; }
    }

    static void ShowLogin(Form owner, CoreWebView2Environment env, Action<string> send)
    {
        if (loginOpen) return;
        loginOpen = true;
        var f = new Form
        {
            Text = "Iniciar sesión en YouTube Music — petalwave",
            Size = new Size(540, 780), StartPosition = FormStartPosition.CenterParent,
            BackColor = Color.White, Icon = owner.Icon, MinimizeBox = false, ShowInTaskbar = true,
        };
        var w = new WebView2 { Dock = DockStyle.Fill, DefaultBackgroundColor = Color.White };
        f.Controls.Add(w);
        bool done = false;
        f.Shown += async (s, e) =>
        {
            try
            {
                await w.EnsureCoreWebView2Async(env);
                var c = w.CoreWebView2;
                c.Settings.AreDevToolsEnabled = false;
                c.Settings.IsPasswordAutosaveEnabled = false;   // petalwave no guarda tu contraseña
                c.Settings.IsGeneralAutofillEnabled = false;
                c.NewWindowRequested += (a, b) => { b.Handled = true; c.Navigate(b.Uri); };
                c.CookieManager.DeleteAllCookies();             // empezar sin sesiones viejas
                c.NavigationCompleted += async (a, b) =>
                {
                    if (done) return;
                    Uri u;
                    if (!Uri.TryCreate(c.Source, UriKind.Absolute, out u) || !u.Host.EndsWith("youtube.com")) return;
                    var all = new Dictionary<string, CoreWebView2Cookie>();
                    foreach (var site in new[] { "https://www.youtube.com", "https://music.youtube.com" })
                        foreach (var ck in await c.CookieManager.GetCookiesAsync(site))
                            if (ck.Domain.TrimStart('.').EndsWith("youtube.com")) all[ck.Domain + "|" + ck.Path + "|" + ck.Name] = ck;
                    var names = new HashSet<string>();
                    foreach (var ck in all.Values) names.Add(ck.Name);
                    // sesión completa: SAPISID + __Secure-3PAPISID + SID. Si todavía no, seguir esperando.
                    if (!names.Contains("SAPISID") || !names.Contains("__Secure-3PAPISID") || !names.Contains("SID")) return;
                    done = true;
                    var err = PostCookies(ToNetscape(all.Values));
                    c.CookieManager.DeleteAllCookies();
                    Launcher.Trace("login: " + (err == null ? "ok, " + all.Count + " cookies" : "error " + err));
                    send(err == null ? "login:ok:" + all.Count : "login:err:" + err);
                    f.Close();
                };
                c.Navigate(LoginUrl);
            }
            catch (Exception ex)
            {
                Launcher.Trace("login ERROR " + ex);
                send("login:err:" + ex.Message);
                done = true; f.Close();
            }
        };
        f.FormClosed += (s, e) => { loginOpen = false; if (!done) send("login:cancel"); };
        f.Show(owner);
    }

    public static void Run(string url, string data)
    {
        Application.EnableVisualStyles();
        var form = new Form
        {
            Text = Launcher.Title,
            BackColor = Deep,
            StartPosition = FormStartPosition.Manual,
            MinimumSize = new Size(420, 480),
            KeyPreview = false,
        };
        // ícono directo del archivo (no de la caché de Windows, que puede quedar con uno viejo)
        try
        {
            var ico = Path.Combine(Launcher.AppDir, "build", "icon.ico");
            form.Icon = File.Exists(ico) ? new Icon(ico) : Icon.ExtractAssociatedIcon(Application.ExecutablePath);
        }
        catch { try { form.Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { } }
        RestoreBounds(form, data);

        var web = new WebView2 { Dock = DockStyle.Fill, DefaultBackgroundColor = Deep };
        form.Controls.Add(web);
        form.HandleCreated += (s, e) => SetCaption(form, Deep);

        CoreWebView2 coreRef = null;
        Action<string> send = (msg) => { try { if (coreRef != null) coreRef.PostWebMessageAsString(msg); } catch { } };

        // ---- modos: mini reproductor (chico y siempre visible) y pantalla completa sin bordes ----
        bool mini = false, full = false;
        Rectangle normal = form.Bounds;
        FormWindowState normalState = form.WindowState;
        Action remember = () =>
        {
            normalState = form.WindowState;
            normal = form.WindowState == FormWindowState.Normal ? form.Bounds : form.RestoreBounds;
        };
        Action restore = () =>
        {
            form.FormBorderStyle = FormBorderStyle.Sizable;
            form.TopMost = false;
            form.WindowState = FormWindowState.Normal;
            form.MinimumSize = new Size(420, 480);
            form.Bounds = normal;
            if (normalState == FormWindowState.Maximized) form.WindowState = FormWindowState.Maximized;
        };
        Action<bool> setFull = null, setMini = null;
        setFull = (on) =>
        {
            if (on == full) return;
            if (on)
            {
                if (mini) { mini = false; restore(); }
                remember();
                form.WindowState = FormWindowState.Normal;
                form.FormBorderStyle = FormBorderStyle.None;
                form.WindowState = FormWindowState.Maximized;
            }
            else restore();
            full = on;
        };
        setMini = (on) =>
        {
            if (on == mini) return;
            if (on)
            {
                if (full) { full = false; restore(); }
                remember();
                form.WindowState = FormWindowState.Normal;
                form.MinimumSize = new Size(360, 130);
                var wa = Screen.FromControl(form).WorkingArea;
                form.Bounds = new Rectangle(wa.Right - 470, wa.Bottom - 180, 450, 160);
                form.TopMost = true;
            }
            else restore();
            mini = on;
        };
        form.FormClosing += (s, e) =>
        {
            if (mini || full) SaveBounds(normal, normalState == FormWindowState.Maximized, data);
            else SaveBounds(form.WindowState == FormWindowState.Normal ? form.Bounds : form.RestoreBounds, form.WindowState == FormWindowState.Maximized, data);
        };

        // ---- ícono en la bandeja: controles rápidos y notificaciones ----
        var tray = new NotifyIcon { Icon = form.Icon, Text = "petalwave", Visible = true };
        var menu = new ContextMenuStrip();
        EventHandler show = (s, e) =>
        {
            if (form.WindowState == FormWindowState.Minimized) form.WindowState = FormWindowState.Normal;
            form.Show(); form.Activate();
        };
        menu.Items.Add("Mostrar petalwave", null, show);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Play / pausa", null, (s, e) => send("cmd:toggle"));
        menu.Items.Add("Siguiente", null, (s, e) => send("cmd:next"));
        menu.Items.Add("Anterior", null, (s, e) => send("cmd:prev"));
        menu.Items.Add("Mini reproductor", null, (s, e) => send("cmd:mini"));
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Salir", null, (s, e) => form.Close());
        tray.ContextMenuStrip = menu;
        tray.DoubleClick += show;
        tray.BalloonTipClicked += show;
        form.FormClosed += (s, e) => { tray.Visible = false; tray.Dispose(); };

        form.Shown += async (s, e) =>
        {
            try
            {
                var opts = new CoreWebView2EnvironmentOptions("--autoplay-policy=no-user-gesture-required --enable-features=HardwareMediaKeyHandling");
                var env = await CoreWebView2Environment.CreateAsync(null, Path.Combine(data, "webview"), opts);
                await web.EnsureCoreWebView2Async(env);
                var core = web.CoreWebView2;
                coreRef = core;
                core.Settings.IsStatusBarEnabled = false;
                core.Settings.IsZoomControlEnabled = false;
                core.Settings.AreDevToolsEnabled = false;
                core.Settings.IsPasswordAutosaveEnabled = false;
                core.Settings.IsGeneralAutofillEnabled = false;

                core.DocumentTitleChanged += (a, b) =>
                {
                    var t = core.DocumentTitle;
                    form.Text = string.IsNullOrEmpty(t) || t.StartsWith("http") ? Launcher.Title : t;
                };
                // links a otras páginas → navegador del sistema
                core.NewWindowRequested += (a, b) => { b.Handled = true; OpenExternal(b.Uri); };
                core.NavigationStarting += (a, b) =>
                {
                    if (!b.Uri.StartsWith(url, StringComparison.OrdinalIgnoreCase) && !b.Uri.StartsWith("about:"))
                    {
                        b.Cancel = true;
                        OpenExternal(b.Uri);
                    }
                };
                // la interfaz avisa el color de la canción para teñir la barra de título
                core.WebMessageReceived += (a, b) =>
                {
                    try
                    {
                        var m = b.TryGetWebMessageAsString();
                        if (m == null) return;
                        if (m.StartsWith("caption:#") && m.Length == 15)
                            SetCaption(form, ColorTranslator.FromHtml(m.Substring(8)));
                        else if (m.StartsWith("pick:"))
                        {
                            // pick:<id>:<título>  →  picked:<id>:<ruta o vacío>
                            var rest = m.Substring(5); int i = rest.IndexOf(':');
                            var id = i < 0 ? rest : rest.Substring(0, i);
                            var title = i < 0 ? "" : rest.Substring(i + 1);
                            form.BeginInvoke((Action)(() => send("picked:" + id + ":" + PickFolder(form, title))));
                        }
                        else if (m == "login") form.BeginInvoke((Action)(() => ShowLogin(form, env, send)));
                        // la interfaz pide cerrar (p. ej. para instalar una actualización): cierre normal
                        else if (m == "quit") form.BeginInvoke((Action)(() => form.Close()));
                        else if (m == "mini:1" || m == "mini:0") setMini(m == "mini:1");
                        else if (m == "full:1" || m == "full:0") setFull(m == "full:1");
                        else if (m.StartsWith("notify:") && !form.ContainsFocus)
                        {
                            var parts = m.Substring(7).Split('\n');
                            var t = parts[0].Length > 60 ? parts[0].Substring(0, 60) + "…" : parts[0];
                            tray.ShowBalloonTip(3500, t, parts.Length > 1 && parts[1].Length > 0 ? parts[1] : "petalwave", ToolTipIcon.None);
                        }
                    }
                    catch { }
                };
                web.Source = new Uri(url);
            }
            catch (Exception ex)
            {
                Launcher.Trace("ERROR WebView2 " + ex);
                MessageBox.Show("No se pudo crear la ventana:\n" + ex.Message, Launcher.Title, MessageBoxButtons.OK, MessageBoxIcon.Error);
                form.Close();
            }
        };
        Application.Run(form);
    }
}

// ================= respaldo: navegador en modo app =================
static class BrowserFallback
{
    static string Find(params string[] paths) { foreach (var p in paths) if (File.Exists(p)) return p; return null; }

    public static void Run(string url, string data)
    {
        string pf86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);
        string pf64 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
        string lad = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        string browser = Find(
            Path.Combine(pf86, @"Microsoft\Edge\Application\msedge.exe"),
            Path.Combine(pf64, @"Microsoft\Edge\Application\msedge.exe"),
            Path.Combine(pf64, @"BraveSoftware\Brave-Browser\Application\brave.exe"),
            Path.Combine(lad, @"BraveSoftware\Brave-Browser\Application\brave.exe"),
            Path.Combine(pf64, @"Google\Chrome\Application\chrome.exe"),
            Path.Combine(lad, @"Google\Chrome\Application\chrome.exe"));
        if (browser == null)
        {
            Process.Start(url);
            MessageBox.Show("petalwave está abierto en tu navegador.\nApretá Aceptar para cerrarlo.", Launcher.Title, MessageBoxButtons.OK, MessageBoxIcon.Information);
            return;
        }
        string profile = Path.Combine(data, "ventana-" + Path.GetFileNameWithoutExtension(browser));
        var ui = Process.Start(new ProcessStartInfo(browser,
            "--app=" + url + " --user-data-dir=\"" + profile + "\" --window-size=1400,900 --no-first-run --no-default-browser-check")
        { UseShellExecute = false });
        ui.WaitForExit();
        Thread.Sleep(1500);
        while (ProfileRunning(profile)) Thread.Sleep(1000);
    }

    static bool ProfileRunning(string profile)
    {
        try
        {
            using (var s = new System.Management.ManagementObjectSearcher(
                "SELECT CommandLine FROM Win32_Process WHERE Name='brave.exe' OR Name='chrome.exe' OR Name='msedge.exe'"))
            {
                foreach (System.Management.ManagementObject o in s.Get())
                {
                    var cl = o["CommandLine"] as string;
                    if (cl != null && cl.IndexOf(profile, StringComparison.OrdinalIgnoreCase) >= 0) return true;
                }
            }
        }
        catch { }
        return false;
    }
}
