// Discord: "Escuchando <canción>" en tu perfil (Rich Presence por la conexión local de Discord, sin cuenta ni contraseña).
// Habla con la app de Discord abierta en esta PC por su canal local (\\?\pipe\discord-ipc-N). Si Discord no está
// abierto, no hace nada y vuelve a intentar cada 20 s mientras haya algo sonando.
'use strict';
const net = require('net');

const PIPE = (n) => (process.platform === 'win32' ? `\\\\?\\pipe\\discord-ipc-${n}` : `${process.env.XDG_RUNTIME_DIR || process.env.TMPDIR || '/tmp'}/discord-ipc-${n}`);

class Discord {
  constructor() {
    this.sock = null; this.ready = false; this.clientId = ''; this.want = null; this.buf = Buffer.alloc(0);
    this.retry = null; this.user = null; this.nonce = 0;
  }
  status() { return { connected: this.ready, user: this.user, clientId: this.clientId }; }

  configure(clientId) {
    const id = /^\d{15,22}$/.test(String(clientId || '')) ? String(clientId) : '';
    if (id === this.clientId) return;
    this.clientId = id;
    this.close();
    if (id && this.want) this.connect();
  }

  // activity: { title, artist, album, cover, start, end, paused } | null para borrar
  set(activity) {
    this.want = activity || null;
    if (!this.clientId) return;
    if (this.ready) return this.send();
    if (activity) this.connect();
  }

  close() {
    clearTimeout(this.retry); this.retry = null;
    if (this.sock) { try { this.sock.destroy(); } catch {} }
    this.sock = null; this.ready = false; this.user = null;
  }

  connect(n = 0) {
    if (this.sock || !this.clientId) return;
    if (n > 9) { this.later(); return; }
    const s = net.createConnection(PIPE(n));
    let opened = false;
    s.once('connect', () => {
      opened = true; this.sock = s; this.buf = Buffer.alloc(0);
      this.write(0, { v: 1, client_id: this.clientId });
    });
    s.on('data', (d) => this.onData(d));
    s.on('error', () => { if (!opened) { s.destroy(); this.connect(n + 1); } });
    s.on('close', () => { if (opened) { this.sock = null; this.ready = false; this.user = null; this.later(); } });
  }
  later() {
    clearTimeout(this.retry);
    if (!this.want || !this.clientId) return;
    this.retry = setTimeout(() => this.connect(), 20000);
    if (this.retry.unref) this.retry.unref();
  }

  write(op, obj) {
    if (!this.sock) return;
    const body = Buffer.from(JSON.stringify(obj), 'utf8');
    const h = Buffer.alloc(8); h.writeInt32LE(op, 0); h.writeInt32LE(body.length, 4);
    try { this.sock.write(Buffer.concat([h, body])); } catch {}
  }
  onData(d) {
    this.buf = Buffer.concat([this.buf, d]);
    while (this.buf.length >= 8) {
      const op = this.buf.readInt32LE(0), len = this.buf.readInt32LE(4);
      if (this.buf.length < 8 + len) break;
      let msg = {}; try { msg = JSON.parse(this.buf.slice(8, 8 + len).toString('utf8')); } catch {}
      this.buf = this.buf.slice(8 + len);
      if (op === 2) { this.close(); return; }                         // Discord cerró (ID de aplicación inválido, etc.)
      if (op === 3) { this.write(4, msg); continue; }                  // ping → pong
      if (msg.evt === 'READY') { this.ready = true; this.user = msg.data && msg.data.user ? msg.data.user.username : null; this.send(); }
      if (msg.evt === 'ERROR') this.lastError = msg.data && msg.data.message;
    }
  }

  send() {
    const a = this.want;
    let activity = null;
    if (a && a.title) {
      const cut = (s, n = 120) => { s = String(s || '').trim(); return s.length < 2 ? (s + '  ').slice(0, 2) : s.slice(0, n); };
      activity = {
        type: 2,   // "Escuchando"
        details: cut(a.title),
        state: cut(a.artist ? a.artist : 'Petalwave'),
        assets: {
          large_image: /^https:\/\//.test(a.cover || '') ? a.cover : 'https://nahux1.github.io/PETALWAVE/icono.png',
          large_text: cut(a.album || a.title),
          small_image: a.paused ? undefined : 'https://nahux1.github.io/PETALWAVE/icono.png',
          small_text: a.paused ? undefined : 'Petalwave',
        },
        buttons: [{ label: 'Petalwave', url: 'https://nahux1.github.io/PETALWAVE/' }],
      };
      if (a.paused) activity.state = cut('⏸ ' + (a.artist || 'en pausa'));
      else if (a.start && a.end) activity.timestamps = { start: Math.round(a.start), end: Math.round(a.end) };
      if (a.ytId) activity.buttons.unshift({ label: 'Escuchar en YouTube Music', url: `https://music.youtube.com/watch?v=${a.ytId}` });
    }
    this.write(1, { cmd: 'SET_ACTIVITY', args: { pid: process.pid, activity }, nonce: String(++this.nonce) });
  }
}

module.exports = { Discord };
