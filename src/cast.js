// radios en vivo y podcasts:
// - /cast/<clave>: el audio (o la imagen) de una radio o un capítulo, pasado por el servidor local. La interfaz registra antes
//   qué dirección corresponde a cada clave (así no es un "proxy abierto": solo sirve lo que registró Petalwave).
//   Si el capítulo está guardado (data/podcasts), se sirve del disco: suena sin internet.
// - leer feeds de podcasts y la lista de radios (Radio Browser / Apple Podcasts) sin problemas de CORS
// - el tema que suena en una radio (metadatos ICY)
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { JsonStore, serveRange } = require('./util');

const PRIVATE = /^(localhost$|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.|\[?::1\]?$|\[?f[cd][0-9a-f]{2}:)/i;
const KEY = /^[a-z0-9]{6,24}$/;
const EXT = { 'audio/mpeg': '.mp3', 'audio/mp3': '.mp3', 'audio/mp4': '.m4a', 'audio/x-m4a': '.m4a', 'audio/aac': '.aac', 'audio/aacp': '.aac', 'audio/ogg': '.ogg', 'audio/opus': '.opus', 'audio/webm': '.weba', 'video/mp4': '.m4a' };
const MIME = { '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.opus': 'audio/ogg', '.weba': 'audio/webm' };

function okUrl(u) {
  try { const x = new URL(String(u)); return /^https?:$/.test(x.protocol) && x.hostname && !PRIVATE.test(x.hostname) ? x : null; } catch { return null; }
}
// GET siguiendo redirecciones (hasta 6)
function get(url, headers = {}, hops = 0, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const x = okUrl(url);
    if (!x) return reject(new Error('dirección no permitida'));
    const mod = x.protocol === 'https:' ? https : http;
    const req = mod.get(x, { headers: { 'User-Agent': 'Mozilla/5.0 (Petalwave)', Accept: '*/*', ...headers }, timeout }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && hops < 6) {
        res.resume();
        return resolve(get(new URL(res.headers.location, x).href, headers, hops + 1, timeout));
      }
      resolve(res);
    });
    req.on('timeout', () => req.destroy(new Error('la radio o el podcast no contesta')));
    req.on('error', reject);
  });
}

class Cast {
  constructor({ dataDir, broadcast }) {
    this.store = new JsonStore(path.join(dataDir, 'cast.json'), () => ({ urls: {} }));
    if (!this.store.data.urls) this.store.data.urls = {};
    this.dir = path.join(dataDir, 'podcasts');
    fs.mkdirSync(this.dir, { recursive: true });
    this.broadcast = broadcast || (() => {});
    this.queue = [];
    this.busy = false;
    // restos de descargas cortadas
    for (const f of fs.readdirSync(this.dir)) if (f.endsWith('.part')) try { fs.unlinkSync(path.join(this.dir, f)); } catch {}
  }

  reg(items) {
    const urls = this.store.data.urls;
    let n = 0;
    for (const it of [].concat(items || []).slice(0, 500)) {
      if (!it || !KEY.test(String(it.key)) || !okUrl(it.url)) continue;
      if (urls[it.key] !== it.url) { delete urls[it.key]; urls[it.key] = String(it.url); }
      n++;
    }
    const keys = Object.keys(urls);
    if (keys.length > 4000) for (const k of keys.slice(0, keys.length - 4000)) if (!this.file(k)) delete urls[k];
    this.store.save();
    return n;
  }
  file(key) {
    if (!KEY.test(key)) return null;
    for (const e of Object.keys(MIME)) { const f = path.join(this.dir, key + e); if (fs.existsSync(f)) return f; }
    return null;
  }

  async serve(req, res, key) {
    const f = this.file(key);
    if (f) return serveRange(req, res, f, MIME[path.extname(f)] || 'audio/mpeg');
    const url = this.store.data.urls[key];
    if (!url) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('no registrado'); }
    let up;
    try { up = await get(url, req.headers.range ? { Range: req.headers.range } : {}); }
    catch (e) { res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end(e.message); }
    const h = { 'Cache-Control': key.endsWith('i') ? 'max-age=86400' : 'no-store' };
    let type = String(up.headers['content-type'] || '').split(';')[0].trim();
    if (type === 'audio/aacp' || type === 'audio/x-aac') type = 'audio/aac';
    if (type) h['Content-Type'] = type;
    for (const k of ['content-length', 'content-range', 'accept-ranges']) if (up.headers[k]) h[k] = up.headers[k];
    res.writeHead(up.statusCode, h);
    up.pipe(res);
    up.on('error', () => res.destroy());
    req.on('close', () => up.destroy());
  }

  // texto de una dirección (feed RSS, lista de radios en JSON): hasta 8 MB
  async fetchText(url) {
    const r = await get(url, { Accept: 'application/json, application/rss+xml, application/xml, text/xml, */*' }, 0, 25000);
    if (r.statusCode < 200 || r.statusCode >= 300) { r.resume(); throw new Error('HTTP ' + r.statusCode); }
    const chunks = []; let size = 0;
    await new Promise((ok, no) => {
      r.on('data', (c) => { size += c.length; if (size > 8e6) { r.destroy(); no(new Error('respuesta muy grande')); } else chunks.push(c); });
      r.on('end', ok); r.on('error', no);
    });
    const buf = Buffer.concat(chunks);
    let cs = (/charset=([\w-]+)/i.exec(r.headers['content-type'] || '') || [])[1];
    if (!cs) cs = (/^<\?xml[^>]*encoding=["']([\w-]+)/i.exec(buf.slice(0, 200).toString('latin1')) || [])[1];
    try { return new TextDecoder(cs || 'utf-8').decode(buf); } catch { return buf.toString('utf8'); }
  }

  // tema que suena en una radio: StreamTitle de los metadatos ICY
  meta(key) {
    const url = this.store.data.urls[key];
    if (!url) return Promise.resolve({});
    return new Promise((ok) => {
      let done = false, up = null;
      const fin = (v) => { if (done) return; done = true; clearTimeout(to); try { up && up.destroy(); } catch {} ok(v); };
      const to = setTimeout(() => fin({}), 9000);
      get(url, { 'Icy-MetaData': '1' }, 0, 9000).then((r) => {
        up = r;
        const every = +r.headers['icy-metaint'];
        const name = r.headers['icy-name'] ? String(r.headers['icy-name']) : '';
        if (!every || every > 512e3) return fin({ name });
        let buf = Buffer.alloc(0);
        r.on('data', (c) => {
          buf = Buffer.concat([buf, c]);
          if (buf.length <= every) return;
          const len = buf[every] * 16;
          if (!len) return fin({ name, title: '' });
          if (buf.length < every + 1 + len) return;
          const raw = buf.slice(every + 1, every + 1 + len);
          let s = raw.toString('utf8');
          if (s.includes('�')) s = raw.toString('latin1');
          const m = /StreamTitle='(.*?)';/s.exec(s);
          fin({ name, title: m ? m[1].trim() : '' });
        });
        r.on('error', () => fin({ name }));
        r.on('end', () => fin({ name }));
      }).catch(() => fin({}));
    });
  }

  // ---------- capítulos guardados para escuchar sin internet ----------
  saved() {
    const keys = []; let bytes = 0;
    for (const f of fs.readdirSync(this.dir)) {
      const e = path.extname(f);
      if (!MIME[e]) continue;
      keys.push(path.basename(f, e));
      try { bytes += fs.statSync(path.join(this.dir, f)).size; } catch {}
    }
    return { keys, bytes, saving: this.queue.length + (this.busy ? 1 : 0), current: this.cur || null };
  }
  save(keys) {
    let n = 0;
    for (const k of keys) {
      if (!KEY.test(k) || this.file(k) || this.queue.includes(k) || this.cur === k || !this.store.data.urls[k]) continue;
      this.queue.push(k); n++;
    }
    this.pump();
    return n;
  }
  remove(keys, all) {
    this.queue = all ? [] : this.queue.filter((k) => !keys.includes(k));
    for (const f of fs.readdirSync(this.dir)) {
      const k = path.basename(f, path.extname(f));
      if (all || keys.includes(k)) try { fs.unlinkSync(path.join(this.dir, f)); } catch {}
    }
    this.broadcast('cast', this.saved());
  }
  async pump() {
    if (this.busy) return;
    const key = this.queue.shift();
    if (!key) return;
    this.busy = true; this.cur = key;
    const tmp = path.join(this.dir, key + '.part');
    try {
      const r = await get(this.store.data.urls[key], {}, 0, 30000);
      if (r.statusCode !== 200) { r.resume(); throw new Error('HTTP ' + r.statusCode); }
      const type = String(r.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      let ext = EXT[type] || (/\.(mp3|m4a|aac|ogg|opus)(\?|$)/i.exec(this.store.data.urls[key]) || [])[1];
      ext = ext ? (ext.startsWith('.') ? ext : '.' + ext.toLowerCase()) : '.mp3';
      await new Promise((ok, no) => {
        const w = fs.createWriteStream(tmp);
        let size = 0;
        r.on('data', (c) => { size += c.length; if (size > 900e6) { r.destroy(new Error('el capítulo es muy grande')); } });
        r.on('error', no); w.on('error', no); w.on('finish', ok);
        r.pipe(w);
      });
      fs.renameSync(tmp, path.join(this.dir, key + ext));
    } catch (e) {
      try { fs.unlinkSync(tmp); } catch {}
      this.broadcast('cast', { ...this.saved(), error: e.message, key });
    }
    this.busy = false; this.cur = null;
    this.broadcast('cast', this.saved());
    this.pump();
  }
}

module.exports = { Cast, okUrl };
