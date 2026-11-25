// streaming de YouTube Music sin descargar: yt-dlp resuelve la URL de audio (con la sesión del usuario, así
// Premium da AAC 256 kbps) y el servidor local la reenvía con soporte de Range. Pasar por 127.0.0.1 hace que
// la interfaz pueda aplicar ecualizador, volumen y visualizador (mismo origen). Solo si YouTube rechaza el enlace
// directo, la canción se guarda en una caché chica (data/stream-cache, máx. 400 MB).
'use strict';
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const { run, YT_JS, serveRange } = require('./util');
const { YTM } = require('./ytm');

// si YouTube rechaza el enlace directo (403) aunque se vuelva a pedir, la canción se baja entera con yt-dlp
// (que sí puede) a una caché chica y se sirve desde el disco, con Range para poder adelantar
const CACHE_MAX = 400 * 1024 * 1024;

class Streamer {
  constructor({ ytdlp, cookiesTxt, dataDir }) {
    Object.assign(this, { ytdlp, cookiesTxt });
    this.cache = new Map();      // videoId → { url, exp, mime }
    this.pending = new Map();
    this.thumbs = new Map();     // videoId → URL de portada (de las listas de ytmusicapi)
    this.coverDir = path.join(dataDir, 'covers');
    this.fileDir = path.join(dataDir, 'stream-cache');
    this.dl = new Map();
    // yt-dlp ya cargado en memoria (src/resolve_bridge.py): ~1 s por canción en vez de ~4
    this.fast = new YTM({ root: path.join(__dirname, '..'), cookiesTxt, script: 'resolve_bridge.py', need: 'yt_dlp', args: [process.execPath] });
    this.fastOff = false;
  }

  cachedFile(id) { for (const ext of ['m4a', 'webm', 'mp4']) { const f = path.join(this.fileDir, `${id}.${ext}`); if (fs.existsSync(f)) return f; } return null; }
  async fileFallback(id) {
    const have = this.cachedFile(id);
    if (have) { try { const now = new Date(); fs.utimesSync(have, now, now); } catch {} return have; }
    if (this.dl.has(id)) return this.dl.get(id);
    const job = (async () => {
      fs.mkdirSync(this.fileDir, { recursive: true });
      const args = ['-f', 'bestaudio[ext=m4a]/bestaudio/best[acodec!=none]', '-o', path.join(this.fileDir, `${id}.%(ext)s`), '--no-part', '--no-playlist', '--no-warnings', '--fixup', 'never', '--no-mtime'];
      if (fs.existsSync(this.cookiesTxt)) args.push('--cookies', this.cookiesTxt);
      args.push('--', `https://music.youtube.com/watch?v=${id}`);
      const r = await run(this.ytdlp, [...YT_JS, ...args], { timeout: 180000 });
      const f = this.cachedFile(id);
      if (!f) throw new Error((r.err.split('\n').find((l) => l.startsWith('ERROR')) || 'YouTube no entregó el audio').replace(/^ERROR:\s*/, '').slice(0, 200));
      this.prune();
      return f;
    })().finally(() => this.dl.delete(id));
    this.dl.set(id, job);
    return job;
  }
  // la caché no pasa de 400 MB: se borran las que hace más que no suenan
  prune() {
    try {
      const fl = fs.readdirSync(this.fileDir).map((n) => { const p = path.join(this.fileDir, n); const s = fs.statSync(p); return { p, size: s.size, t: s.mtimeMs }; }).sort((a, b) => a.t - b.t);
      let total = fl.reduce((a, b) => a + b.size, 0);
      for (const f of fl) { if (total <= CACHE_MAX) break; try { fs.unlinkSync(f.p); total -= f.size; } catch {} }
    } catch {}
  }

  async resolve(id, force) {
    const c = this.cache.get(id);
    if (!force && c && c.exp - Date.now() > 10 * 60e3) return c;
    if (this.pending.has(id)) return this.pending.get(id);
    const job = (async () => {
      let url = await this.resolveFast(id);
      if (url) return this.remember(id, url);
      if (!this.ytdlp) throw new Error('yt-dlp no encontrado');
      // con sesión (Premium = AAC 256k) si hay; si la sesión falla o no hay, sin cookies y después con otros clientes
      const tries = fs.existsSync(this.cookiesTxt) ? ['cookies', 'plain', 'alt'] : ['plain', 'alt'];
      let r;
      for (const mode of tries) {
        // si YouTube no entrega formatos de solo audio (pasa sin sesión), usar el mp4 combinado (#18)
        const args = ['-f', 'bestaudio[format_id=141]/bestaudio[ext=m4a]/bestaudio/best[acodec!=none]/best', '--get-url', '--no-playlist', '--no-warnings', '--encoding', 'utf-8'];
        if (mode === 'cookies') args.push('--cookies', this.cookiesTxt);
        if (mode === 'alt') args.push('--extractor-args', 'youtube:player_client=tv,mweb,web_safari');
        args.push('--', `https://music.youtube.com/watch?v=${id}`);
        r = await run(this.ytdlp, [...YT_JS, ...args], { timeout: 45000 });
        url = r.out.split(/\r?\n/).map((l) => l.trim()).find((l) => /^https?:\/\//.test(l));
        if (url || /Video unavailable|Private video|removed/i.test(r.err)) break;
      }
      if (!url) {
        const err = (r.err.split('\n').find((l) => l.startsWith('ERROR')) || 'no se pudo obtener el audio').replace(/^ERROR:\s*(\[[^\]]+\]\s*)?/, '');
        throw new Error(err.slice(0, 300));
      }
      return this.remember(id, url);
    })().finally(() => this.pending.delete(id));
    this.pending.set(id, job);
    return job;
  }

  remember(id, url) {
    const u = new URL(url);
    const exp = (+u.searchParams.get('expire') || 0) * 1000 || Date.now() + 5 * 3600e3;
    const mime = decodeURIComponent(u.searchParams.get('mime') || 'audio/mp4');
    const info = { url, exp, mime, itag: u.searchParams.get('itag'), at: Date.now() };
    this.cache.set(id, info);
    if (this.cache.size > 400) this.cache.delete(this.cache.keys().next().value);
    return info;
  }

  // con el proceso de yt-dlp en memoria (mismos modos que yt-dlp.exe); null si no está o no pudo
  async resolveFast(id) {
    if (this.fastOff || !this.fast.available()) return null;
    // si no se escucha nada online por 15 minutos, se cierra (libera ~60 MB de RAM); vuelve solo cuando haga falta
    clearTimeout(this.fastIdle);
    this.fastIdle = setTimeout(() => this.fast.stop(), 15 * 60e3);
    if (this.fastIdle.unref) this.fastIdle.unref();
    const tries = fs.existsSync(this.cookiesTxt) ? ['cookies', 'plain', 'alt'] : ['plain', 'alt'];
    for (const mode of tries) {
      try {
        const r = await this.fast.call('resolve', { id, mode }, { timeout: 30000 });
        if (r && /^https?:\/\//.test(r.url || '')) return r.url;
      } catch (e) {
        if (/Video unavailable|Private video|removed/i.test(e.message)) throw e;
        // el proceso no arrancó (p. ej. falta algo de Python): no insistir, queda yt-dlp.exe
        if (/se cerró|no está instalado/.test(e.message)) { this.fastOff = true; return null; }
      }
    }
    return null;
  }

  // reenvía el audio respetando Range (el reproductor pide pedazos al adelantar/retroceder)
  async proxy(req, res, id, retry = true) {
    // ya está en la caché (porque YouTube rechazó el enlace antes): desde el disco
    const local = this.cachedFile(id);
    if (local) return serveRange(req, res, local, local.endsWith('.webm') ? 'audio/webm' : 'audio/mp4');
    let info;
    try { info = await this.resolve(id); }
    catch (e) { res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end(e.message); }
    const ctl = new AbortController();
    req.on('close', () => ctl.abort());
    let r;
    try {
      r = await fetch(info.url, { headers: { Range: req.headers.range || 'bytes=0-', 'User-Agent': 'Mozilla/5.0' }, signal: ctl.signal });
    } catch (e) { if (!res.headersSent) { res.writeHead(502); res.end(); } return; }
    // recién resuelta y YouTube igual la rechaza: no tiene sentido volver a pedirla, directo a bajarla
    if ((r.status === 403 || r.status === 410) && retry && Date.now() - (info.at || 0) < 90e3) retry = false;
    if ((r.status === 403 || r.status === 410) && retry) {        // URL vencida: resolver de nuevo una vez
      try { r.body && r.body.cancel(); } catch {}
      this.cache.delete(id);
      try { await this.resolve(id, true); } catch {}
      return this.proxy(req, res, id, false);
    }
    if (r.status === 403 || r.status === 410) {                    // YouTube sigue rechazando el enlace: bajarla con yt-dlp
      try { r.body && r.body.cancel(); } catch {}
      try { const f = await this.fileFallback(id); return serveRange(req, res, f, f.endsWith('.webm') ? 'audio/webm' : 'audio/mp4'); }
      catch (e) { if (!res.headersSent) { res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end(e.message); } return; }
    }
    const h = { 'Content-Type': info.mime.split(';')[0], 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' };
    for (const k of ['content-length', 'content-range']) { const v = r.headers.get(k); if (v) h[k.replace(/(^|-)\w/g, (s) => s.toUpperCase())] = v; }
    res.writeHead(r.status === 200 || r.status === 206 ? r.status : 502, h);
    if (!r.body) return res.end();
    Readable.fromWeb(r.body).on('error', () => res.destroy()).pipe(res);
  }

  // preparar la siguiente: resolver y, si YouTube rechaza el enlace, bajarla ya (así cuando le toque suena enseguida)
  async warm(id) {
    if (this.cachedFile(id)) return { ok: true, cached: true };
    const info = await this.resolve(id);
    try {
      const r = await fetch(info.url, { headers: { Range: 'bytes=0-0', 'User-Agent': 'Mozilla/5.0' } });
      try { r.body && r.body.cancel(); } catch {}
      if (r.status === 403 || r.status === 410) { await this.fileFallback(id); return { ok: true, cached: true }; }
    } catch {}
    return { ok: true };
  }

  // portada: la de la lista de ytmusicapi si la conocemos; si no, la miniatura del video. Se cachea en disco.
  // baja (una vez) la portada de YouTube y devuelve la ruta en disco, o null
  async coverFile(id) {
    const file = path.join(this.coverDir, 'yt_' + id + '.jpg');
    if (fs.existsSync(file)) return file;
    const urls = [this.thumbs.get(id), `https://i.ytimg.com/vi/${id}/hqdefault.jpg`].filter(Boolean);
    for (const u of urls) {
      try {
        const host = new URL(u).hostname;
        if (!/(^|\.)(googleusercontent\.com|ytimg\.com|ggpht\.com)$/.test(host)) continue;
        const r = await fetch(u);
        if (!r.ok) continue;
        fs.mkdirSync(this.coverDir, { recursive: true });
        fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
        return file;
      } catch {}
    }
    return null;
  }
  async cover(req, res, id) {
    const file = await this.coverFile(id);
    if (!file) { res.writeHead(404, { 'Cache-Control': 'max-age=300' }); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'max-age=86400' }); fs.createReadStream(file).pipe(res);
  }
}

module.exports = { Streamer };
