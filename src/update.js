// actualizaciones desde GitHub sin que el usuario tenga que hacer nada raro:
//   1) mira la última Release de nahux1/PETALWAVE y compara con version.json
//   2) baja "petalwave-update.zip" (solo la app + yt-dlp nuevo, sin Node/ffmpeg/Python)
//   3) lo extrae en data/update y lanza un script aparte que espera a que petalwave se cierre,
//      copia los archivos nuevos (nunca toca data/, descargas/, cookies ni wallpaper) y lo vuelve a abrir.
'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');
const { spawn, spawnSync } = require('child_process');
const crypto = require('crypto');

const REPO = 'nahux1/PETALWAVE';
const ASSET = 'petalwave-update.zip';
const MANIFEST = `https://github.com/${REPO}/releases/latest/download/latest.json`;
const ALLOWED_HOSTS = /(^|\.)github\.com$|(^|\.)githubusercontent\.com$/;

const cmpVer = (a, b) => {
  const pa = String(a).replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d; }
  return 0;
};

function get(url, { json, file, onProgress, redirects = 6, accept } = {}) {
  return new Promise((ok, fail) => {
    const u = new URL(url);
    if (u.protocol !== 'https:' || !ALLOWED_HOSTS.test(u.hostname)) return fail(new Error('dirección de descarga no permitida: ' + u.hostname));
    const req = https.get(u, { headers: { 'User-Agent': 'petalwave-updater', Accept: accept || (json ? 'application/vnd.github+json' : 'application/octet-stream') }, timeout: 30000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if (!redirects) return fail(new Error('demasiadas redirecciones'));
        return ok(get(new URL(res.headers.location, u).toString(), { json, file, onProgress, accept, redirects: redirects - 1 }));
      }
      if (res.statusCode === 404) { res.resume(); return fail(new Error('no encontrado (404)')); }
      if (res.statusCode === 403 || res.statusCode === 429) {
        res.resume();
        const limited = res.headers['x-ratelimit-remaining'] === '0';
        const e = new Error(limited ? 'GitHub limitó las consultas desde tu conexión por un rato (403). Probá de nuevo en unos minutos.' : 'GitHub rechazó la descarga (' + res.statusCode + '). Probá de nuevo en unos minutos.');
        e.code = 'GH403'; return fail(e);
      }
      if (res.statusCode !== 200) { res.resume(); return fail(new Error('GitHub respondió ' + res.statusCode)); }
      const total = +res.headers['content-length'] || 0;
      let got = 0;
      if (file) {
        const out = fs.createWriteStream(file);
        res.on('data', (c) => { got += c.length; if (onProgress) onProgress(got, total); });
        res.pipe(out);
        out.on('finish', () => out.close(() => ok({ size: got })));
        out.on('error', fail); res.on('error', fail);
        return;
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => { try { const s = Buffer.concat(chunks).toString('utf8'); ok(json ? JSON.parse(s) : s); } catch (e) { fail(e); } });
      res.on('error', fail);
    });
    req.on('timeout', () => req.destroy(new Error('GitHub no responde (sin internet?)')));
    req.on('error', fail);
  });
}

class Updater {
  constructor({ root, dataDir, broadcast }) {
    Object.assign(this, { root, broadcast });
    this.dir = path.join(dataDir, 'update');
    this.current = Updater.localVersion(root);
    this.last = null; this.lastAt = 0; this.busy = false;
  }
  static localVersion(root) {
    try { return JSON.parse(fs.readFileSync(path.join(root, 'version.json'), 'utf8').replace(/^\uFEFF/, '')).version || '0.0.0'; } catch { return '0.0.0'; }
  }

  // ¿hay una versión nueva? (cacheado 30 min para no molestar a GitHub)
  async check(force) {
    if (!force && this.last && Date.now() - this.lastAt < 30 * 60e3) return this.last;
    // PW_UPDATE_LOCAL = ruta a un JSON con el mismo formato que la API de GitHub (solo para probar sin publicar)
    if (!process.env.PW_UPDATE_LOCAL) {
      const mf = process.env.PW_UPDATE_MANIFEST;   // para probar sin publicar: ruta a un latest.json local
      try { return this.fromManifest(mf && !/^https:/.test(mf) ? JSON.parse(fs.readFileSync(mf, 'utf8').replace(/^\uFEFF/, '')) : await get(mf || MANIFEST, { json: true, accept: 'application/json, */*' })); }
      catch (e) { if (process.env.PW_UPDATE_MANIFEST) throw e; }   // versiones viejas sin latest.json: se usa la API
    }
    const r = process.env.PW_UPDATE_LOCAL ? JSON.parse(fs.readFileSync(process.env.PW_UPDATE_LOCAL, 'utf8').replace(/^\uFEFF/, '')) : await get(`https://api.github.com/repos/${REPO}/releases/latest`, { json: true });
    const latest = String(r.tag_name || '').replace(/^v/, '');
    const asset = (r.assets || []).find((a) => a.name === ASSET);
    const full = (r.assets || []).find((a) => /windows\.zip$/.test(a.name));
    this.last = {
      current: this.current, latest, hasUpdate: !!latest && cmpVer(latest, this.current) > 0,
      canAuto: !!asset, size: asset ? asset.size : 0, url: asset ? asset.browser_download_url : null,
      fullUrl: full ? full.browser_download_url : r.html_url, page: r.html_url,
      title: r.name || 'petalwave ' + latest, notes: String(r.body || '').slice(0, 4000), date: r.published_at,
    };
    this.lastAt = Date.now();
    return this.last;
  }

  // latest.json: { version, title, date, page, notes, update: { url, size, sha256 }, full: { url, size } }
  fromManifest(m) {
    const latest = String(m.version || '').replace(/^v/, '');
    if (!latest) throw new Error('latest.json sin versión');
    const ok = (u) => { try { const x = new URL(u); return (x.protocol === 'https:' && ALLOWED_HOSTS.test(x.hostname)) || (x.protocol === 'file:' && !!process.env.PW_UPDATE_MANIFEST); } catch { return false; } };
    const upd = m.update && ok(m.update.url) ? m.update : null;
    this.last = {
      current: this.current, latest, hasUpdate: cmpVer(latest, this.current) > 0,
      canAuto: !!upd, size: upd ? upd.size : 0, url: upd ? upd.url : null, sha256: upd && /^[a-f0-9]{64}$/.test(upd.sha256 || '') ? upd.sha256 : null,
      fullUrl: m.full && ok(m.full.url) ? m.full.url : m.page, page: ok(m.page) ? m.page : `https://github.com/${REPO}/releases/latest`,
      title: m.title || 'petalwave ' + latest, notes: String(m.notes || '').slice(0, 4000), date: m.date, via: 'manifest',
    };
    this.lastAt = Date.now();
    return this.last;
  }

  emit(state, extra) { this.broadcast('update', { state, ...extra }); }

  // baja, verifica y prepara; devuelve cuando el script de instalación ya está esperando a que se cierre la app
  async apply() {
    if (this.busy) throw new Error('ya se está actualizando');
    if (process.platform !== 'win32') throw new Error('la actualización automática es solo para Windows');
    this.busy = true;
    try {
      // la consulta de hace un rato alcanza (cada consulta cuenta para el límite de GitHub)
      const info = this.last && Date.now() - this.lastAt < 10 * 60e3 ? this.last : await this.check(true);
      if (!info.hasUpdate) throw new Error('ya tenés la última versión (' + info.current + ')');
      if (!info.url) throw new Error('esta versión no trae actualización automática: bajá el zip completo');
      fs.rmSync(this.dir, { recursive: true, force: true });
      fs.mkdirSync(this.dir, { recursive: true });
      const zip = path.join(this.dir, ASSET);
      this.emit('downloading', { pct: 0 });
      let lastPct = -1;
      const local = (process.env.PW_UPDATE_LOCAL || process.env.PW_UPDATE_MANIFEST) && /^file:/.test(info.url);
      if (local) fs.copyFileSync(new URL(info.url), zip);
      const onProgress = (g, t) => { const pct = t ? Math.floor((g / t) * 100) : 0; if (pct !== lastPct) { lastPct = pct; this.emit('downloading', { pct, got: g, total: t }); } };
      let r = null;
      if (local) r = { size: fs.statSync(zip).size };
      else for (let i = 0; i < 3 && !r; i++) {
        try { r = await get(info.url, { file: zip, onProgress }); if (info.size && r.size !== info.size) r = null; }
        catch (e) { if (i === 2) throw e; }
        if (!r) await new Promise((w) => setTimeout(w, 2000 * (i + 1)));
      }
      if (!r) throw new Error('la descarga quedó incompleta, probá de nuevo');
      if (info.sha256) {
        const h = crypto.createHash('sha256').update(fs.readFileSync(zip)).digest('hex');
        if (h !== info.sha256) throw new Error('el paquete descargado no coincide con el publicado (verificación SHA-256): no se instaló nada');
      }
      this.emit('extracting');
      const out = path.join(this.dir, 'new');
      fs.mkdirSync(out, { recursive: true });
      // tar.exe viene con Windows 10/11 y abre .zip
      const tar = spawnSync(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe'), ['-xf', zip, '-C', out], { windowsHide: true });
      if (tar.status !== 0) throw new Error('no se pudo descomprimir la actualización');
      const pkg = path.join(out, 'petalwave');
      if (!fs.existsSync(path.join(pkg, 'server.js')) || !fs.existsSync(path.join(pkg, 'version.json'))) throw new Error('la actualización descargada no es válida');
      const v = Updater.localVersion(pkg);
      if (cmpVer(v, this.current) <= 0) throw new Error('la actualización descargada no es más nueva');
      // script que corre aparte: espera el cierre, copia y vuelve a abrir
      const ps1 = path.join(this.dir, 'instalar.ps1');
      fs.writeFileSync(ps1, '\uFEFF' + SCRIPT, 'utf8');
      // Node mete a sus procesos hijos en un grupo que muere con él, y PowerShell "separado" no arranca.
      // Por eso lo lanza wscript (sin consola) con un .vbs: así el instalador sobrevive al cierre de petalwave.
      const sys = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');
      const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
      const ps = `& ${q(ps1)} -App ${q(this.root)} -Pkg ${q(pkg)} -ServerPid ${process.pid} -Log ${q(path.join(this.dir, 'instalar.log'))}${process.env.PW_UPDATE_NORESTART ? ' -NoRestart' : ''}`;
      const line = `"${path.join(sys, 'WindowsPowerShell', 'v1.0', 'powershell.exe')}" -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command "${ps}"`;
      const vbs = path.join(this.dir, 'instalar.vbs');
      // UTF-16 con BOM: así funcionan las rutas con acentos (p. ej. C:\Users\José)
      fs.writeFileSync(vbs, '\uFEFFCreateObject("WScript.Shell").Run "' + line.replace(/"/g, '""') + '", 0, False\r\n', 'utf16le');
      spawn(path.join(sys, 'wscript.exe'), ['//B', '//Nologo', vbs], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
      this.emit('ready', { version: v });
      return { ok: true, version: v };
    } catch (e) {
      this.emit('error', { error: e.message });
      throw e;
    } finally { this.busy = false; }
  }
}

// copia con robocopy: /E subcarpetas; se excluyen las carpetas y archivos personales por las dudas
const SCRIPT = String.raw`param([string]$App, [string]$Pkg, [int]$ServerPid, [string]$Log, [switch]$NoRestart)
$ErrorActionPreference = 'Continue'
function L($m) { Add-Content -Path $Log -Value ("{0:HH:mm:ss} {1}" -f (Get-Date), $m) -Encoding utf8 }
L "esperando que petalwave se cierre ($App)"
$exe = Join-Path $App 'petalwave.exe'
for ($i = 0; $i -lt 240; $i++) {
  $srv = Get-Process -Id $ServerPid -ErrorAction SilentlyContinue
  $win = Get-CimInstance Win32_Process -Filter "Name='petalwave.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.ExecutablePath -eq $exe }
  if (-not $srv -and -not $win) { break }
  Start-Sleep -Milliseconds 500
}
Start-Sleep -Milliseconds 800
L "copiando archivos nuevos"
& robocopy $Pkg $App /E /R:5 /W:1 /NFL /NDL /NJH /NJS /NP /XD data descargas /XF cookies.txt sync.json sync-archive.txt "wallpaper.*" | Out-Null
L ("robocopy terminó con código " + $LASTEXITCODE)
if ($LASTEXITCODE -ge 8) { L "ERROR al copiar"; Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show("No se pudo terminar la actualización de petalwave.\nCerrá todas sus ventanas y probá de nuevo, o bajá el zip completo de GitHub.", "petalwave") | Out-Null }
if ((Test-Path $exe) -and -not $NoRestart) { Start-Process -FilePath $exe -WorkingDirectory $App; L "petalwave abierto de nuevo" }
`;

module.exports = { Updater, cmpVer };
