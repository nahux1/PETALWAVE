// control remoto desde el celular: un servidor chico, aparte del principal (que sigue cerrado a la red), que escucha
// en la WiFi de tu casa. El celular abre http://<ip-de-la-PC>:3738 (escaneando el QR de ajustes) y maneja la música.
// Seguridad: sin la clave secreta del QR (128 bits) no se puede hacer nada; solo expone lo que suena y los botones.
'use strict';
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const CMDS = /^(toggle|play|pause|next|prev|like|shuffle|repeat|seek:\d+(\.\d+)?|vol:(0(\.\d+)?|1(\.0+)?)|jump:\d{1,4})$/;

class Remote {
  constructor({ port = 3738, mainPort, page, broadcast }) {
    Object.assign(this, { port, mainPort, page, broadcast });
    this.server = null; this.token = ''; this.state = { title: '' }; this.stateAt = 0; this.fails = new Map(); this.error = '';
  }

  // direcciones de esta PC en la red de tu casa (las que el celular puede abrir)
  urls() {
    const out = [];
    for (const list of Object.values(os.networkInterfaces())) {
      for (const a of list || []) {
        if (a.family !== 'IPv4' && a.family !== 4) continue;
        if (a.internal || !/^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address)) continue;
        out.push(`http://${a.address}:${this.port}/`);
      }
    }
    return out;
  }
  status() { return { on: !!this.server, port: this.port, urls: this.server ? this.urls() : [], token: this.server ? this.token : '', error: this.error }; }

  start(token) {
    this.token = token;
    if (this.server) return Promise.resolve(this.status());
    return new Promise((ok) => {
      const s = http.createServer((req, res) => this.handle(req, res).catch(() => { try { res.writeHead(500); res.end(); } catch {} }));
      s.on('error', (e) => { this.error = e.code === 'EADDRINUSE' ? `el puerto ${this.port} está ocupado` : e.message; this.server = null; ok(this.status()); });
      s.listen(this.port, '0.0.0.0', () => { this.server = s; this.error = ''; ok(this.status()); });
    });
  }
  stop() { if (this.server) { try { this.server.close(); } catch {} } this.server = null; }

  setState(st) { this.state = st || { title: '' }; this.stateAt = Date.now(); }

  ok(req) {
    const ip = req.socket.remoteAddress || '';
    const f = this.fails.get(ip) || { n: 0, at: 0 };
    if (f.n >= 10 && Date.now() - f.at < 10 * 60e3) return false;   // 10 claves mal: 10 minutos sin poder probar
    const got = String(req.headers['x-pw-key'] || '');
    const a = Buffer.from(got.padEnd(64).slice(0, 64)), b = Buffer.from(this.token.padEnd(64).slice(0, 64));
    const good = !!this.token && got.length === this.token.length && crypto.timingSafeEqual(a, b);
    if (!good) this.fails.set(ip, { n: f.n + 1, at: Date.now() });
    else this.fails.delete(ip);
    return good;
  }

  async handle(req, res) {
    const u = new URL(req.url, 'http://x');
    const sec = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY', 'Cache-Control': 'no-store' };
    const json = (code, o) => { res.writeHead(code, { ...sec, 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(o)); };
    if (req.method === 'GET' && (u.pathname === '/' || u.pathname === '/index.html')) {
      res.writeHead(200, { ...sec, 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" });
      return fs.createReadStream(this.page).pipe(res);
    }
    if (!u.pathname.startsWith('/r/')) { res.writeHead(404, sec); return res.end(); }
    if (!this.ok(req)) return json(401, { error: 'clave incorrecta: escaneá de nuevo el código de Petalwave' });
    if (req.method === 'GET' && u.pathname === '/r/state') {
      const st = { ...this.state };
      if (st.playing && st.pos != null) st.pos = Math.min(st.dur || Infinity, st.pos + (Date.now() - this.stateAt) / 1000);
      delete st.cover;
      return json(200, { ...st, age: Date.now() - this.stateAt });
    }
    if (req.method === 'POST' && u.pathname === '/r/cmd') {
      let body = '';
      for await (const c of req) { body += c; if (body.length > 2000) return json(413, {}); }
      let cmd = '';
      try { cmd = String(JSON.parse(body).cmd || ''); } catch {}
      if (!CMDS.test(cmd)) return json(400, { error: 'comando desconocido' });
      this.broadcast('remote', { cmd });
      return json(200, { ok: true });
    }
    if (req.method === 'GET' && u.pathname === '/r/cover') {
      const c = String(this.state.cover || '');
      if (!/^\/(cover\/[\w-]+|ytcover\/[\w-]{11})(\?s=\d+)?$/.test(c)) { res.writeHead(404, sec); return res.end(); }
      return http.get({ host: '127.0.0.1', port: this.mainPort, path: c }, (r) => {
        res.writeHead(r.statusCode, { ...sec, 'Content-Type': r.headers['content-type'] || 'image/jpeg' });
        r.pipe(res);
      }).on('error', () => { res.writeHead(502, sec); res.end(); });
    }
    res.writeHead(404, sec); res.end();
  }
}

module.exports = { Remote, newToken: () => crypto.randomBytes(16).toString('hex') };
