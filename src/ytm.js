// puente con ytmusicapi (Python): un proceso persistente que recibe pedidos JSON por stdin.
// Se inicia al primer uso, se reinicia solo si se cae, y cada pedido tiene timeout.
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');

function findPython(root) {
  const cands = [
    path.join(root || '', 'runtime', 'python', 'python.exe'),   // versión portable (zip de GitHub)
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', 'Python312', 'python.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', 'Python313', 'python.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', 'Python311', 'python.exe'),
  ];
  for (const c of cands) if (fs.existsSync(c)) return c;
  try {
    for (const p of execSync('where python', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().split(/\r?\n/)) {
      const x = p.trim();
      if (x && !/WindowsApps/i.test(x) && fs.existsSync(x)) return x;   // el alias de la Store no es Python real
    }
  } catch {}
  return null;
}

class YTM {
  constructor({ root, cookiesTxt }) {
    this.py = findPython(root);
    this.script = path.join(root, 'src', 'ytm_bridge.py');
    this.libOk = fs.existsSync(path.join(root, 'lib', 'py', 'ytmusicapi'));
    this.cookiesTxt = cookiesTxt;
    this.proc = null;
    this.pending = new Map();
    this.n = 0;
    this.buf = '';
    this.cache = new Map();
  }
  available() { return !!(this.py && this.libOk); }

  start() {
    if (this.proc) return;
    this.proc = spawn(this.py, ['-I', '-u', this.script, this.cookiesTxt], { windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
    this.proc.stdout.on('data', (c) => {
      this.buf += c.toString('utf8');
      let i;
      while ((i = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, i).trim(); this.buf = this.buf.slice(i + 1);
        if (!line) continue;
        let m; try { m = JSON.parse(line); } catch { continue; }
        const p = this.pending.get(m.id);
        if (!p) continue;
        this.pending.delete(m.id); clearTimeout(p.t);
        if (m.error) { const e = new Error(m.error); e.auth = !!m.auth; p.err(e); } else p.ok(m.result);
      }
    });
    this.proc.stderr.on('data', (c) => { const s = c.toString(); if (!/DeprecationWarning|FutureWarning/.test(s)) console.error('[ytm]', s.trim().slice(0, 300)); });
    this.proc.on('exit', () => {
      this.proc = null; this.buf = '';
      for (const p of this.pending.values()) { clearTimeout(p.t); p.err(new Error('el proceso de ytmusicapi se cerró')); }
      this.pending.clear();
    });
  }

  call(method, params = {}, { timeout = 45000, cacheMs = 0 } = {}) {
    if (!this.available()) return Promise.reject(new Error('ytmusicapi no está instalado (falta Python o lib/py)'));
    const key = cacheMs ? method + JSON.stringify(params) : null;
    if (key) { const c = this.cache.get(key); if (c && Date.now() - c.at < cacheMs) return Promise.resolve(c.v); }
    this.start();
    const id = ++this.n;
    return new Promise((ok, err) => {
      const t = setTimeout(() => { this.pending.delete(id); err(new Error('YouTube Music tardó demasiado en responder')); }, timeout);
      this.pending.set(id, { ok: (v) => { if (key) { this.cache.set(key, { v, at: Date.now() }); if (this.cache.size > 300) this.cache.delete(this.cache.keys().next().value); } ok(v); }, err, t });
      this.proc.stdin.write(JSON.stringify({ id, method, params }) + '\n');
    });
  }

  clearCache() { this.cache.clear(); }
  stop() { if (this.proc) { try { this.proc.kill(); } catch {} } }
}

// ID de YouTube desde etiquetas (yt-dlp guarda la URL en purl/comment)
function ytIdFrom(...vals) {
  for (const v of vals) {
    const m = /(?:youtu\.be\/|[?&]v=|\/shorts\/)([A-Za-z0-9_-]{11})/.exec(String(v || ''));
    if (m) return m[1];
  }
  return null;
}

module.exports = { YTM, ytIdFrom };
