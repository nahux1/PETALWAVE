// galería de fondos incluidos: escenas dibujadas por Petalwave (SVG) con los colores del tema que tengas, así combinan
// con cualquier tema y no pesan nada. Las "animadas" suman un efecto en vivo de bgfx.js encima de la escena.
// Quien no subió un wallpaper propio ve uno de estos ("auto"); se cambia desde el botón de wallpaper o ajustes.
import { esc, modal, toast, api } from './core.js';
import { E as C, setC } from './custom.js';

export const DEFAULT_PICK = 'sakura';

// ---------- colores del tema ----------
function themeColors() {
  const cs = getComputedStyle(document.documentElement), v = (k, d) => cs.getPropertyValue(k).trim() || d;
  return { deep: v('--deep', '#0b0708'), g1: v('--g1', '#1a0b0d'), g2: v('--g2', '#3a0f14'), g3: v('--g3', '#120809'), g4: v('--g4', '#050304'),
    ac: v('--ac', '#ff4d6d'), ac2: v('--ac2', '#ffb3c1'), ac3: v('--ac3', '#c9184a'), sec: v('--sec', '#8d99ae'), fg: v('--fg', '#eee') };
}
export const colorKey = () => JSON.stringify(themeColors());

// azar con semilla: la misma escena sale siempre igual
function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const W = 1920, H = 1080;
const sky = (c, id, stops) => `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">${stops.map(([o, col, a = 1]) => `<stop offset="${o}" stop-color="${col}" stop-opacity="${a}"/>`).join('')}</linearGradient>`;
const glow = (id, col, a = 0.55) => `<radialGradient id="${id}"><stop offset="0" stop-color="${col}" stop-opacity="${a}"/><stop offset="1" stop-color="${col}" stop-opacity="0"/></radialGradient>`;
function stars(r, n, col, maxY = H) { let s = ''; for (let i = 0; i < n; i++) s += `<circle cx="${(r() * W) | 0}" cy="${(r() * maxY) | 0}" r="${(0.6 + r() * 1.8).toFixed(1)}" fill="${col}" opacity="${(0.25 + r() * 0.6).toFixed(2)}"/>`; return s; }
function ridge(r, y0, rough, step = 60) { let d = `M0 ${H} L0 ${y0}`; let y = y0; for (let px = 0; px <= W + step; px += step) { y = Math.max(y0 - rough, Math.min(y0 + rough * 0.6, y + (r() - 0.5) * rough * 0.9)); d += ` L${px} ${y | 0}`; } return d + ` L${W} ${H}Z`; }

// ---------- escenas ----------
const SCENES = {
  // rama de cerezo con flores, luna grande
  petalos(c) {
    const r = rng(7); let fl = '';
    const pts = [[-40, 120], [300, 210], [620, 260], [900, 380], [1100, 430], [520, 150], [760, 520], [380, 330]];
    for (let i = 0; i < 70; i++) {
      const [bx, by] = pts[i % pts.length], x = bx + (r() - 0.5) * 260, y = by + (r() - 0.5) * 170, s = 10 + r() * 20, col = r() > 0.4 ? c.ac2 : c.ac;
      fl += `<g transform="translate(${x | 0} ${y | 0}) rotate(${(r() * 72) | 0})" opacity="${(0.55 + r() * 0.4).toFixed(2)}">${[0, 72, 144, 216, 288].map((a) => `<ellipse cx="0" cy="${-s * 0.6}" rx="${(s * 0.42).toFixed(1)}" ry="${(s * 0.62).toFixed(1)}" fill="${col}" transform="rotate(${a})"/>`).join('')}<circle r="${(s * 0.22).toFixed(1)}" fill="${c.fg}" opacity=".7"/></g>`;
    }
    return `<defs>${sky(c, 's', [[0, c.g4], [0.55, c.g2], [1, c.g1]])}${glow('m', c.ac2, 0.35)}</defs>
      <rect width="${W}" height="${H}" fill="url(#s)"/>${stars(rng(3), 90, c.fg, H * 0.7)}
      <circle cx="1420" cy="380" r="520" fill="url(#m)"/><circle cx="1420" cy="380" r="210" fill="${c.ac2}" opacity=".22"/>
      <path d="M-60 90 C 260 200, 520 170, 760 300 S 1060 420, 1180 470 M520 150 C 600 260, 680 420, 760 520 M300 210 C 340 280, 360 300, 380 330" stroke="${c.deep}" stroke-width="26" fill="none" stroke-linecap="round"/>
      ${fl}<rect y="${H * 0.8}" width="${W}" height="${H * 0.2}" fill="${c.deep}" opacity=".35"/>`;
  },
  // montañas en capas
  montanas(c) {
    const r = rng(11), layers = [[560, 160, c.sec, 0.35], [650, 140, c.ac3, 0.4], [760, 110, c.g2, 0.85], [880, 80, c.deep, 0.95]];
    return `<defs>${sky(c, 's', [[0, c.g4], [0.6, c.g2], [1, c.ac3, 0.6]])}${glow('m', c.ac2, 0.4)}</defs>
      <rect width="${W}" height="${H}" fill="url(#s)"/>${stars(rng(5), 140, c.fg, H * 0.55)}
      <circle cx="560" cy="360" r="360" fill="url(#m)"/><circle cx="560" cy="360" r="90" fill="${c.ac2}" opacity=".5"/>
      ${layers.map(([y, rough, col, a]) => `<path d="${ridge(r, y, rough, 48)}" fill="${col}" opacity="${a}"/>`).join('')}`;
  },
  // atardecer synthwave (con o sin grilla)
  atardecer(c, { grid = true } = {}) {
    const hz = H * 0.62; let g = '';
    if (grid) {
      for (let i = 1; i < 14; i++) { const y = hz + (H - hz) * Math.pow(i / 13, 2.2); g += `<line x1="0" y1="${y | 0}" x2="${W}" y2="${y | 0}"/>`; }
      for (let i = -14; i <= 14; i++) g += `<line x1="${W / 2}" y1="${hz}" x2="${(W / 2 + i * 260) | 0}" y2="${H}"/>`;
    }
    let bars = ''; for (let i = 0; i < 7; i++) bars += `<rect x="0" y="${(hz - 160 + i * 26 + i * i * 2) | 0}" width="${W}" height="${4 + i * 2}" fill="#000"/>`;
    return `<defs>${sky(c, 's', [[0, c.g4], [0.45, c.g2], [0.62, c.ac3]])}${sky(c, 'sun', [[0, c.ac2], [1, c.ac]])}${glow('h', c.ac, 0.5)}
      <clipPath id="up"><rect width="${W}" height="${hz}"/></clipPath><mask id="cut"><rect width="${W}" height="${H}" fill="#fff"/>${bars}</mask></defs>
      <rect width="${W}" height="${H}" fill="url(#s)"/>${stars(rng(9), 110, c.fg, hz * 0.8)}
      <ellipse cx="${W / 2}" cy="${hz}" rx="900" ry="300" fill="url(#h)"/>
      <g clip-path="url(#up)"><circle cx="${W / 2}" cy="${hz - 40}" r="300" fill="url(#sun)" mask="url(#cut)"/></g>
      <rect y="${hz}" width="${W}" height="${H - hz}" fill="${c.g4}"/>
      <g stroke="${c.ac}" stroke-width="2" opacity=".55">${g}</g>`;
  },
  // ciudad de noche
  ciudad(c) {
    const r = rng(21); let b = '', w = '';
    for (const [base, hmin, hmax, col, a] of [[H * 0.78, 160, 420, c.ac3, 0.35], [H, 260, 640, c.deep, 1]]) {
      for (let x = -20; x < W; ) {
        const bw = 70 + r() * 130, bh = hmin + r() * (hmax - hmin), top = base - bh;
        b += `<rect x="${x | 0}" y="${top | 0}" width="${bw | 0}" height="${(H - top) | 0}" fill="${col}" opacity="${a}"/>`;
        if (a === 1) for (let yy = top + 18; yy < H - 20; yy += 26) for (let xx = x + 12; xx < x + bw - 14; xx += 20) if (r() < 0.22) w += `<rect x="${xx | 0}" y="${yy | 0}" width="8" height="12" fill="${r() < 0.7 ? c.ac2 : c.fg}" opacity="${(0.35 + r() * 0.5).toFixed(2)}"/>`;
        x += bw + 6 + r() * 14;
      }
    }
    return `<defs>${sky(c, 's', [[0, c.g4], [0.7, c.g2], [1, c.ac3]])}${glow('h', c.ac, 0.45)}</defs>
      <rect width="${W}" height="${H}" fill="url(#s)"/>${stars(rng(4), 70, c.fg, H * 0.45)}
      <ellipse cx="${W / 2}" cy="${H * 0.8}" rx="1200" ry="380" fill="url(#h)"/>${b}${w}`;
  },
  // mar con olas en capas
  olas(c) {
    let o = '';
    const cols = [c.sec, c.ac3, c.ac, c.g2, c.deep];
    for (let k = 0; k < 5; k++) {
      const y0 = H * (0.55 + k * 0.09), amp = 18 + k * 10; let d = `M0 ${H} L0 ${y0}`;
      for (let x = 0; x <= W; x += 40) d += ` L${x} ${(y0 + Math.sin(x / (140 + k * 30) + k * 1.3) * amp + Math.sin(x / 61 + k) * amp * 0.3) | 0}`;
      o += `<path d="${d} L${W} ${H}Z" fill="${cols[k]}" opacity="${[0.35, 0.45, 0.4, 0.85, 1][k]}"/>`;
    }
    return `<defs>${sky(c, 's', [[0, c.g4], [0.55, c.g2], [0.62, c.ac3]])}${glow('m', c.ac2, 0.45)}</defs>
      <rect width="${W}" height="${H}" fill="url(#s)"/>${stars(rng(8), 100, c.fg, H * 0.5)}
      <circle cx="1300" cy="470" r="330" fill="url(#m)"/><circle cx="1300" cy="470" r="120" fill="${c.ac2}" opacity=".45"/>${o}`;
  },
  // disco de vinilo
  vinilo(c) {
    let g = ''; for (let i = 0; i < 34; i++) g += `<circle cx="1380" cy="560" r="${180 + i * 12}" fill="none" stroke="${c.fg}" stroke-opacity="${i % 3 ? 0.04 : 0.09}"/>`;
    return `<defs>${sky(c, 's', [[0, c.g2], [1, c.g4]])}${glow('a', c.ac, 0.5)}${glow('b', c.sec, 0.35)}</defs>
      <rect width="${W}" height="${H}" fill="url(#s)"/><circle cx="380" cy="260" r="600" fill="url(#b)"/><circle cx="1380" cy="560" r="760" fill="url(#a)"/>
      <circle cx="1380" cy="560" r="600" fill="${c.g4}"/>${g}<circle cx="1380" cy="560" r="160" fill="${c.ac}" opacity=".85"/>
      <circle cx="1380" cy="560" r="150" fill="none" stroke="${c.ac2}" stroke-opacity=".5" stroke-width="3"/><circle cx="1380" cy="560" r="14" fill="${c.g4}"/>
      <path d="M1000 300 A 520 520 0 0 1 1300 160" stroke="${c.fg}" stroke-opacity=".12" stroke-width="40" fill="none" stroke-linecap="round"/>`;
  },
  // espacio: planeta con anillos
  cosmos(c) {
    return `<defs>${sky(c, 's', [[0, c.g4], [1, c.g1]])}${glow('n1', c.ac, 0.4)}${glow('n2', c.sec, 0.35)}${sky(c, 'p', [[0, c.ac2], [1, c.ac3]])}</defs>
      <rect width="${W}" height="${H}" fill="url(#s)"/><ellipse cx="500" cy="700" rx="900" ry="500" fill="url(#n1)"/><ellipse cx="1500" cy="250" rx="700" ry="420" fill="url(#n2)"/>
      ${stars(rng(13), 260, c.fg)}
      <path d="M910 640 A430 90 0 0 1 1770 640" stroke="${c.ac2}" stroke-opacity=".3" stroke-width="22" fill="none" transform="rotate(-18 1340 640)"/>
      <circle cx="1340" cy="640" r="230" fill="url(#p)"/><circle cx="1290" cy="590" r="225" fill="${c.g4}" opacity=".3"/>
      <path d="M910 640 A430 90 0 0 0 1770 640" stroke="${c.ac2}" stroke-opacity=".55" stroke-width="22" fill="none" transform="rotate(-18 1340 640)"/>`;
  },
  // bosque de pinos de noche
  bosque(c) {
    const r = rng(31); let t = '';
    for (const [base, sz, col, a] of [[H * 0.72, 140, c.ac3, 0.35], [H * 0.86, 200, c.g2, 0.8], [H * 1.02, 280, c.deep, 1]]) {
      for (let x = -40; x < W + 60; x += sz * (0.45 + r() * 0.35)) {
        const h = sz * (1.6 + r() * 1.4), w = h * 0.36; let d = '';
        for (let k = 0; k < 4; k++) { const ty = base - h + k * h * 0.2, bw = w * (0.45 + k * 0.2); d += `M${x | 0} ${ty | 0} L${(x - bw) | 0} ${(ty + h * 0.32) | 0} L${(x + bw) | 0} ${(ty + h * 0.32) | 0}Z `; }
        t += `<path d="${d}" fill="${col}" opacity="${a}"/><rect x="${(x - 6) | 0}" y="${(base - h * 0.2) | 0}" width="12" height="${(H - base + h * 0.2) | 0}" fill="${col}" opacity="${a}"/>`;
      }
    }
    return `<defs>${sky(c, 's', [[0, c.g4], [0.7, c.g2], [1, c.g1]])}${glow('m', c.ac2, 0.4)}${sky(c, 'f', [[0, c.sec, 0], [1, c.sec, 0.25]])}</defs>
      <rect width="${W}" height="${H}" fill="url(#s)"/>${stars(rng(6), 120, c.fg, H * 0.5)}
      <circle cx="1450" cy="300" r="300" fill="url(#m)"/><circle cx="1450" cy="300" r="95" fill="${c.ac2}" opacity=".55"/>
      ${t}<rect y="${H * 0.6}" width="${W}" height="${H * 0.4}" fill="url(#f)"/>`;
  },
  // degradado suave abstracto
  mesh(c) {
    return `<defs>${glow('a', c.ac, 0.7)}${glow('b', c.sec, 0.55)}${glow('d', c.ac2, 0.4)}${glow('e', c.ac3, 0.6)}</defs>
      <rect width="${W}" height="${H}" fill="${c.g4}"/><circle cx="300" cy="250" r="900" fill="url(#e)"/><circle cx="1600" cy="300" r="800" fill="url(#b)"/>
      <circle cx="1100" cy="900" r="850" fill="url(#a)"/><circle cx="700" cy="600" r="500" fill="url(#d)"/>`;
  },
};

// ---------- galería: fijos y animados (escena + efecto en vivo de bgfx.js) ----------
export const GALLERY = [
  { id: 'sakura', name: 'lluvia de pétalos', scene: 'petalos', fx: 'sakura' },
  { id: 'synth', name: 'synthwave', scene: 'atardecer', opts: { grid: false }, fx: 'grid' },
  { id: 'luciernagas', name: 'luciérnagas', scene: 'bosque', fx: 'fireflies' },
  { id: 'boreal', name: 'aurora boreal', scene: 'montanas', fx: 'aurora' },
  { id: 'lluvia', name: 'noche de lluvia', scene: 'ciudad', fx: 'drizzle' },
  { id: 'nevada', name: 'nevada', scene: 'montanas', fx: 'snow' },
  { id: 'espacio', name: 'viaje espacial', scene: 'cosmos', fx: 'stars' },
  { id: 'burbujas', name: 'burbujas', scene: 'mesh', fx: 'bokeh' },
  { id: 'petalos', name: 'cerezo', scene: 'petalos' },
  { id: 'montanas', name: 'montañas', scene: 'montanas' },
  { id: 'atardecer', name: 'atardecer', scene: 'atardecer' },
  { id: 'ciudad', name: 'ciudad', scene: 'ciudad' },
  { id: 'olas', name: 'mar', scene: 'olas' },
  { id: 'bosque', name: 'bosque', scene: 'bosque' },
  { id: 'cosmos', name: 'planeta', scene: 'cosmos' },
  { id: 'vinilo', name: 'vinilo', scene: 'vinilo' },
  { id: 'mesh', name: 'degradado', scene: 'mesh' },
];
const byId = (id) => GALLERY.find((g) => g.id === id);

const cache = new Map();
export function sceneUrl(g, colors = themeColors()) {
  const k = g.id + JSON.stringify(colors);
  if (cache.has(k)) return cache.get(k);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice">${SCENES[g.scene](colors, g.opts || {})}</svg>`;
  const url = 'data:image/svg+xml,' + encodeURIComponent(svg.replace(/\s+/g, ' '));
  if (cache.size > 40) cache.clear();
  cache.set(k, url);
  return url;
}

// qué fondo incluido corresponde (null = el propio subido, o solo el tema)
// pick: 'auto' (el propio si hay; si no, el de fábrica) · 'mine' · 'none' · id de la galería
export function activeBuiltin(hasOwn) {
  const p = C().wpPick || 'auto';
  if (p === 'none') return null;
  if (p === 'auto' || p === 'mine') return hasOwn ? null : byId(DEFAULT_PICK);
  return byId(p) || (hasOwn ? null : byId(DEFAULT_PICK));
}
export function ownHidden(hasOwn) { const p = C().wpPick || 'auto'; return hasOwn && p !== 'auto' && p !== 'mine'; }

// ---------- ventana de la galería ----------
export function tilesHtml(hasOwn) {
  const p = C().wpPick || 'auto';
  const cur = p === 'none' ? 'none' : activeBuiltin(hasOwn) ? activeBuiltin(hasOwn).id : 'mine';
  const tile = (g) => `<button class="wpt ${cur === g.id ? 'on' : ''}" data-wp="${g.id}" title="${esc(g.name)}"><i style="background-image:url(&quot;${sceneUrl(g)}&quot;)"></i>${g.fx ? '<em>✺ animado</em>' : ''}<span>${esc(g.name)}</span></button>`;
  return `<div class="wpg">
      ${hasOwn ? `<button class="wpt ${cur === 'mine' ? 'on' : ''}" data-wp="mine"><i class="own" style="background-image:url(/wallpaper?t=${Date.now()})"></i><span>el mío</span></button>` : ''}
      ${GALLERY.filter((g) => g.fx).map(tile).join('')}${GALLERY.filter((g) => !g.fx).map(tile).join('')}
      <button class="wpt ${cur === 'none' ? 'on' : ''}" data-wp="none"><i class="none"></i><span>solo el tema</span></button>
    </div>`;
}
export function bindTiles(box, after) {
  box.querySelectorAll('[data-wp]').forEach((b) => (b.onclick = () => {
    setC('wpPick', b.dataset.wp);
    box.querySelectorAll('[data-wp]').forEach((x) => x.classList.toggle('on', x === b));
    const g = byId(b.dataset.wp);
    if (g && g.fx && C().bgFx !== 'none') toast('ojo: tenés un fondo animado elegido aparte', { sub: 'ajustes → personalizar → fondo animado → "ninguno" para ver la animación de este fondo' });
    if (after) after(b.dataset.wp);
  }));
}
export async function openGallery({ upload } = {}) {
  let hasOwn = false;
  try { hasOwn = !!(await api.get('/api/wallpaper')).has; } catch {}
  return modal({
    title: '❀ fondos de pantalla', wide: true,
    html: `<div class="m" style="margin-bottom:8px">Se pintan con los colores de tu tema. Los <b>✺ animados</b> se mueven solos (y laten con la música); en <i>máximo rendimiento</i> quedan quietos.</div>${tilesHtml(hasOwn)}
      <label class="wpmfx"><input type="checkbox" id="wgMfx" ${C().mfxOn ? 'checked' : ''}> <span><b>efectos con la música</b> · el fondo tiembla y late con los golpes (más opciones en ajustes → personalizar)</span></label>`,
    onOpen: (box) => { bindTiles(box); const m = box.querySelector('#wgMfx'); if (m) m.onchange = () => setC('mfxOn', m.checked); },
    actions: [
      ...(upload ? [{ label: 'subir el mío (imagen, GIF o video)', fn: () => { upload(); return true; } }] : []),
      { label: 'listo', primary: true, value: true },
    ],
  });
}
export async function fillGalleryRow(el) {
  if (!el) return;
  let hasOwn = false;
  try { hasOwn = !!(await api.get('/api/wallpaper')).has; } catch {}
  el.innerHTML = tilesHtml(hasOwn);
  bindTiles(el);
}
