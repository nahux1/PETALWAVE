// streaming de YouTube Music sin descargar: yt-dlp resuelve la URL de audio (con la sesión del usuario, así
// Premium da AAC 256 kbps) y el servidor local la reenvía con soporte de Range. Pasar por 127.0.0.1 hace que
// la interfaz pueda aplicar ecualizador, volumen y visualizador (mismo origen). No se guarda nada en disco.
'use strict';
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const { run, YT_JS } = require('./util');

class Streamer {
  constructor({ ytdlp, cookiesTxt, dataDir }) {
    Object.assign(this, { ytdlp, cookiesTxt });
    this.cache = new Map();      // videoId → { url, exp, mime }
    this.pending = new Map();
    this.thumbs = new Map();     // videoId → URL de portada (de las listas de ytmusicapi)
    this.coverDir = path.join(dataDir, 'covers');
  }

  async resolve(id, force) {
    const c = this.cache.get(id);
    if (!force && c && c.exp - Date.now() > 10 * 60e3) return c;
    if (this.pending.has(id)) return this.pending.get(id);
    const job = (async () => {
      if (!this.ytdlp) throw new Error('yt-dlp no encontrado');
      // con sesión (Premium = AAC 256k) si hay; si la sesión falla o no hay, sin cookies y después con otros clientes
      const tries = fs.existsSync(this.cookiesTxt) ? ['cookies', 'plain', 'alt'] : ['plain', 'alt'];
      let r, url;
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
      const u = new URL(url);
      const exp = (+u.searchParams.get('expire') || 0) * 1000 || Date.now() + 5 * 3600e3;
      const mime = decodeURIComponent(u.searchParams.get('mime') || 'audio/mp4');
      const info = { url, exp, mime, itag: u.searchParams.get('itag') };
      this.cache.set(id, info);
      if (this.cache.size > 400) this.cache.delete(this.cache.keys().next().value);
      return info;
    })().finally(() => this.pending.delete(id));
    this.pending.set(id, job);
    return job;
  }

  // reenvía el audio respetando Range (el reproductor pide pedazos al adelantar/retroceder)
  async proxy(req, res, id, retry = true) {
    let info;
    try { info = await this.resolve(id); }
    catch (e) { res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end(e.message); }
    const ctl = new AbortController();
    req.on('close', () => ctl.abort());
    let r;
    try {
      r = await fetch(info.url, { headers: { Range: req.headers.range || 'bytes=0-', 'User-Agent': 'Mozilla/5.0' }, signal: ctl.signal });
    } catch (e) { if (!res.headersSent) { res.writeHead(502); res.end(); } return; }
    if ((r.status === 403 || r.status === 410) && retry) {        // URL vencida: resolver de nuevo una vez
      try { r.body && r.body.cancel(); } catch {}
      this.cache.delete(id);
      try { await this.resolve(id, true); } catch {}
      return this.proxy(req, res, id, false);
    }
    const h = { 'Content-Type': info.mime.split(';')[0], 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' };
    for (const k of ['content-length', 'content-range']) { const v = r.headers.get(k); if (v) h[k.replace(/(^|-)\w/g, (s) => s.toUpperCase())] = v; }
    res.writeHead(r.status === 200 || r.status === 206 ? r.status : 502, h);
    if (!r.body) return res.end();
    Readable.fromWeb(r.body).on('error', () => res.destroy()).pipe(res);
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
