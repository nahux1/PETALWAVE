// motor de audio: 2 reproductores (para fundir canciones) + video, cadena EQ 10 bandas, normalizador y limitador.
// Cadena: deck(s) → mezcla → preamp → graves → 10 bandas → agudos → balance → [normalizar] → analizador → volumen → limitador → salida
import { bus, mediaUrl, local } from './core.js';
import { NativeEngine, nativeAvailable } from './nativeengine.js';

// ---------- volumen parejo ----------
// Se mide el volumen real de cada canción mientras suena (RMS sin contar silencios) y se ajusta su ganancia
// para que todas suenen parecido. La medida se recuerda: la próxima vez arranca ya ajustada.
const TARGET_DB = -16;          // volumen objetivo (RMS en dBFS); la mayoría de la música está entre −20 y −9
const LOUD_KEY = 'pw-loud';
const loudMap = local.get(LOUD_KEY, {}) || {};
let loudDirty = 0;
const saveLoud = () => { const k = Object.keys(loudMap); if (k.length > 3000) for (const x of k.slice(0, k.length - 3000)) delete loudMap[x]; local.set(LOUD_KEY, loudMap); };

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
    this.autoLevel = true;   // volumen parejo
    this.smart = true;       // saltar silencios al principio y al final
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
      // cada reproductor mide su propio volumen (así, durante un fundido, cada canción se mide sola)
      const lgain = ctx.createGain();
      const meter = ctx.createAnalyser(); meter.fftSize = 2048;
      src.connect(meter); src.connect(lgain); lgain.connect(gain); gain.connect(this.mix);
      const d = { el, gain, lgain, meter, buf: new Float32Array(2048), video: el.tagName === 'VIDEO' };
      this.bind(d);
      return d;
    };
    this.decks = [mk(new Audio()), mk(new Audio())];
    this.vdeck = mk(videoEl);
    this.freq = new Uint8Array(this.analyser.frequencyBinCount);
    this.wave = new Float32Array(this.analyser.fftSize);
    this.lr = new Float32Array(this.aL.fftSize);
    setInterval(() => this.tick(), 250);
  }

  // cada 250 ms: medir el volumen de la canción que suena y detectar silencios
  tick() {
    const d = this.active;
    if (!d || d.el.paused || !this.track || d.video) return;
    d.meter.getFloatTimeDomainData(d.buf);
    let e = 0; for (let i = 0; i < d.buf.length; i++) e += d.buf[i] * d.buf[i];
    const ms = e / d.buf.length, db = ms > 1e-12 ? 10 * Math.log10(ms) : -120;
    const m = d.m;
    if (!m || m.id !== this.track.id) return;
    const el = d.el, dur = el.duration, now = el.currentTime;
    // volumen parejo: promedio de energía de las partes con sonido
    if (db > -50) { m.sum += ms; m.n++; }
    if (this.autoLevel && m.n >= 8 && m.n % 4 === 0) {
      const loud = 10 * Math.log10(m.sum / m.n);
      const prev = loudMap[m.id];
      // la medida guardada se va afinando con cada escucha
      const est = prev == null ? loud : prev * 0.7 + loud * 0.3;
      if (m.n >= 40 || prev == null) { loudMap[m.id] = Math.round(est * 10) / 10; if (++loudDirty % 3 === 0) saveLoud(); }
      // con pocos segundos medidos y sin medida guardada, subir con cuidado (un intro suave engaña)
      this.applyLevel(d, est, 1.2, prev == null && m.n < 40 ? 3 : 8);
    }
    if (!this.smart || !isFinite(dur) || dur < 20) return;
    // silencio al principio (más de 1 s callado en los primeros 8 s): saltarlo
    if (!m.lead && now < 8) {
      if (db < -60) { m.leadSil += 0.25; if (m.leadSil >= 1 && now + 1 < dur) el.currentTime = now + 1; }
      else m.lead = true;
    }
    // silencio al final (cola larga callada): pasar a la siguiente sin esperar
    if (dur - now < Math.max(20, dur * 0.15)) {
      m.tailSil = db < -50 ? m.tailSil + 0.25 : 0;
      // 3 s de silencio, o 1,5 s si ya faltan menos de 8 s (una pausa corta antes del final no corta la canción)
      if ((m.tailSil >= 3 || (m.tailSil >= 1.5 && dur - now <= 8)) && !m.tailFired) {
        m.tailFired = true;
        if (this.crossfade > 0 && !this.nearEndFired) { this.nearEndFired = true; bus.emit('eng:nearend', this.track.id); }
        else if (!this.nearEndFired && !m.endedFired) { m.endedFired = true; bus.emit('eng:ended', this.track.id); }
      }
    }
  }
  // ganancia para llegar al volumen objetivo (entre −12 y +8 dB, para no exagerar)
  applyLevel(d, loud, tau = 0.05, maxUp = 8) {
    const gdb = this.autoLevel && loud != null ? Math.max(-12, Math.min(maxUp, TARGET_DB - loud)) : 0;
    const p = d.lgain.gain, t = this.ctx.currentTime;
    p.cancelScheduledValues(t); p.setTargetAtTime(dbToGain(gdb), t, tau);
  }
  setAutoLevel(on) { this.autoLevel = !!on; for (const d of this.decks) if (d.m) this.applyLevel(d, on ? loudMap[d.m.id] : null, 0.3); }

  bind(d) {
    const on = (ev, fn) => d.el.addEventListener(ev, (e) => { if (d === this.active) fn(e); });
    on('play', () => bus.emit('eng:state', 'play'));
    on('pause', () => bus.emit('eng:state', 'pause'));
    on('waiting', () => bus.emit('eng:state', 'wait'));
    on('playing', () => { if (d.m) d.m.started = true; bus.emit('eng:state', 'play'); });
    on('loadedmetadata', () => bus.emit('eng:meta'));
    on('progress', () => bus.emit('eng:buffer'));
    on('timeupdate', () => {
      const el = d.el;
      if (d.m && el.currentTime > 0.1) d.m.started = true;
      // aviso para fundir con la siguiente unos segundos antes del final
      if (!this.nearEndFired && this.crossfade > 0 && !d.video && el.duration > this.crossfade * 3 && el.duration - el.currentTime <= this.crossfade + 0.15) {
        this.nearEndFired = true;
        bus.emit('eng:nearend', this.track.id);
      }
    });
    on('ended', () => {
      if (!d.m || !d.m.started || d.m.endedFired || this.nearEndFired) return;
      d.m.endedFired = true;
      bus.emit('eng:ended', d.m.id);
    });
    on('error', () => bus.emit('eng:error', { id: d.m && d.m.id, message: d.el.error ? d.el.error.message || d.el.error.code : 'error' }));
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
      if (token !== this.fadeToken) return;
    }
    if (loudDirty) saveLoud();   // guardar lo medido de la anterior
    next.m = { id: track.id, sum: 0, n: 0, leadSil: 0, lead: !!startAt, tailSil: 0, tailFired: false };
    if (!next.video) this.applyLevel(next, loudMap[track.id], 0.02);   // si ya la medimos, arranca ajustada
    next.el.src = mediaUrl(track.id);
    next.el.currentTime = 0;
    if (startAt > 0) {
      await new Promise((ok) => { const f = () => { next.el.removeEventListener('loadedmetadata', f); ok(); }; next.el.addEventListener('loadedmetadata', f); setTimeout(ok, 3000); });
      if (token !== this.fadeToken) return;
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
    catch (e) { if (token === this.fadeToken) this.playFailed(e, track.id); return; }
    if (token !== this.fadeToken) return;
    this.ramp(next, this.level(), fade > 0 ? fade : 0.03);
  }

  // play() rechazado: si lo cortó una pausa o una carga nueva (AbortError) o el navegador pide un toque
  // (NotAllowedError), no es que la canción no suene: queda en pausa y no se salta a la siguiente
  playFailed(e, id) {
    if (e && (e.name === 'AbortError' || e.name === 'NotAllowedError')) { bus.emit('eng:state', 'pause'); return; }
    bus.emit('eng:error', { id, message: e ? e.message : 'error' });
  }
  async play() {
    const d = this.active; if (!d || !d.el.src) return false;
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    try { await d.el.play(); } catch (e) { this.playFailed(e, this.track && this.track.id); return false; }
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
    if (d.m) { d.m.lead = true; d.m.tailSil = 0; d.m.tailFired = false; }   // si moviste la barra, no saltar nada solo
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
// en Android con el motor nativo (beta) activado, suena con ExoPlayer; si no, con Web Audio como siempre
export const engine = nativeAvailable() ? new NativeEngine() : new Engine();
