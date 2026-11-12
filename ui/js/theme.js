// temas fijos + colores dinámicos tomados de la carátula de cada canción
import { $, P, host, bus, toast } from './core.js';

const T = (o) => o;
export const THEMES = {
  blood: T({
    name: 'Blood', desc: 'negro, gris, blanco y rojo oscuro',
    '--ac': '#d23a43', '--ac2': '#f08a8f', '--ac3': '#9e1c25', '--sec': '#8a8a8a', '--sec2': '#d0d0d0',
    '--deep': '#0b0708', '--win': 'rgba(22,12,13,.62)', '--dim': '#ad9c9d', '--dim2': '#7a6a6c', '--fg': '#ece6e6',
    '--w1': 'rgba(140,20,30,.55)', '--w2': 'rgba(80,10,16,.6)', '--w3': 'rgba(10,5,6,.9)', '--w4': 'rgba(120,30,36,.4)', '--w5': 'rgba(220,200,200,.08)',
    '--g1': '#1a0b0d', '--g2': '#3a0f14', '--g3': '#120809', '--g4': '#050304',
  }),
  dark: T({
    name: 'Dark', desc: 'grises neutros con acento rojo',
    '--ac': '#e6e6e6', '--ac2': '#ffffff', '--ac3': '#9c9c9c', '--sec': '#b3262e', '--sec2': '#e06a70',
    '--deep': '#0c0c0d', '--win': 'rgba(24,24,26,.62)', '--dim': '#a2a2a8', '--dim2': '#717177', '--fg': '#e9e9ea',
    '--w1': 'rgba(70,70,74,.5)', '--w2': 'rgba(120,24,30,.35)', '--w3': 'rgba(8,8,9,.92)', '--w4': 'rgba(60,60,64,.4)', '--w5': 'rgba(255,255,255,.05)',
    '--g1': '#151517', '--g2': '#222226', '--g3': '#0e0e10', '--g4': '#050506',
  }),
  midnight: T({
    name: 'Midnight', desc: 'azules nocturnos tipo tokyo-night',
    '--ac': '#7aa2f7', '--ac2': '#c0caf5', '--ac3': '#3d59a1', '--sec': '#bb9af7', '--sec2': '#e0d4ff',
    '--deep': '#070b16', '--win': 'rgba(16,22,40,.6)', '--dim': '#8d97bd', '--dim2': '#636c93', '--fg': '#d4dbf7',
    '--w1': 'rgba(61,89,161,.5)', '--w2': 'rgba(120,80,190,.35)', '--w3': 'rgba(5,8,18,.92)', '--w4': 'rgba(40,70,140,.4)', '--w5': 'rgba(192,202,245,.07)',
    '--g1': '#0d1430', '--g2': '#1a2350', '--g3': '#0a0f22', '--g4': '#04060d',
  }),
  cyberpunk: T({
    name: 'Cyberpunk', desc: 'magenta y cian neón', scan: true,
    '--ac': '#f72585', '--ac2': '#ff8fc8', '--ac3': '#b5179e', '--sec': '#00f5d4', '--sec2': '#9bfff0',
    '--deep': '#0a0612', '--win': 'rgba(24,10,40,.56)', '--dim': '#b1a4d2', '--dim2': '#7a6c9e', '--fg': '#f1e9ff',
    '--w1': 'rgba(247,37,133,.42)', '--w2': 'rgba(0,245,212,.25)', '--w3': 'rgba(10,6,18,.92)', '--w4': 'rgba(114,9,183,.45)', '--w5': 'rgba(0,245,212,.08)',
    '--g1': '#1d0a33', '--g2': '#3a0b4f', '--g3': '#0f0620', '--g4': '#05020b',
  }),
  mono: T({
    name: 'Monochrome', desc: 'blanco y negro puro',
    '--ac': '#f2f2f2', '--ac2': '#ffffff', '--ac3': '#9f9f9f', '--sec': '#c8c8c8', '--sec2': '#ffffff',
    '--deep': '#090909', '--win': 'rgba(20,20,20,.62)', '--dim': '#a0a0a0', '--dim2': '#6b6b6b', '--fg': '#f0f0f0',
    '--w1': 'rgba(90,90,90,.45)', '--w2': 'rgba(50,50,50,.5)', '--w3': 'rgba(5,5,5,.94)', '--w4': 'rgba(120,120,120,.25)', '--w5': 'rgba(255,255,255,.05)',
    '--g1': '#161616', '--g2': '#262626', '--g3': '#0d0d0d', '--g4': '#030303',
  }),
  petal: T({
    name: 'Petal', desc: 'el rosa original de petalwave', petals: true,
    '--ac': '#f4a7c3', '--ac2': '#ffc9db', '--ac3': '#e07aa5', '--sec': '#b9729a', '--sec2': '#c9b4ff',
    '--deep': '#2a1024', '--win': 'rgba(58,22,46,.42)', '--dim': '#c79db3', '--dim2': '#9a7088', '--fg': '#f7dbe6',
    '--w1': 'rgba(255,190,218,.95)', '--w2': 'rgba(255,160,200,.85)', '--w3': 'rgba(150,50,105,.9)', '--w4': 'rgba(250,170,205,.7)', '--w5': 'rgba(255,215,232,.55)',
    '--g1': '#a44d7f', '--g2': '#e48ab4', '--g3': '#7a2e5e', '--g4': '#4d1a3d',
  }),
};
const VARS = Object.keys(THEMES.blood).filter((k) => k.startsWith('--'));

let current = null;           // pista actual (para colores dinámicos)
let req = 0;
const root = document.documentElement.style;

export function setVars(obj) { for (const k of VARS) if (obj[k]) root.setProperty(k, obj[k]); tintTitleBar(obj['--deep']); }

// ---------- temas propios (los arma el usuario con 5 colores) ----------
const _hx = document.createElement('canvas').getContext('2d');
export function toHex(color) {
  _hx.fillStyle = '#000'; _hx.fillStyle = color || '#000';
  const s = _hx.fillStyle;
  if (s.startsWith('#')) return s;
  const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)/.exec(s);
  return m ? '#' + [m[1], m[2], m[3]].map((v) => Math.round(+v).toString(16).padStart(2, '0')).join('') : '#000000';
}
const hexHsl = (h) => { h = toHex(h); return rgb2hsl(parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)); };
const mixHex = (a, b, t) => { a = toHex(a); b = toHex(b); const c = [1, 3, 5].map((i) => Math.round(parseInt(a.slice(i, i + 2), 16) * (1 - t) + parseInt(b.slice(i, i + 2), 16) * t)); return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join(''); };
export function buildTheme(c) {
  const [ah, as, al] = hexHsl(c.ac), [sh, ss, sl] = hexHsl(c.sec), [bh, bs, bl] = hexHsl(c.bg), [wh, ws, wl] = hexHsl(c.wall || c.ac);
  const light = bl > 0.55, wa = clamp(c.alpha ?? 0.6, 0.15, 1);
  return {
    '--ac': toHex(c.ac), '--ac2': hsl(ah, as, light ? al - 0.12 : Math.min(0.9, al + 0.17)), '--ac3': hsl(ah, as, light ? Math.min(0.85, al + 0.15) : Math.max(0.18, al - 0.2)),
    '--sec': toHex(c.sec), '--sec2': hsl(sh, ss, light ? sl - 0.15 : Math.min(0.9, sl + 0.2)),
    '--deep': toHex(c.bg), '--win': hsl(bh, bs, light ? Math.min(0.98, bl + 0.04) : Math.min(0.5, bl + 0.06), wa),
    '--fg': toHex(c.fg), '--dim': mixHex(c.fg, c.bg, 0.32), '--dim2': mixHex(c.fg, c.bg, 0.52),
    '--w1': hsl(wh, ws, light ? 0.8 : wl * 0.85, 0.55), '--w2': hsl(sh, ss, light ? 0.82 : sl * 0.7, 0.4), '--w3': hsl(bh, bs, bl, 0.92),
    '--w4': hsl(wh, ws, light ? 0.75 : wl * 0.7, 0.4), '--w5': hsl(ah, as, light ? 0.95 : 0.85, 0.07),
    '--g1': hsl(wh, ws * 0.6, light ? bl - 0.08 : 0.14), '--g2': hsl(wh, ws * 0.7, light ? bl - 0.16 : 0.24),
    '--g3': hsl(bh, bs, light ? bl - 0.03 : Math.max(0.05, bl + 0.03)), '--g4': hsl(bh, bs, light ? bl : Math.max(0.02, bl - 0.03)),
  };
}
export const myThemes = () => P.get('customThemes') || {};
export function allThemes() {
  const out = { ...THEMES };
  for (const [k, t] of Object.entries(myThemes())) if (t && t.src) out[k] = { ...buildTheme(t.src), name: t.name || 'mi tema', desc: 'tema tuyo', mine: true, petals: !!t.src.petals, scan: !!t.src.scan, src: t.src };
  return out;
}
// colores base de un tema (para empezar a editar desde él)
export function themeSrc(key) {
  const t = allThemes()[key] || baseTheme();
  if (t.src) return { ...t.src };
  return { ac: toHex(t['--ac']), sec: toHex(t['--sec']), bg: toHex(t['--deep']), fg: toHex(t['--fg']), wall: toHex(t['--g2']), alpha: +(/,\s*([\d.]+)\)$/.exec(t['--win']) || [0, 0.6])[1], petals: !!t.petals, scan: !!t.scan };
}
export function saveMyTheme(key, name, src) {
  const all = { ...myThemes() };
  key = key || 'u_' + Date.now().toString(36);
  all[key] = { name: String(name || 'mi tema').slice(0, 24), src };
  P.all().customThemes = all;
  P.save();
  return key;
}
export function deleteMyTheme(key) {
  const all = { ...myThemes() }; delete all[key];
  P.all().customThemes = all;
  if (P.get('theme') === key) P.all().theme = 'blood';
  P.save(); applyTheme(); bus.emit('theme:changed');
}
export function previewTheme(src) { setVars(buildTheme(src)); document.body.classList.toggle('petals', !!src.petals); document.body.classList.toggle('scanlines', !!src.scan); bus.emit('theme'); }

export function baseTheme() { return allThemes()[P.get('theme')] || THEMES.blood; }

export function applyTheme() {
  const t = baseTheme();
  document.body.classList.toggle('petals', !!t.petals);
  document.body.classList.toggle('scanlines', !!t.scan);
  document.body.classList.toggle('dyn', !!P.get('dyn'));
  document.body.classList.toggle('wptint', P.get('wpTint') !== false);
  if (P.get('dyn') && current) themeForTrack(current);
  else setVars(t);
  $('#tThemeName').textContent = (P.get('dyn') ? '◐ ' : '') + t.name.toLowerCase();
  bus.emit('theme');
}
// elegir un tema a mano lo aplica siempre: si estaban los colores de la carátula, se apagan
// (antes la carátula seguía mandando y el tema elegido no se veía)
export function setTheme(name) {
  const all = allThemes();
  if (!all[name]) return false;
  const hadDyn = !!P.get('dyn');
  P.all().theme = name;
  if (hadDyn) P.all().dyn = false;
  P.save();
  applyTheme();
  if (hadDyn) toast('tema ' + all[name].name, { sub: 'colores de la carátula desactivados · tecla c para volver a activarlos', ms: 3200 });
  bus.emit('theme:changed');
  return true;
}
export function cycleTheme() {
  const keys = Object.keys(allThemes());
  setTheme(keys[(keys.indexOf(P.get('theme')) + 1) % keys.length]);
  return baseTheme().name;
}
export function setDyn(on) { P.set('dyn', !!on); applyTheme(); bus.emit('theme:changed'); }

// barra de título de la ventana nativa del color del tema
const _cc = document.createElement('canvas').getContext('2d');
export function tintTitleBar(color) {
  if (!host.native || !color) return;
  _cc.fillStyle = '#0b0708'; _cc.fillStyle = color;
  if (/^#[0-9a-f]{6}$/i.test(_cc.fillStyle)) host.send('caption:' + _cc.fillStyle);
}

// ---------- paleta de la carátula ----------
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const hsl = (h, s, l, a = 1) => `hsla(${Math.round(((h % 360) + 360) % 360)},${Math.round(clamp(s, 0, 1) * 100)}%,${Math.round(clamp(l, 0, 1) * 100)}%,${a})`;
function rgb2hsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l, 0];
  const d = mx - mn, s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l, d];
}
const hueDist = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };

export function extractPalette(img) {
  const S = 48, c = document.createElement('canvas');
  c.width = c.height = S;
  const x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(img, 0, 0, S, S);
  const d = x.getImageData(0, 0, S, S).data, B = new Map();
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 128) continue;
    const k = (d[i] >> 4) << 8 | (d[i + 1] >> 4) << 4 | (d[i + 2] >> 4);
    const e = B.get(k) || { r: 0, g: 0, b: 0, n: 0 };
    e.r += d[i]; e.g += d[i + 1]; e.b += d[i + 2]; e.n++; B.set(k, e);
  }
  const cols = [...B.values()].map((e) => { const [h, s, l, c] = rgb2hsl(e.r / e.n, e.g / e.n, e.b / e.n); return { h, s, l, c, n: e.n }; });
  if (!cols.length) return null;
  const total = cols.reduce((a, c) => a + c.n, 0);
  const colorful = cols.filter((c) => c.l > 0.14 && c.l < 0.9 && c.c > 0.12);
  const share = colorful.reduce((a, c) => a + c.n, 0) / total;
  if (!colorful.length || share < 0.03) return { mono: true };
  const vib = (c) => Math.sqrt(c.n) * c.c * (0.4 + c.s) * Math.max(0.1, 1 - Math.abs(c.l - 0.55) * 1.4);
  const prim = colorful.reduce((a, b) => (vib(b) > vib(a) ? b : a));
  const others = colorful.filter((c) => hueDist(c.h, prim.h) > 28);
  const sec = others.length ? others.reduce((a, b) => (vib(b) > vib(a) ? b : a)) : { h: prim.h + 35, s: prim.s };
  const dom = colorful.reduce((a, b) => (b.n > a.n ? b : a));
  return { prim, sec, dom };
}
function themeFromPalette(p) {
  if (p.mono) return THEMES.mono;
  const { prim: Pp, sec: S, dom: D } = p;
  const s = clamp(Pp.s, 0.5, 0.9), s2 = clamp(S.s, 0.4, 0.85), sd = clamp(D.s, 0.3, 0.7), hd = D.h;
  return {
    '--ac': hsl(Pp.h, s, 0.66), '--ac2': hsl(Pp.h, s, 0.82), '--ac3': hsl(Pp.h, s, 0.44),
    '--sec': hsl(S.h, s2 * 0.8, 0.56), '--sec2': hsl(S.h, s2, 0.8),
    '--deep': hsl(hd, sd, 0.07), '--win': hsl(hd, sd, 0.12, 0.55),
    '--dim': hsl(Pp.h, s * 0.28, 0.7), '--dim2': hsl(Pp.h, s * 0.22, 0.52), '--fg': hsl(Pp.h, s * 0.35, 0.93),
    '--w1': hsl(Pp.h, s, 0.5, 0.6), '--w2': hsl(S.h, s2, 0.42, 0.5), '--w3': hsl(hd, sd, 0.08, 0.92),
    '--w4': hsl(Pp.h, s, 0.45, 0.4), '--w5': hsl(S.h, s2, 0.8, 0.08),
    '--g1': hsl(Pp.h, s * 0.6, 0.16), '--g2': hsl(S.h, s2 * 0.7, 0.24), '--g3': hsl(hd, sd, 0.1), '--g4': hsl(hd, sd, 0.04),
  };
}
function themeFromName(name) {
  let h = 0; for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const hue = h % 360;
  return themeFromPalette({ prim: { h: hue, s: 0.7 }, sec: { h: hue + 40, s: 0.6 }, dom: { h: hue + 10, s: 0.45 } });
}
export function themeForTrack(track) {
  current = track;
  if (!P.get('dyn') || !track) return setVars(baseTheme());
  const my = ++req;
  const img = new Image();
  img.onload = () => { if (my !== req || !P.get('dyn')) return; const p = extractPalette(img); setVars(p ? themeFromPalette(p) : themeFromName(track.title)); };
  img.onerror = () => { if (my === req && P.get('dyn')) setVars(themeFromName(track.title)); };
  img.src = '/cover/' + track.id;
}

// colores actuales ya interpolados (para el canvas del visualizador)
export function liveColors() {
  const cs = getComputedStyle(document.documentElement);
  return { ac: cs.getPropertyValue('--ac').trim(), ac2: cs.getPropertyValue('--ac2').trim(), ac3: cs.getPropertyValue('--ac3').trim(), sec: cs.getPropertyValue('--sec').trim(), fg: cs.getPropertyValue('--fg').trim() };
}
