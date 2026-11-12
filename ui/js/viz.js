// visualizador: 5 modos que leen el audio REAL (AnalyserNode de la cadena de sonido), nunca datos inventados.
// Optimizado: límite de FPS, se detiene solo en pausa, no dibuja lienzos ocultos y reutiliza los cálculos por cuadro.
import { engine } from './audio.js';
import { bus, P } from './core.js';
import { liveColors } from './theme.js';
import { C } from './custom.js';

// color del visualizador: del tema, arcoíris o uno fijo (ajustes → estilo del visualizador)
let VC = C();
const hexMix = (h, t, to) => { const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)); return 'rgb(' + c.map((v) => Math.round(v + (to - v) * t)).join(',') + ')'; };
function pickColors() {
  const lc = liveColors();
  if (VC.vizColor === 'custom' && /^#[0-9a-f]{6}$/i.test(VC.vizCustom)) { const h = VC.vizCustom; return { ...lc, ac: h, ac2: hexMix(h, 0.45, 255), ac3: hexMix(h, 0.4, 0), sec: hexMix(h, 0.25, 255) }; }
  return lc;
}
function rainbow(now) {
  const h = (now / 40) % 360;
  colors = { ...colors, ac: `hsl(${h},85%,62%)`, ac2: `hsl(${h + 40},90%,76%)`, ac3: `hsl(${h - 40},80%,46%)`, sec: `hsl(${h + 180},80%,62%)` };
}
bus.on('custom', () => { VC = C(); colors = pickColors(); start(); });

export const MODES = [
  { id: 'spectrum', name: 'spectrum' }, { id: 'wave', name: 'waveform' }, { id: 'circle', name: 'circular' },
  { id: 'minimal', name: 'minimal' }, { id: 'particles', name: 'particles' },
];
const views = new Map();
let colors = liveColors();
let running = false, lastFrame = 0, idleSince = 0;
const F = { freq: null, wave: null, bass: 0, mid: 0, high: 0, rmsL: 0, rmsR: 0, live: false };

export function attach(canvas, opts = {}) {
  views.set(canvas, { mode: opts.mode || null, small: !!opts.small, levels: [], peaks: [], pv: [], parts: [], vu: [0, 0], vuPk: [0, 0] });
  start();
}
// modo propio de un lienzo (p. ej. la pantalla completa); null = el mismo que el panel
export function setViewMode(canvas, mode) { const v = views.get(canvas); if (v) { v.mode = mode || null; v.levels = []; start(); } }
export function setMode(m) { P.set('viz', m); bus.emit('viz:mode', m); start(); }
export function cycleMode() { const i = MODES.findIndex((m) => m.id === P.get('viz')); setMode(MODES[(i + 1) % MODES.length].id); return MODES[(i + 1) % MODES.length].name; }

bus.on('theme', () => { colors = pickColors(); setTimeout(() => (colors = pickColors()), 800); setTimeout(() => (colors = pickColors()), 1600); });
bus.on('np', () => { setTimeout(() => (colors = pickColors()), 900); setTimeout(() => (colors = pickColors()), 1700); });
bus.on('eng:state', (s) => { if (s === 'play') start(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) start(); });

export function start() {
  if (running) return;
  running = true; idleSince = 0;
  requestAnimationFrame(frame);
}

function frame(now) {
  const fps = +P.get('fps') || 60;
  if (now - lastFrame < 1000 / fps - 2) { requestAnimationFrame(frame); return; }
  lastFrame = now;
  if (document.hidden) { running = false; return; }
  readAudio();
  if (VC.vizColor === 'rainbow') rainbow(now);
  let anyEnergy = false;
  for (const [cv, v] of views) {
    if (!cv.isConnected || !cv.offsetParent) continue;   // oculto: no dibujar
    const dpr = Math.min(devicePixelRatio || 1, v.small ? 1.5 : 2);
    const W = cv.clientWidth, H = cv.clientHeight;
    if (!W || !H) continue;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    const x = cv.getContext('2d');
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    x.clearRect(0, 0, W, H);
    const mode = v.mode || P.get('viz') || 'spectrum';
    if ((DRAW[mode] || DRAW.spectrum)(x, W, H, v)) anyEnergy = true;
  }
  // en pausa: dejar que las barras bajen y después dormir
  if (!F.live) {
    if (!idleSince) idleSince = now;
    if (!anyEnergy && now - idleSince > 600) { running = false; return; }
  } else idleSince = 0;
  requestAnimationFrame(frame);
}

function readAudio() {
  const a = engine.analyser;
  F.live = !!(a && !engine.paused);
  if (!a) return;
  if (!F.freq) { F.freq = new Uint8Array(a.frequencyBinCount); F.wave = new Float32Array(a.fftSize); F.lr = new Float32Array(engine.aL.fftSize); }
  if (F.live) {
    a.getByteFrequencyData(F.freq);
    a.getFloatTimeDomainData(F.wave);
    const rms = (an) => { an.getFloatTimeDomainData(F.lr); let s = 0; for (let i = 0; i < F.lr.length; i++) s += F.lr[i] * F.lr[i]; return Math.sqrt(s / F.lr.length); };
    F.rmsL = rms(engine.aL); F.rmsR = rms(engine.aR);
  } else { F.freq.fill(0); F.wave.fill(0); F.rmsL = F.rmsR = 0; }
  const nyq = engine.ctx.sampleRate / 2, bin = F.freq.length / nyq;
  const avg = (f0, f1) => { const a0 = Math.floor(f0 * bin), a1 = Math.max(a0 + 1, Math.floor(f1 * bin)); let s = 0; for (let i = a0; i < a1; i++) s += F.freq[i]; return s / (a1 - a0) / 255; };
  F.bass = avg(30, 160); F.mid = avg(400, 2500); F.high = avg(4000, 12000);
}

// bandas logarítmicas (40 Hz – 16 kHz), cacheadas por cantidad de barras
const mapCache = new Map();
function bandMap(n) {
  const key = n + ':' + (engine.ctx ? engine.ctx.sampleRate : 0);
  if (mapCache.has(key)) return mapCache.get(key);
  const nyq = (engine.ctx ? engine.ctx.sampleRate : 48000) / 2, bins = F.freq ? F.freq.length : 1024;
  const m = [];
  for (let i = 0; i < n; i++) {
    const f0 = 40 * Math.pow(16000 / 40, i / n), f1 = 40 * Math.pow(16000 / 40, (i + 1) / n);
    const a = Math.floor((f0 / nyq) * bins), b = Math.max(a + 1, Math.ceil((f1 / nyq) * bins));
    m.push([a, b]);
  }
  mapCache.set(key, m);
  return m;
}
function levels(v, n) {
  if (v.levels.length !== n) { v.levels = new Array(n).fill(0); v.peaks = new Array(n).fill(0); v.pv = new Array(n).fill(0); }
  const m = bandMap(n);
  let energy = 0;
  for (let i = 0; i < n; i++) {
    let s = 0;
    if (F.freq) { const [a, b] = m[i]; for (let k = a; k < b; k++) if (F.freq[k] > s) s = F.freq[k]; }
    const target = Math.pow(s / 255, 1.5) * (0.82 + (i / n) * 0.45);
    const L = v.levels;
    L[i] = target > L[i] ? L[i] + (target - L[i]) * 0.6 : L[i] * 0.88;
    if (L[i] > v.peaks[i]) { v.peaks[i] = L[i]; v.pv[i] = 0; } else { v.pv[i] += 0.0018; v.peaks[i] = Math.max(0, v.peaks[i] - v.pv[i]); }
    energy += L[i] + v.peaks[i];
  }
  return energy > 0.02;
}
function vgrad(x, y0, y1) { const g = x.createLinearGradient(0, y0, 0, y1); g.addColorStop(0, colors.ac2); g.addColorStop(1, colors.ac3); return g; }

const DRAW = {
  spectrum(x, W, H, v) {
    const n = !v.small && VC.vizBars ? Math.max(8, Math.min(VC.vizBars, Math.floor(W / 3))) : Math.round(Math.max(16, Math.min(v.small ? 24 : 64, W / (v.small ? 9 : 15))));
    const live = levels(v, n);
    const gap = Math.max(1, (W / n) * 0.3), bw = (W - gap * (n + 1)) / n;
    const reflect = !v.small && H > 90 && VC.vizReflect;
    const rb = VC.vizColor === 'rainbow', h0 = rb ? (performance.now() / 40) % 360 : 0;
    const base = reflect ? H * 0.8 : H;                  // las barras crecen desde acá; abajo va el reflejo
    const top = 6;
    const g = x.createLinearGradient(0, top, 0, base);
    g.addColorStop(0, colors.ac2); g.addColorStop(0.55, colors.ac); g.addColorStop(1, colors.ac3);
    const hs = new Array(n);
    for (let i = 0; i < n; i++) hs[i] = Math.max(2, Math.min(1, v.levels[i]) * (base - top));
    // resplandor: barras un poco más anchas y translúcidas detrás (más barato que shadowBlur)
    if (!v.small) {
      x.fillStyle = colors.ac; x.globalAlpha = 0.16;
      for (let i = 0; i < n; i++) if (hs[i] > 4) x.fillRect(gap + i * (bw + gap) - 2.5, base - hs[i] - 3, bw + 5, hs[i] + 3);
      x.globalAlpha = 1;
    }
    x.fillStyle = g;
    for (let i = 0; i < n; i++) { if (rb) x.fillStyle = `hsl(${h0 + (i / n) * 300},85%,${62 + Math.min(1, v.levels[i]) * 14}%)`; x.fillRect(gap + i * (bw + gap), base - hs[i], bw, hs[i]); }
    // reflejo sobre el "piso"
    if (reflect) {
      const rg = x.createLinearGradient(0, base, 0, H);
      rg.addColorStop(0, colors.ac); rg.addColorStop(1, 'transparent');
      x.fillStyle = rg; x.globalAlpha = 0.22;
      for (let i = 0; i < n; i++) x.fillRect(gap + i * (bw + gap), base + 2, bw, Math.min(H - base - 2, hs[i] * 0.45));
      x.globalAlpha = 0.35; x.fillStyle = colors.ac2; x.fillRect(0, base, W, 1);
      x.globalAlpha = 1;
    }
    // picos que caen despacio
    x.fillStyle = colors.fg; x.globalAlpha = 0.8;
    if (VC.vizPeaks) for (let i = 0; i < n; i++) { const ph = Math.min(1, v.peaks[i]) * (base - top); if (ph > 3) x.fillRect(gap + i * (bw + gap), base - ph - 4, bw, 2); }
    x.globalAlpha = 1;
    return live;
  },
  wave(x, W, H, v) {
    const w = F.wave; if (!w) return false;
    const mid = H / 2, step = Math.max(1, Math.floor(w.length / (W / 1.5)));
    let peak = 0;
    const path = new Path2D();
    for (let i = 0, px = 0; i < w.length; i += step, px += (W / w.length) * step) {
      const y = mid + w[i] * mid * 0.92;
      if (Math.abs(w[i]) > peak) peak = Math.abs(w[i]);
      i === 0 ? path.moveTo(px, y) : path.lineTo(px, y);
    }
    x.lineJoin = 'round';
    x.strokeStyle = colors.ac; x.globalAlpha = 0.25; x.lineWidth = 7; x.stroke(path);
    x.globalAlpha = 1; x.strokeStyle = colors.ac2; x.lineWidth = 1.8; x.stroke(path);
    x.strokeStyle = colors.ac3; x.globalAlpha = 0.35; x.lineWidth = 1; x.beginPath(); x.moveTo(0, mid); x.lineTo(W, mid); x.stroke(); x.globalAlpha = 1;
    return peak > 0.002;
  },
  circle(x, W, H, v) {
    const n = 90, live = levels(v, n);
    const cx = W / 2, cy = H / 2, R = Math.min(W, H) * 0.26 * (1 + F.bass * 0.12), maxL = Math.min(W, H) * 0.22;
    x.beginPath(); x.arc(cx, cy, R * 0.92, 0, Math.PI * 2);
    x.fillStyle = colors.ac3; x.globalAlpha = 0.12 + F.bass * 0.35; x.fill(); x.globalAlpha = 1;
    x.lineCap = 'round'; x.lineWidth = Math.max(1.5, (Math.PI * 2 * R) / n * 0.5);
    for (let i = 0; i < n * 2; i++) {
      const k = i < n ? i : n * 2 - 1 - i;            // espejado: simétrico
      const a = (i / (n * 2)) * Math.PI * 2 - Math.PI / 2;
      const l = 2 + Math.min(1, v.levels[k]) * maxL;
      x.strokeStyle = i % 2 ? colors.ac2 : colors.ac;
      x.beginPath(); x.moveTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R); x.lineTo(cx + Math.cos(a) * (R + l), cy + Math.sin(a) * (R + l)); x.stroke();
    }
    x.beginPath(); x.arc(cx, cy, R * 0.86, 0, Math.PI * 2); x.strokeStyle = colors.sec; x.globalAlpha = 0.5; x.lineWidth = 1; x.stroke(); x.globalAlpha = 1;
    return live || F.bass > 0.01;
  },
  minimal(x, W, H, v) {
    // medidores estéreo (RMS en dB) con pico retenido + línea de espectro fina
    const db = (r) => Math.max(0, Math.min(1, (20 * Math.log10(r + 1e-6) + 48) / 48));
    const tgt = [db(F.rmsL), db(F.rmsR)];
    let live = false;
    const bh = Math.max(5, Math.min(12, H * 0.08)), x0 = 26, bw = W - x0 - 12;
    x.font = '10px ' + getComputedStyle(document.body).fontFamily;
    for (let c = 0; c < 2; c++) {
      v.vu[c] = tgt[c] > v.vu[c] ? tgt[c] : v.vu[c] * 0.9 + tgt[c] * 0.1;
      v.vuPk[c] = Math.max(v.vuPk[c] - 0.004, v.vu[c]);
      if (v.vu[c] > 0.01) live = true;
      const y = 12 + c * (bh + 8);
      x.fillStyle = colors.fg; x.globalAlpha = 0.5; x.fillText(c ? 'R' : 'L', 8, y + bh - 1); x.globalAlpha = 0.12;
      x.fillRect(x0, y, bw, bh); x.globalAlpha = 1;
      const g = x.createLinearGradient(x0, 0, x0 + bw, 0); g.addColorStop(0, colors.ac3); g.addColorStop(0.75, colors.ac); g.addColorStop(1, colors.ac2);
      x.fillStyle = g; x.fillRect(x0, y, bw * v.vu[c], bh);
      x.fillStyle = colors.fg; x.fillRect(x0 + bw * v.vuPk[c] - 1, y - 1, 2, bh + 2);
    }
    const n = 64; if (levels(v, n)) live = true;
    const top = 12 + 2 * (bh + 8) + 8, hh = H - top - 4;
    if (hh > 10) {
      x.beginPath();
      for (let i = 0; i < n; i++) { const px = (i / (n - 1)) * W, py = top + hh - Math.min(1, v.levels[i]) * hh; i ? x.lineTo(px, py) : x.moveTo(px, py); }
      x.strokeStyle = colors.ac2; x.lineWidth = 1.4; x.stroke();
      x.lineTo(W, top + hh); x.lineTo(0, top + hh); x.closePath(); x.fillStyle = colors.ac; x.globalAlpha = 0.12; x.fill(); x.globalAlpha = 1;
    }
    return live;
  },
  particles(x, W, H, v) {
    const max = v.small ? 40 : Math.max(0, +P.get('particles') || 0);
    const cx = W / 2, cy = H / 2, e = F.bass, ps = v.parts;
    // cantidad según la energía real: graves (fuerte) + medios + agudos (base suave para temas con pocos graves)
    const spawn = F.live ? Math.min(14, Math.floor(e * e * 24 + F.mid * 8 + F.high * 6 + (F.mid > 0.05 ? 1 : 0))) : 0;
    for (let i = 0; i < spawn && ps.length < max; i++) {
      const a = Math.random() * Math.PI * 2, sp = 0.6 + Math.random() * 2.2 + e * 5;
      ps.push({ x: cx, y: cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 1, r: 0.8 + Math.random() * 2.4 + F.high * 3, c: Math.random() < 0.7 ? 0 : 1 });
    }
    // halo central que late con los graves
    const R = Math.min(W, H) * (0.08 + e * 0.12);
    const g = x.createRadialGradient(cx, cy, 0, cx, cy, R * 2.2); g.addColorStop(0, colors.ac2); g.addColorStop(0.35, colors.ac3); g.addColorStop(1, 'transparent');
    x.globalAlpha = 0.25 + e * 0.5; x.fillStyle = g; x.beginPath(); x.arc(cx, cy, R * 2.2, 0, Math.PI * 2); x.fill();
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      p.x += p.vx * (1 + e * 1.5); p.y += p.vy * (1 + e * 1.5); p.life -= 0.012 + (1 - e) * 0.004;
      if (p.life <= 0 || p.x < -10 || p.x > W + 10 || p.y < -10 || p.y > H + 10) { ps.splice(i, 1); continue; }
      x.globalAlpha = Math.max(0, p.life);
      x.fillStyle = p.c ? colors.sec : colors.ac2;
      x.beginPath(); x.arc(p.x, p.y, p.r, 0, Math.PI * 2); x.fill();
    }
    x.globalAlpha = 1;
    return ps.length > 0 || e > 0.01;
  },
};
