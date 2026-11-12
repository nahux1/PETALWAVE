// fondos animados: wallpaper de video / GIF y efectos dibujados en vivo (aurora, ondas, estrellas, lluvia digital,
// bokeh, nebulosa), con los colores del tema y, si se quiere, reaccionando a los graves de la música.
// Pensado para gastar poco: se dibuja a baja resolución, con límite de FPS, y se detiene con la ventana oculta,
// en modo mini o con las animaciones apagadas.
import { $, P, bus, api } from './core.js';
import { engine } from './audio.js';
import { liveColors } from './theme.js';
import { C, FX } from './custom.js';
// resolución interna por efecto (los suaves aguantan muy poca, los de puntos necesitan más)
const QUALITY = { aurora: 0.3, waves: 0.55, stars: 0.7, rain: 0.6, bokeh: 0.35, nebula: 0.22 };

let cv, x, W = 0, H = 0, mode = 'none', raf = 0, last = 0, t = 0, colors = liveColors(), state = {}, bass = 0, freq = null;
const cfg = () => C();

function rgba(color, a) {
  // convierte cualquier color CSS a rgba con alfa (para degradados)
  const c = document.createElement('canvas').getContext('2d'); c.fillStyle = '#000'; c.fillStyle = color;
  const s = c.fillStyle;
  if (s.startsWith('#')) return `rgba(${parseInt(s.slice(1, 3), 16)},${parseInt(s.slice(3, 5), 16)},${parseInt(s.slice(5, 7), 16)},${a})`;
  return s.replace(/rgba?\(([^)]+)\)/, (_, v) => { const p = v.split(',').slice(0, 3); return `rgba(${p.join(',')},${a})`; });
}
let pal = {};
function refreshColors() {
  colors = liveColors();
  pal = { ac: colors.ac, ac2: colors.ac2, ac3: colors.ac3, sec: colors.sec, a: (c, a) => rgba(colors[c] || c, a) };
  const cache = {}; pal.a = (c, a) => { const k = c + a; return cache[k] || (cache[k] = rgba(colors[c] || c, a)); };
}

function resize() {
  if (!cv) return;
  const q = QUALITY[mode] || 0.4;
  W = Math.max(64, Math.round(innerWidth * q)); H = Math.max(48, Math.round(innerHeight * q));
  if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; state = {}; }
}

function readBass() {
  const a = engine.analyser;
  if (!a || engine.paused || !cfg().bgReact) { bass *= 0.92; return bass; }
  if (!freq || freq.length !== a.frequencyBinCount) freq = new Uint8Array(a.frequencyBinCount);
  a.getByteFrequencyData(freq);
  let s = 0; const n = Math.max(2, Math.round(freq.length * 0.012));
  for (let i = 1; i <= n; i++) s += freq[i];
  const v = Math.pow(s / n / 255, 1.6);
  bass = v > bass ? bass + (v - bass) * 0.5 : bass * 0.9;
  return bass;
}

const DRAW = {
  aurora() {
    x.clearRect(0, 0, W, H);
    x.globalCompositeOperation = 'lighter';
    const bands = [['ac', 0.32, 0.9], ['sec', 0.42, 0.7], ['ac2', 0.24, 0.55]];
    bands.forEach(([c, y0, sp], k) => {
      const amp = H * (0.09 + bass * 0.12);
      x.beginPath(); x.moveTo(0, 0);
      for (let i = 0; i <= 40; i++) {
        const px = (i / 40) * W;
        const y = H * y0 + Math.sin(i * 0.28 + t * sp + k * 1.7) * amp + Math.sin(i * 0.11 - t * sp * 0.6 + k) * amp * 0.8;
        x.lineTo(px, y);
      }
      x.lineTo(W, 0); x.closePath();
      const g = x.createLinearGradient(0, 0, 0, H * (y0 + 0.25));
      g.addColorStop(0, 'transparent'); g.addColorStop(0.55, pal.a(c, 0.1)); g.addColorStop(0.92, pal.a(c, 0.55 + bass * 0.35)); g.addColorStop(1, 'transparent');
      x.fillStyle = g; x.fill();
    });
    x.globalCompositeOperation = 'source-over';
  },
  waves() {
    x.clearRect(0, 0, W, H);
    const n = 14;
    for (let k = 0; k < n; k++) {
      const y0 = H * (0.25 + (k / n) * 0.75), amp = H * (0.025 + (k / n) * 0.05) * (1 + bass * 1.8);
      x.beginPath();
      for (let i = 0; i <= 60; i++) {
        const px = (i / 60) * W;
        const y = y0 + Math.sin(i * 0.22 + t * (0.6 + k * 0.05) + k * 0.6) * amp + Math.sin(i * 0.07 - t * 0.3) * amp * 0.6;
        i ? x.lineTo(px, y) : x.moveTo(px, y);
      }
      x.strokeStyle = pal.a(k % 3 === 0 ? 'sec' : 'ac2', 0.25 + (k / n) * 0.5);
      x.lineWidth = Math.max(1, W / 900);
      x.stroke();
    }
  },
  stars() {
    const N = Math.round(Math.min(420, (W * H) / 1400));
    if (!state.s || state.s.length !== N) state.s = Array.from({ length: N }, () => ({ x: Math.random() * 2 - 1, y: Math.random() * 2 - 1, z: Math.random() }));
    x.clearRect(0, 0, W, H);
    const cx = W / 2, cy = H / 2, sp = 0.0035 * (1 + bass * 6) * (cfg().bgSpeed || 1);
    for (const s of state.s) {
      const pz = s.z; s.z -= sp;
      if (s.z <= 0.02) { s.x = Math.random() * 2 - 1; s.y = Math.random() * 2 - 1; s.z = 1; continue; }
      const k = 0.5 / s.z, k0 = 0.5 / pz;
      const px = cx + s.x * W * k, py = cy + s.y * H * k;
      if (px < 0 || px > W || py < 0 || py > H) { s.z = 1; continue; }
      const a = Math.min(1, (1 - s.z) * 1.4);
      x.strokeStyle = pal.a(s.x > 0.4 ? 'sec' : 'ac2', a * 0.9);
      x.lineWidth = Math.max(0.6, (1 - s.z) * 2.2);
      x.beginPath(); x.moveTo(cx + s.x * W * k0, cy + s.y * H * k0); x.lineTo(px, py); x.stroke();
    }
  },
  rain() {
    const fs = Math.max(8, Math.round(H / 46));
    const cols = Math.ceil(W / fs);
    if (!state.d || state.d.length !== cols) state.d = Array.from({ length: cols }, () => Math.random() * (H / fs) * 1.2 - 8);
    // estela: borrar un poco lo anterior en vez de limpiar todo (el canvas es transparente)
    x.globalCompositeOperation = 'destination-out';
    x.fillStyle = 'rgba(0,0,0,0.075)'; x.fillRect(0, 0, W, H);
    x.globalCompositeOperation = 'source-over';
    x.font = `${fs}px ${getComputedStyle(document.body).fontFamily}`;
    const glyphs = 'ペタルウェーブ01アイウエオカキクケコサシスセソ♪❀';
    const sp = (0.55 + bass * 1.4) * (cfg().bgSpeed || 1);
    for (let i = 0; i < cols; i++) {
      const y = state.d[i] * fs;
      x.fillStyle = Math.random() < 0.08 ? pal.a('ac2', 0.95) : pal.a(i % 5 ? 'ac' : 'sec', 0.7);
      x.fillText(glyphs[(Math.random() * glyphs.length) | 0], i * fs, y);
      state.d[i] += sp;
      if (y > H && Math.random() > 0.975) state.d[i] = 0;
    }
  },
  bokeh() {
    const N = 26;
    if (!state.b) state.b = Array.from({ length: N }, (_, i) => ({ x: Math.random() * W, y: Math.random() * H, r: (0.04 + Math.random() * 0.12) * Math.min(W, H), v: 0.08 + Math.random() * 0.25, c: ['ac', 'sec', 'ac2', 'ac3'][i % 4], ph: Math.random() * 6 }));
    x.clearRect(0, 0, W, H);
    x.globalCompositeOperation = 'lighter';
    for (const b of state.b) {
      b.y -= b.v * (cfg().bgSpeed || 1) * (1 + bass * 2); b.x += Math.sin(t * 0.4 + b.ph) * 0.15;
      if (b.y < -b.r) { b.y = H + b.r; b.x = Math.random() * W; }
      const r = b.r * (1 + bass * 0.35), a = 0.26 + Math.sin(t * 0.8 + b.ph) * 0.08 + bass * 0.18;
      const g = x.createRadialGradient(b.x, b.y, 0, b.x, b.y, r);
      g.addColorStop(0, pal.a(b.c, a)); g.addColorStop(0.7, pal.a(b.c, a * 0.5)); g.addColorStop(1, 'transparent');
      x.fillStyle = g; x.beginPath(); x.arc(b.x, b.y, r, 0, Math.PI * 2); x.fill();
    }
    x.globalCompositeOperation = 'source-over';
  },
  nebula() {
    x.clearRect(0, 0, W, H);
    x.globalCompositeOperation = 'lighter';
    const blobs = [['ac', 0.31, 0.23, 0.7], ['sec', 0.17, 0.29, 0.6], ['ac3', 0.23, 0.13, 0.8], ['ac2', 0.11, 0.19, 0.45], ['sec', 0.27, 0.07, 0.5]];
    blobs.forEach(([c, fx, fy, s], k) => {
      const px = W * (0.5 + Math.sin(t * fx + k * 2.1) * 0.38), py = H * (0.5 + Math.cos(t * fy + k * 1.3) * 0.36);
      const r = Math.max(W, H) * s * 0.55 * (1 + bass * 0.25);
      const g = x.createRadialGradient(px, py, 0, px, py, r);
      g.addColorStop(0, pal.a(c, 0.5 + bass * 0.25)); g.addColorStop(1, 'transparent');
      x.fillStyle = g; x.fillRect(0, 0, W, H);
    });
    x.globalCompositeOperation = 'source-over';
  },
};

function frame(now) {
  raf = 0;
  if (mode === 'none' || document.hidden || document.body.classList.contains('mini')) return;
  const c = cfg(), fps = c.bgFps || 30;
  if (now - last < 1000 / fps - 2) { raf = requestAnimationFrame(frame); return; }
  const dt = Math.min(0.1, (now - (last || now)) / 1000); last = now;
  readBass();
  // en pausa se mueve más despacio (si el usuario lo pide)
  const slow = c.bgCalm && engine.paused ? 0.25 : 1;
  t += dt * (c.bgSpeed || 1) * slow;
  (DRAW[mode] || DRAW.aurora)();
  cv.style.opacity = String((c.bgOpacity ?? 80) / 100);
  if (document.body.classList.contains('noanim')) return;   // sin animaciones: queda un cuadro fijo
  raf = requestAnimationFrame(frame);
}
export function startFx() {
  const c = cfg();
  mode = FX.some((f) => f.id === c.bgFx) ? c.bgFx : 'none';
  if (!cv) return;
  cv.hidden = mode === 'none';
  document.body.classList.toggle('has-fx', mode !== 'none');
  if (mode === 'none') { cancelAnimationFrame(raf); raf = 0; x.clearRect(0, 0, W, H); return; }
  resize(); refreshColors();
  if (!raf) { last = 0; raf = requestAnimationFrame(frame); }
}

// ---------- wallpaper (imagen, GIF o video) ----------
export async function loadWallpaper() {
  const wp = $('#wp'), vid = $('#wpVid');
  let info = { has: false };
  try { info = await api.get('/api/wallpaper'); } catch {}
  const bust = Date.now();
  wp.classList.remove('img', 'vid');
  vid.pause(); vid.removeAttribute('src'); vid.load(); vid.hidden = true;
  document.body.classList.toggle('has-wp', !!info.has);
  document.body.classList.toggle('wp-video', info.kind === 'video');
  if (!info.has) return info;
  if (info.kind === 'video') {
    vid.src = '/wallpaper?' + bust; vid.hidden = false; wp.classList.add('vid');
    vid.playbackRate = cfg().wpRate || 1;
    syncVideo();
  } else {
    wp.style.setProperty('--wpimg', `url(/wallpaper?${bust})`); wp.classList.add('img');
  }
  return info;
}
function syncVideo() {
  const vid = $('#wpVid'); if (!vid || vid.hidden) return;
  const c = cfg();
  const stop = document.hidden || document.body.classList.contains('mini') || document.body.classList.contains('noanim') || (c.wpVidSync && engine.paused);
  vid.playbackRate = c.wpRate || 1;
  if (stop) vid.pause(); else vid.play().catch(() => {});
}

export function initBg() {
  cv = $('#bgfx'); x = cv.getContext('2d');
  addEventListener('resize', () => { if (mode !== 'none') resize(); });
  document.addEventListener('visibilitychange', () => { syncVideo(); if (!document.hidden) startFx(); });
  bus.on('custom', () => { startFx(); syncVideo(); });
  bus.on('theme', () => { refreshColors(); setTimeout(refreshColors, 800); setTimeout(refreshColors, 1600); });
  bus.on('np', () => { setTimeout(refreshColors, 900); setTimeout(refreshColors, 1700); });
  bus.on('eng:state', () => { syncVideo(); if (mode !== 'none' && !raf) startFx(); });
  bus.on('prefs', () => { syncVideo(); startFx(); });
  bus.on('wallpaper', loadWallpaper);
  // el modo mini cambia la clase del body: volver a arrancar al salir
  new MutationObserver(() => { syncVideo(); if (!raf) startFx(); }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  startFx();
  return loadWallpaper();
}
