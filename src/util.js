// utilidades compartidas del servidor (sin dependencias externas)
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, execSync } = require('child_process');

const IS_WIN = process.platform === 'win32';

// ---------- localizar binarios (yt-dlp, ffmpeg, ffprobe) ----------
function findBin(name, root) {
  const exe = IS_WIN ? name + '.exe' : name;
  const candidates = [
    path.join(root, 'bin', exe),
    path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Links', exe),
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  try {
    const p = execSync(IS_WIN ? `where ${name}` : `which ${name}`, { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().split(/\r?\n/)[0].trim();
    if (p) return p;
  } catch {}
  // winget instala ffmpeg dentro de Packages\Gyan.FFmpeg_*\ffmpeg-*\bin
  try {
    const pk = path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Packages');
    for (const d of fs.readdirSync(pk)) {
      if (!d.toLowerCase().includes(name.replace('probe', 'mpeg'))) continue;
      for (const sub of fs.readdirSync(path.join(pk, d))) {
        const f = path.join(pk, d, sub, 'bin', exe);
        if (fs.existsSync(f)) return f;
      }
    }
  } catch {}
  return null;
}

// yt-dlp necesita un motor de JavaScript para YouTube: se le pasa el mismo Node que corre petalwave
// (en la versión portable no hay deno ni Node instalado en el sistema)
const YT_JS = ['--js-runtimes', 'node:' + process.execPath];

const sha = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 16);

// ---------- HTTP ----------
function json(res, code, obj) {
  if (res.headersSent) return;
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}
// cuerpo JSON con límite de tamaño (evita que un pedido gigante llene la memoria)
function readBody(req, limit = 2e6) {
  return new Promise((ok) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => { size += c.length; if (size <= limit) chunks.push(c); });
    req.on('end', () => {
      if (size > limit) return ok({ __tooBig: true });
      try { ok(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { ok({}); }
    });
    req.on('error', () => ok({}));
  });
}
// cuerpo binario con límite: devuelve null si se pasa
function readRaw(req, limit) {
  return new Promise((ok) => {
    const chunks = []; let size = 0, over = false;
    req.on('data', (c) => { size += c.length; if (size > limit) over = true; else chunks.push(c); });
    req.on('end', () => ok(over ? null : Buffer.concat(chunks)));
    req.on('error', () => ok(null));
  });
}

// ---------- limitador de concurrencia (p. ej. no más de 2 ffmpeg a la vez) ----------
class Limiter {
  constructor(n) { this.n = n; this.active = 0; this.q = []; }
  run(fn) {
    return new Promise((ok, err) => { this.q.push({ fn, ok, err }); this._next(); });
  }
  _next() {
    while (this.active < this.n && this.q.length) {
      const { fn, ok, err } = this.q.shift();
      this.active++;
      Promise.resolve().then(fn).then(ok, err).finally(() => { this.active--; this._next(); });
    }
  }
}

// ejecuta un binario y junta la salida (con timeout para que nada quede colgado)
function run(bin, args, { timeout = 60000, env } = {}) {
  return new Promise((ok) => {
    let out = [], err = [];
    let p;
    try { p = spawn(bin, args, { windowsHide: true, env: env || { ...process.env, PYTHONIOENCODING: 'utf-8' } }); }
    catch (e) { return ok({ code: -1, out: '', err: String(e) }); }
    const t = setTimeout(() => { try { p.kill(); } catch {} }, timeout);
    p.stdout.on('data', (c) => out.push(c));
    p.stderr.on('data', (c) => err.push(c));
    p.on('error', (e) => { clearTimeout(t); ok({ code: -1, out: '', err: String(e) }); });
    p.on('close', (code) => {
      clearTimeout(t);
      ok({ code, out: Buffer.concat(out).toString('utf8'), err: Buffer.concat(err).toString('utf8') });
    });
  });
}

// mata un proceso y sus hijos (yt-dlp → ffmpeg)
function killTree(proc) {
  if (!proc || proc.exitCode !== null) return;
  if (IS_WIN) spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { windowsHide: true });
  else proc.kill('SIGTERM');
}

// ---------- texto ----------
// normaliza para comparar títulos: sin acentos, sin "(Official Video)", sin signos
function normalize(s) {
  return String(s || '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\((official|lyric|lyrics|audio|video|visualizer|music video|hd|hq|4k)[^)]*\)|\[(official|lyric|lyrics|audio|video|visualizer|hd|hq|4k)[^\]]*\]/g, '')
    .replace(/\b(official (music )?video|lyrics?|audio oficial|video oficial)\b/g, '')
    .replace(/[^a-z0-9぀-ヿ一-鿿가-힯]+/g, ' ')
    .trim();
}

// ---------- formatos ----------
const AUDIO_EXT = new Set(['.mp3', '.flac', '.wav', '.ogg', '.oga', '.opus', '.m4a', '.aac', '.weba']);
const VIDEO_EXT = new Set(['.mp4', '.webm', '.m4v']);
const MIME = {
  '.mp3': 'audio/mpeg', '.flac': 'audio/flac', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.oga': 'audio/ogg',
  '.opus': 'audio/ogg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.weba': 'audio/webm',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.m4v': 'video/mp4',
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

// sirve un archivo con soporte de Range correcto (incluye "bytes=-N" y rangos inválidos → 416)
function serveRange(req, res, file, type) {
  let st;
  try { st = fs.statSync(file); } catch { res.writeHead(404); return res.end(); }
  const size = st.size;
  const range = req.headers.range;
  const base = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' };
  if (!range) {
    res.writeHead(200, { ...base, 'Content-Length': size });
    return fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
  }
  const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  let start, end;
  if (m && m[1] === '' && m[2] !== '') { start = Math.max(0, size - +m[2]); end = size - 1; }  // sufijo: últimos N bytes
  else if (m) { start = m[1] ? +m[1] : 0; end = m[2] ? Math.min(+m[2], size - 1) : size - 1; }
  if (!m || start > end || start >= size) {
    res.writeHead(416, { 'Content-Range': `bytes */${size}` });
    return res.end();
  }
  res.writeHead(206, { ...base, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
  fs.createReadStream(file, { start, end }).on('error', () => res.destroy()).pipe(res);
}

// guardado JSON atómico y con "debounce" (no escribe al disco en cada cambio)
class JsonStore {
  constructor(file, def) {
    this.file = file;
    try { this.data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { this.data = def(); }
    this.t = null;
  }
  save(now = false) {
    clearTimeout(this.t);
    const write = () => {
      try {
        const tmp = this.file + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(this.data));
        fs.renameSync(tmp, this.file);
      } catch (e) { console.error('no pude guardar', this.file, e.message); }
    };
    if (now) write(); else this.t = setTimeout(write, 700);
  }
}

function openInExplorer(target, select) {
  try {
    if (IS_WIN) spawn('explorer', select ? ['/select,', target] : [target], { detached: true, stdio: 'ignore' }).unref();
    else spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [select ? path.dirname(target) : target], { detached: true, stdio: 'ignore' }).unref();
  } catch {}
}

module.exports = {
  IS_WIN, findBin, sha, json, readBody, readRaw, Limiter, run, killTree, normalize,
  AUDIO_EXT, VIDEO_EXT, MIME, serveRange, YT_JS, JsonStore, openInExplorer,
};
