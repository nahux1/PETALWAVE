// Instalar-Petalwave.exe: instalador de un solo archivo (pensado para gente que no sabe de computación).
// Baja la última versión de GitHub (latest.json → zip completo), verifica su SHA-256, la pone en
// %LOCALAPPDATA%\Programs\petalwave (no pide permisos de administrador), crea los accesos directos y la
// registra en "Aplicaciones instaladas" para poder desinstalarla. Si ya estaba, la actualiza sin tocar
// tu música, tus descargas ni tus ajustes. Con /uninstall la desinstala (preguntando por tus datos).
// Compilar: build\build-installer.bat  (C# 5, .NET Framework 4.x que ya trae Windows)
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Security.Cryptography;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Win32;

static class Installer
{
    const string Manifest = "https://github.com/nahux1/PETALWAVE/releases/latest/download/latest.json";
    const string Title = "Petalwave";
    const string UninstallKey = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\Petalwave";
    static readonly Color Deep = Color.FromArgb(24, 10, 14), Ink = Color.FromArgb(40, 16, 22), Accent = Color.FromArgb(232, 70, 98), Soft = Color.FromArgb(236, 220, 224), Dim = Color.FromArgb(170, 150, 156);

    // pruebas: PW_INSTALL_ROOT instala en otra carpeta (sin accesos directos ni registro) y PW_INSTALL_MANIFEST usa un latest.json local
    static readonly string TestRoot = Environment.GetEnvironmentVariable("PW_INSTALL_ROOT");
    static readonly string TestManifest = Environment.GetEnvironmentVariable("PW_INSTALL_MANIFEST");
    static string Root { get { return !string.IsNullOrEmpty(TestRoot) ? TestRoot : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs"); } }
    static string AppDir { get { return Path.Combine(Root, "petalwave"); } }
    static string Exe { get { return Path.Combine(AppDir, "petalwave.exe"); } }

    [STAThread]
    static int Main(string[] args)
    {
        ServicePointManager.SecurityProtocol = (SecurityProtocolType)3072;   // TLS 1.2 (GitHub lo exige)
        Application.EnableVisualStyles();
        if (args.Length > 0 && args[0].ToLowerInvariant() == "/uninstall") return Uninstall();
        if (args.Length > 0 && args[0].ToLowerInvariant() == "/silent" && !string.IsNullOrEmpty(TestRoot))
        {
            string log = Path.Combine(TestRoot, "instalador.log");
            Directory.CreateDirectory(TestRoot);
            var gate = new object(); int lastPct = -1;
            Action<string, int> write = (s, p) => { lock (gate) { if (p == lastPct && p < 100) return; lastPct = p; try { File.AppendAllText(log, p + "% " + s.Replace('\n', ' ') + Environment.NewLine); } catch { } } };
            try { Install(write, false); File.AppendAllText(log, "OK" + Environment.NewLine); return 0; }
            catch (Exception ex) { File.AppendAllText(log, "ERROR " + ex.Message + Environment.NewLine); return 2; }
        }
        Application.Run(new Win());
        return 0;
    }

    // ---------- ventana ----------
    class Win : Form
    {
        Label status; ProgressBar bar; Button go; CheckBox desk, open;
        public Win()
        {
            Text = "Instalar Petalwave"; FormBorderStyle = FormBorderStyle.FixedDialog; MaximizeBox = false; StartPosition = FormStartPosition.CenterScreen;
            ClientSize = new Size(460, 300); BackColor = Deep; ForeColor = Soft; Font = new Font("Segoe UI", 10f);
            try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }
            var flower = new Label { Text = "❀", Font = new Font("Segoe UI Symbol", 34f), ForeColor = Accent, AutoSize = true, Location = new Point(24, 18) };
            var title = new Label { Text = "Petalwave", Font = new Font("Segoe UI Semibold", 20f), AutoSize = true, Location = new Point(86, 22) };
            var sub = new Label { Text = "Música gratis, sin publicidad y sin cuenta.", ForeColor = Dim, AutoSize = true, Location = new Point(89, 62) };
            bool upd = File.Exists(Exe);
            status = new Label { Text = upd ? "Ya tenés Petalwave: se va a actualizar a la última versión.\nTu música, descargas y ajustes no se tocan." : "Se instala en tu usuario (no pide permisos de administrador).\nOcupa unos 600 MB.", ForeColor = Soft, Location = new Point(26, 104), Size = new Size(410, 46) };
            bar = new ProgressBar { Location = new Point(28, 156), Size = new Size(404, 14), Style = ProgressBarStyle.Continuous };
            desk = new CheckBox { Text = "Crear acceso directo en el escritorio", Checked = true, AutoSize = true, Location = new Point(28, 186), ForeColor = Soft };
            open = new CheckBox { Text = "Abrir Petalwave al terminar", Checked = true, AutoSize = true, Location = new Point(28, 212), ForeColor = Soft };
            go = new Button { Text = upd ? "Actualizar" : "Instalar", Location = new Point(312, 248), Size = new Size(120, 36), BackColor = Accent, ForeColor = Color.White, FlatStyle = FlatStyle.Flat, Font = new Font("Segoe UI Semibold", 10.5f) };
            go.FlatAppearance.BorderSize = 0;
            var cancel = new Button { Text = "Cancelar", Location = new Point(196, 248), Size = new Size(106, 36), BackColor = Ink, ForeColor = Soft, FlatStyle = FlatStyle.Flat };
            cancel.FlatAppearance.BorderColor = Color.FromArgb(90, 40, 50);
            cancel.Click += delegate { Close(); };
            go.Click += delegate { Start(); };
            Controls.AddRange(new Control[] { flower, title, sub, status, bar, desk, open, go, cancel });
            CancelButton = cancel;   // sin AcceptButton: un Enter suelto no arranca la instalación
        }

        void Say(string s, int pct)
        {
            if (InvokeRequired) { BeginInvoke(new Action(delegate { Say(s, pct); })); return; }
            status.Text = s; if (pct >= 0) bar.Value = Math.Max(0, Math.Min(100, pct));
        }

        void Start()
        {
            go.Enabled = false; desk.Enabled = false; open.Enabled = false;
            bool mkDesk = desk.Checked, run = open.Checked;
            var t = new Thread(delegate ()
            {
                try
                {
                    Install(Say, mkDesk);
                    BeginInvoke(new Action(delegate
                    {
                        Say("¡Listo! Petalwave quedó instalado ❀\nLo encontrás en el menú Inicio" + (mkDesk ? " y en el escritorio." : "."), 100);
                        if (run) { try { Process.Start(new ProcessStartInfo(Exe) { WorkingDirectory = AppDir }); } catch { } Close(); }
                        else { go.Text = "Cerrar"; go.Enabled = true; go.Click += delegate { Close(); }; }
                    }));
                }
                catch (Exception ex)
                {
                    BeginInvoke(new Action(delegate
                    {
                        Say("No se pudo instalar: " + ex.Message, -1);
                        MessageBox.Show(this, "No se pudo instalar Petalwave.\n\n" + ex.Message + "\n\nRevisá tu conexión a internet y probá de nuevo. Si sigue, avisanos en github.com/nahux1/PETALWAVE/issues", Title, MessageBoxButtons.OK, MessageBoxIcon.Warning);
                        go.Text = "Reintentar"; go.Enabled = true;
                    }));
                }
            });
            t.IsBackground = true; t.Start();
        }
    }

    // ---------- instalación ----------
    static void Install(Action<string, int> say, bool desktopShortcut)
    {
        say("Buscando la última versión…", 2);
        var wc = new WebClient(); wc.Headers[HttpRequestHeader.UserAgent] = "Petalwave-Instalador";
        wc.Encoding = System.Text.Encoding.UTF8;
        string json = !string.IsNullOrEmpty(TestManifest) ? File.ReadAllText(TestManifest) : wc.DownloadString(Manifest);
        var m = (Dictionary<string, object>)new JavaScriptSerializer().DeserializeObject(json);
        string version = Convert.ToString(m["version"]);
        var full = (Dictionary<string, object>)m["full"];
        string url = Convert.ToString(full["url"]);
        string sha = full.ContainsKey("sha256") ? Convert.ToString(full["sha256"]).ToLowerInvariant() : "";
        var u = new Uri(url);
        bool testFile = !string.IsNullOrEmpty(TestManifest) && u.IsFile;
        if (!testFile && (u.Scheme != "https" || !(u.Host == "github.com" || u.Host.EndsWith(".githubusercontent.com")))) throw new Exception("la dirección de descarga no es de GitHub");

        // si Petalwave está abierto, hay que cerrarlo para reemplazar los archivos
        foreach (var p in Process.GetProcessesByName("petalwave"))
        {
            string path = ""; try { path = p.MainModule.FileName; } catch { }
            if (path.Equals(Exe, StringComparison.OrdinalIgnoreCase))
            {
                say("Cerrando Petalwave para actualizarlo…", 3);
                try { p.CloseMainWindow(); if (!p.WaitForExit(8000)) p.Kill(); } catch { }
            }
        }

        string zip = Path.Combine(Path.GetTempPath(), "petalwave-" + version + ".zip");
        say("Descargando Petalwave " + version + "…", 4);
        var done = new ManualResetEvent(false); Exception err = null;
        var dl = new WebClient(); dl.Headers[HttpRequestHeader.UserAgent] = "Petalwave-Instalador";
        dl.DownloadProgressChanged += (s, e) => { long tot = e.TotalBytesToReceive > 0 ? e.TotalBytesToReceive : 1; say(string.Format("Descargando Petalwave {0}… {1} de {2} MB", version, e.BytesReceived / 1048576, tot / 1048576), 4 + (int)(e.BytesReceived * 76 / tot)); };
        dl.DownloadFileCompleted += (s, e) => { err = e.Error; done.Set(); };
        dl.DownloadFileAsync(u, zip);
        done.WaitOne();
        if (err != null) throw new Exception("la descarga se cortó (" + err.Message + ")");

        if (sha.Length == 64)
        {
            say("Verificando que el archivo esté sano…", 81);
            string got;
            using (var f = File.OpenRead(zip)) using (var h = SHA256.Create()) got = BitConverter.ToString(h.ComputeHash(f)).Replace("-", "").ToLowerInvariant();
            if (got != sha) { try { File.Delete(zip); } catch { } throw new Exception("el archivo descargado está dañado; probá de nuevo"); }
        }

        say("Instalando…", 84);
        Directory.CreateDirectory(Root);
        using (var z = ZipFile.OpenRead(zip))
        {
            int i = 0, n = z.Entries.Count;
            foreach (var e in z.Entries)
            {
                i++;
                string rel = e.FullName.Replace('\\', '/');
                if (!rel.StartsWith("petalwave/", StringComparison.OrdinalIgnoreCase)) continue;
                string dest = Path.GetFullPath(Path.Combine(Root, rel.Replace('/', Path.DirectorySeparatorChar)));
                if (!dest.StartsWith(AppDir, StringComparison.OrdinalIgnoreCase)) continue;   // nada fuera de la carpeta
                if (rel.EndsWith("/")) { Directory.CreateDirectory(dest); continue; }
                Directory.CreateDirectory(Path.GetDirectoryName(dest));
                e.ExtractToFile(dest, true);
                if (i % 20 == 0) say("Instalando… " + (i * 100 / n) + "%", 84 + i * 12 / n);
            }
        }
        try { File.Delete(zip); } catch { }

        if (!string.IsNullOrEmpty(TestRoot)) { say("Listo (prueba: sin accesos directos ni registro)", 100); return; }
        say("Creando accesos directos…", 97);
        string programs = Environment.GetFolderPath(Environment.SpecialFolder.Programs);
        Shortcut(Path.Combine(programs, "Petalwave.lnk"));
        if (desktopShortcut) Shortcut(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "Petalwave.lnk"));

        // "Aplicaciones instaladas": el instalador se copia como desinstalador
        string unin = Path.Combine(AppDir, "desinstalar.exe");
        try { File.Copy(Application.ExecutablePath, unin, true); } catch { }
        using (var k = Registry.CurrentUser.CreateSubKey(UninstallKey))
        {
            k.SetValue("DisplayName", "Petalwave");
            k.SetValue("DisplayVersion", version);
            k.SetValue("Publisher", "Petalwave");
            k.SetValue("DisplayIcon", Exe);
            k.SetValue("InstallLocation", AppDir);
            k.SetValue("UninstallString", "\"" + unin + "\" /uninstall");
            k.SetValue("URLInfoAbout", "https://github.com/nahux1/PETALWAVE");
            k.SetValue("NoModify", 1, RegistryValueKind.DWord);
            k.SetValue("NoRepair", 1, RegistryValueKind.DWord);
            k.SetValue("EstimatedSize", 600 * 1024, RegistryValueKind.DWord);
        }
        say("Listo", 100);
    }

    static void Shortcut(string lnk)
    {
        try
        {
            var t = Type.GetTypeFromProgID("WScript.Shell");
            object sh = Activator.CreateInstance(t);
            object sc = t.InvokeMember("CreateShortcut", System.Reflection.BindingFlags.InvokeMethod, null, sh, new object[] { lnk });
            var st = sc.GetType();
            st.InvokeMember("TargetPath", System.Reflection.BindingFlags.SetProperty, null, sc, new object[] { Exe });
            st.InvokeMember("WorkingDirectory", System.Reflection.BindingFlags.SetProperty, null, sc, new object[] { AppDir });
            st.InvokeMember("IconLocation", System.Reflection.BindingFlags.SetProperty, null, sc, new object[] { Exe + ",0" });
            st.InvokeMember("Description", System.Reflection.BindingFlags.SetProperty, null, sc, new object[] { "Petalwave: reproductor de música" });
            st.InvokeMember("Save", System.Reflection.BindingFlags.InvokeMethod, null, sc, null);
        }
        catch { }
    }

    // ---------- desinstalación ----------
    static int Uninstall()
    {
        if (MessageBox.Show("¿Desinstalar Petalwave?", Title, MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes) return 1;
        bool hasData = Directory.Exists(Path.Combine(AppDir, "data")) || Directory.Exists(Path.Combine(AppDir, "descargas"));
        bool wipe = hasData && MessageBox.Show("¿Borrar también tu música descargada, playlists y ajustes?\n\nSi tocás \"No\", quedan en:\n" + AppDir + "\n(las carpetas data y descargas)", Title, MessageBoxButtons.YesNo, MessageBoxIcon.Warning, MessageBoxDefaultButton.Button2) == DialogResult.Yes;
        foreach (var p in Process.GetProcessesByName("petalwave")) { try { p.CloseMainWindow(); if (!p.WaitForExit(6000)) p.Kill(); } catch { } }
        foreach (var lnk in new[] { Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "Petalwave.lnk"), Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "Petalwave.lnk") })
            try { File.Delete(lnk); } catch { }
        try { Registry.CurrentUser.DeleteSubKeyTree(UninstallKey, false); } catch { }
        // borrar todo menos tus datos (o todo, si lo pediste); el desinstalador se borra al final, cuando ya se cerró
        try
        {
            foreach (var d in Directory.GetDirectories(AppDir))
            {
                string name = Path.GetFileName(d).ToLowerInvariant();
                if (!wipe && (name == "data" || name == "descargas")) continue;
                try { Directory.Delete(d, true); } catch { }
            }
            foreach (var f in Directory.GetFiles(AppDir))
            {
                string name = Path.GetFileName(f).ToLowerInvariant();
                if (name == "desinstalar.exe") continue;
                if (!wipe && (name == "cookies.txt" || name.StartsWith("wallpaper.") || name == "sync.json" || name == "sync-archive.txt")) continue;
                try { File.Delete(f); } catch { }
            }
        }
        catch { }
        string self = Path.Combine(AppDir, "desinstalar.exe");
        string cmd = "/c timeout /t 2 /nobreak >nul & del /f /q \"" + self + "\"" + (wipe ? " & rmdir /s /q \"" + AppDir + "\"" : " & rmdir \"" + AppDir + "\"");
        try { Process.Start(new ProcessStartInfo("cmd.exe", cmd) { CreateNoWindow = true, UseShellExecute = false, WindowStyle = ProcessWindowStyle.Hidden }); } catch { }
        MessageBox.Show(wipe ? "Petalwave se desinstaló." : "Petalwave se desinstaló.\nTu música y tus ajustes quedaron guardados por si volvés ❀", Title, MessageBoxButtons.OK, MessageBoxIcon.Information);
        return 0;
    }
}
