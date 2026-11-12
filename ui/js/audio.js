// motor de audio: 2 reproductores (para fundir canciones) + video, cadena EQ 10 bandas, normalizador y limitador.
// Cadena: deck(s) → mezcla → preamp → graves → 10 bandas → agudos → balance → [normalizar] → analizador → volumen → limitador → salida
import { bus, mediaUrl } from './core.js';

export const EQ_FREQS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
const dbToGain = (db) => Math.pow(10, db / 20);

class Engine {
  constructor() {
    this.ctx = null;
    this.decks = [];
    this.vdeck = null;
    this.active = null;
    this.track = null;
    this.songDb = 0;
    this.fadeToken = 0;
    this.nearEndFired = false;
    this.crossfade = 2;
  }

  init(videoEl) {
    if (this.ctx) return;
    const ctx = this.ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'playback' });
    this.mix = ctx.createGain();
    this.pre = ctx.createGain();
    this.bass = ctx.createBiquadFilter(); this.bass.type = 'lowshelf'; this.bass.frequency.value = 100;
    this.bands = EQ_FREQS.map((f) => { const b = ctx.createBiquadFilter(); b.type = 'peaking'; b.frequency.value = f; b.Q.value = 1.3; return b; });
    this.treble = ctx.createBiquadFilter(); this.treble.type = 'highshelf'; this.treble.frequency.value = 8000;
    this.pan = ctx.createStereoPanner();
    this.norm = ctx.createDynamicsCompressor();
    Object.assign(this.norm, {});
    this.norm.threshold.value = -26; this.norm.knee.value = 24; this.norm.ratio.value = 4; this.norm.attack.value = 0.005; this.norm.release.value = 0.3;
    this.analyser = ctx.createAnalyser(); this.analyser.fftSize = 2048; this.analyser.smoothingTimeConstant = 0.72;
    this.master = ctx.createGain();
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -1; this.limiter.knee.value = 0; this.limiter.ratio.value = 20; this.limiter.attack.value = 0.002; this.limiter.release.value = 0.1;
    // medidores L/R para el visualizador minimal
    this.split = ctx.createChannelSplitter(2);
    this.aL = ctx.createAnalyser(); this.aR = ctx.createAnalyser(); this.aL.fftSize = this.aR.fftSize = 512;

    let n = this.mix;
    for (const node of [this.pre, this.bass, ...this.bands, this.treble, this.pan]) { n.connect(node); n = node; }
    this.tail = n;
    this.analyser.connect(this.master); this.master.connect(this.limiter); this.limiter.connect(ctx.destination);
    this.analyser.connect(this.split); this.split.connect(this.aL, 0); this.split.connect(this.aR, 1);
    this.setNorm(false);

    const mk = (el) => {
      el.crossOrigin = 'anonymous'; el.preload = 'auto';
      const src = ctx.createMediaElementSource(el);
      const gain = ctx.createGain(); gain.gain.value = 0;
      src.connect(gain); gain.connect(this.mix);
      const d = { el, gain, video: el.tagName === 'VIDEO' };
      this.bind(d);
      return d;
    };
    this.decks = [mk(new Audio()), mk(new Audio())];
    this.vdeck = mk(videoEl);
    this.freq = new Uint8Array(this.analyser.frequencyBinCount);
    this.wave = new Float32Array(this.analyser.fftSize);
    this.lr = new Float32Array(this.aL.fftSize);
  }

  bind(d) {
    const on = (ev, fn) => d.el.addEventListener(ev, (e) => { if (d === this.active) fn(e); });
    on('play', () => bus.emit('eng:state', 'play'));
    on('pause', () => bus.emit('eng:state', 'pause'));
    on('waiting', () => bus.emit('eng:state', 'wait'));
    on('playing', () => bus.emit('eng:state', 'play'));
    on('loadedmetadata', () => bus.emit('eng:meta'));
    on('progress', () => bus.emit('eng:buffer'));
    on('timeupdate', () => {
      const el = d.el;
      // aviso para fundir con la siguiente unos segundos antes del final
      if (!this.nearEndFired && this.crossfade > 0 && !d.video && el.duration > this.crossfade * 3 && el.duration - el.currentTime <= this.crossfade + 0.15) {
        this.nearEndFired = true;
        bus.emit('eng:nearend');
      }
    });
    on('ended', () => bus.emit('eng:ended'));
    on('error', () => bus.emit('eng:error', d.el.error ? d.el.error.message || d.el.error.code : 'error'));
  }

  ramp(d, to, sec) {
    const g = d.gain.gain, t = this.ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    if (sec <= 0.02) g.linearRampToValueAtTime(to, t + 0.02);
    else g.setTargetAtTime(to, t, sec / 3.5);
  }
  level() { return dbToGain(this.songDb); }

  // carga y reproduce una pista; fade > 0 = fundido cruzado con la anterior
  async load(track, { fade = 0, autoplay = true, startAt = 0 } = {}) {
    if (!this.ctx) throw new Error('motor no iniciado');
    if (this.ctx.state === 'suspended' && autoplay) this.ctx.resume();
    const token = ++this.fadeToken;
    const old = this.active;
    const next = track.video ? this.vdeck : this.decks.find((d) => d !== old && !d.video) || this.decks[0];
    // si el deck destino estaba sonando (salto rápido), cortarlo
    if (next !== old) { next.el.pause(); next.gain.gain.cancelScheduledValues(this.ctx.currentTime); next.gain.gain.value = 0; }
    this.track = track;
    this.active = next;
    this.nearEndFired = false;
    if (next === old) { // mismo deck (p. ej. video → video): fundido corto de salida
      this.ramp(next, 0, 0.05); await wait(60);
    }
    next.el.src = mediaUrl(track.id);
    next.el.currentTime = 0;
    if (startAt > 0) {
      await new Promise((ok) => { const f = () => { next.el.removeEventListener('loadedmetadata', f); ok(); }; next.el.addEventListener('loadedmetadata', f); setTimeout(ok, 3000); });
      try { next.el.currentTime = startAt; } catch {}
    }
    bus.emit('eng:track', track);
    if (old && old !== next) {
      const f = old.el.paused ? 0.05 : Math.max(0.05, fade || 0.18);
      this.ramp(old, 0, f);
      setTimeout(() => { if (this.active !== old) { old.el.pause(); old.el.removeAttribute('src'); old.el.load(); } }, f * 1000 + 120);
    }
    if (!autoplay) { next.gain.gain.value = this.level(); bus.emit('eng:state', 'pause'); return; }
    try { await next.el.play(); }
    catch (e) { if (token === this.fadeToken) bus.emit('eng:error', e.message); return; }
    if (token !== this.fadeToken) return;
    this.ramp(next, this.level(), fade > 0 ? fade : 0.03);
  }

  async play() {
    const d = this.active; if (!d || !d.el.src) return false;
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    try { await d.el.play(); } catch (e) { bus.emit('eng:error', e.message); return false; }
    this.ramp(d, this.level(), 0.12);
    return true;
  }
  async pause() {
    const d = this.active; if (!d) return;
    this.ramp(d, 0, 0.12);
    await wait(140);
    if (d === this.active) d.el.pause();
  }
  toggle() { return this.paused ? this.play() : this.pause(); }
  stop() { for (const d of [...this.decks, this.vdeck]) { if (!d) continue; d.el.pause(); d.el.removeAttribute('src'); d.el.load(); } this.active = null; this.track = null; bus.emit('eng:state', 'pause'); }

  async seek(t) {
    const d = this.active; if (!d || !isFinite(d.el.duration)) return;
    const playing = !d.el.paused;
    if (playing) { this.ramp(d, 0, 0.04); await wait(45); }
    d.el.currentTime = Math.max(0, Math.min(d.el.duration - 0.25, t));
    this.nearEndFired = false;
    if (playing) this.ramp(d, this.level(), 0.06);
    bus.emit('eng:seek');
  }

  get paused() { return !this.active || this.active.el.paused; }
  get time() { return this.active ? this.active.el.currentTime || 0 : 0; }
  get duration() { const d = this.active && this.active.el.duration; return isFinite(d) ? d : (this.track ? this.track.duration : 0); }
  get buffered() {
    const el = this.active && this.active.el; if (!el || !el.buffered.length) return 0;
    try { return el.buffered.end(el.buffered.length - 1); } catch { return 0; }
  }

  // ---------- volumen y sonido ----------
  setVolume(master, muted) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(muted ? 0 : master, t, 0.03);
  }
  setSongDb(db) { this.songDb = db || 0; if (this.active && !this.paused) this.ramp(this.active, this.level(), 0.08); }
  setEq(eq) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, on = eq.on !== false;
    const set = (p, v) => p.setTargetAtTime(v, t, 0.03);
    set(this.pre.gain, dbToGain(on ? eq.preamp || 0 : 0));
    set(this.bass.gain, on ? eq.bass || 0 : 0);
    set(this.treble.gain, on ? eq.treble || 0 : 0);
    this.bands.forEach((b, i) => set(b.gain, on ? eq.bands[i] || 0 : 0));
    set(this.pan.pan, Math.max(-1, Math.min(1, eq.balance || 0)));
  }
  setNorm(on) {
    if (!this.ctx) return;
    try { this.tail.disconnect(); this.norm.disconnect(); } catch {}
    if (on) { this.tail.connect(this.norm); this.norm.connect(this.analyser); } else this.tail.connect(this.analyser);
  }
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export const engine = new Engine();
