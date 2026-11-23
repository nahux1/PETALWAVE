// motor nativo de Android (beta): la música suena con ExoPlayer (Media3) en un servicio de Android, no en la WebView.
// Tiene los mismos métodos que el motor de siempre (audio.js), así el resto de la interfaz no cambia.
// Al servicio se le manda la canción actual con las de antes y después: si Android duerme la interfaz, sigue sola.
import { bus, debounce } from './core.js';

const nat = window.PetalwaveNative;
const WIN_BACK = 20, WIN_AHEAD = 80;   // canciones de la cola que conoce el servicio

export class NativeEngine {
  constructor() {
    this.native = true;
    this.track = null;
    this.active = null;
    this.crossfade = 0; this.smart = false; this.autoLevel = false;
    this.queueOf = () => ({ queue: [], qi: -1, repeat: 'off', T: () => null });   // lo completa player.js
    this.st = { id: '', playing: false, want: false, buffering: false, ended: false, pos: 0, dur: 0, buf: 0, at: performance.now() };
    this.lastState = '';
    this.sentIds = '';
    this.volume = 1;
    // lo que usa el visualizador (sin Web Audio: datos del visualizador de Android)
    this.ctx = { sampleRate: 44100, currentTime: 0, state: 'running', resume: async () => {} };
    this.master = { gain: { value: 1, setTargetAtTime: (v) => this.cmd('vol:' + Math.max(0, Math.min(1, v)).toFixed(3)), cancelScheduledValues() {} } };
    this.fft = new Uint8Array(128); this.fftAt = 0;
    const eng = this;
    this.analyser = {
      frequencyBinCount: 1024, fftSize: 2048,
      getByteFrequencyData(arr) { eng.pullFft(); const n = arr.length; for (let i = 0; i < n; i++) arr[i] = eng.fft[Math.min(127, Math.floor((i * 128) / n))]; },
      getFloatTimeDomainData(arr) { eng.pullFft(); const e = eng.energy(); const t = performance.now() / 1000; for (let i = 0; i < arr.length; i++) arr[i] = Math.sin(t * 40 + i * 0.09) * e * 0.6; },
    };
    const side = { fftSize: 512, getFloatTimeDomainData(arr) { const e = eng.energy(); for (let i = 0; i < arr.length; i++) arr[i] = (i % 2 ? 1 : -1) * e * 0.5; } };
    this.aL = side; this.aR = side;
    bus.on('host:nstate', (j) => this.onState(j));
    bus.on('queue', debounce(() => this.syncQueue(), 250));
  }
  init() {}
  cmd(c) { try { nat.nCmd(c); } catch {} }

  // ventana de la cola alrededor de la canción actual, con los datos que necesita el servicio
  windowOf() {
    const { queue, qi, T } = this.queueOf();
    const from = Math.max(0, qi - WIN_BACK), to = Math.min(queue.length, qi + WIN_AHEAD + 1);
    const items = [];
    for (let i = from; i < to; i++) { const t = T(queue[i]); if (t) items.push({ id: t.id, ytId: t.ytId || '', title: t.title || '', artist: t.artist || '', album: t.album || '' }); }
    const cur = T(queue[qi]);
    return { items, index: Math.max(0, items.findIndex((x) => cur && x.id === cur.id)) };
  }

  async load(track, { autoplay = true, startAt = 0 } = {}) {
    this.track = track; this.active = { el: null };
    const w = this.windowOf();
    this.sentIds = w.items.map((x) => x.id).join(',');
    Object.assign(this.st, { id: track.id, pos: startAt || 0, dur: track.duration || 0, playing: false, want: autoplay, ended: false, at: performance.now() });
    try { nat.nPlay(JSON.stringify({ ...w, startAt: startAt || 0, autoplay })); } catch (e) { bus.emit('eng:error', e.message); return; }
    this.cmd('repeat:' + (this.queueOf().repeat === 'one' ? 'one' : 'off'));
    bus.emit('eng:track', track);
    bus.emit('eng:state', autoplay ? 'wait' : 'pause');
  }
  // la cola cambió en la interfaz: el servicio se actualiza sin cortar la canción que suena
  syncQueue() {
    if (!this.track) return;
    const w = this.windowOf();
    const ids = w.items.map((x) => x.id).join(',');
    if (ids === this.sentIds) return;
    this.sentIds = ids;
    try { nat.nSync(JSON.stringify(w)); } catch {}
  }
  setRepeat(r) { this.cmd('repeat:' + (r === 'one' ? 'one' : 'off')); }

  async play() { if (!this.track) return false; this.st.want = true; this.cmd('play'); return true; }
  async pause() { this.st.want = false; this.st.pos = this.time; this.st.playing = false; this.st.at = performance.now(); this.cmd('pause'); bus.emit('eng:state', 'pause'); }
  toggle() { return this.paused ? this.play() : this.pause(); }
  stop() { this.cmd('stop'); this.track = null; this.active = null; bus.emit('eng:state', 'pause'); }
  async seek(t) {
    const d = this.duration;
    t = Math.max(0, d ? Math.min(d - 0.25, t) : t);
    this.st.pos = t; this.st.at = performance.now();
    this.cmd('seek:' + t.toFixed(2));
    bus.emit('eng:seek');
  }

  get paused() { return !this.st.want; }
  get time() { return this.st.playing ? this.st.pos + (performance.now() - this.st.at) / 1000 : this.st.pos; }
  get duration() { return this.st.dur || (this.track ? this.track.duration : 0) || 0; }
  get buffered() { return this.st.buf || 0; }

  // estado que manda el servicio (cada segundo mientras suena y en cada cambio)
  onState(json) {
    let j; try { j = JSON.parse(json); } catch { return; }
    const prevId = this.st.id, wasEnded = this.st.ended;
    Object.assign(this.st, j, { at: performance.now() });
    // el servicio pasó solo a la siguiente (o la eligieron desde la notificación / Android Auto)
    if (j.id && prevId && j.id !== prevId) bus.emit('eng:advance', j.id);
    const s = j.buffering && j.want ? 'wait' : j.playing ? 'play' : 'pause';
    if (s !== this.lastState) { this.lastState = s; bus.emit('eng:state', s); }
    if (j.dur && !this._metaFor) { this._metaFor = j.id; bus.emit('eng:meta'); }
    if (j.id !== this._metaFor) this._metaFor = null;
    if (j.ended && !wasEnded) bus.emit('eng:ended');
    if (j.err && j.err !== this._lastErr) { this._lastErr = j.err; bus.emit('eng:error', j.err); }
    if (!j.err) this._lastErr = '';
  }

  pullFft() {
    const now = performance.now(); if (now - this.fftAt < 40) return; this.fftAt = now;
    let csv = ''; try { csv = nat.nFft(); } catch {}
    if (!csv) { this.fft.fill(0); return; }
    const v = csv.split(','); for (let i = 0; i < 128; i++) this.fft[i] = +v[i] || 0;
  }
  energy() { let s = 0; for (let i = 0; i < 32; i++) s += this.fft[i]; return Math.min(1, s / 32 / 255 * 1.6); }

  // sonido
  setVolume(master, muted) { this.volume = muted ? 0 : Math.min(1, master); this.cmd('vol:' + this.volume.toFixed(3)); }
  setEq(eq) { try { nat.nEq(JSON.stringify({ on: eq.on !== false, bands: eq.bands || [], preamp: eq.preamp || 0, bass: eq.bass || 0, treble: eq.treble || 0 })); } catch {} }
  setSongDb() {} setNorm() {} setAutoLevel() {}
  level() { return 1; }

  // la cola que tiene el servicio (por ejemplo, si empezó a sonar desde Android Auto con la app cerrada)
  nativeQueue() { try { return JSON.parse(nat.nQueue() || '{}'); } catch { return {}; } }
}

export const nativeAvailable = () => !!(nat && nat.nPlay && nat.nativeOn && nat.nativeOn());
