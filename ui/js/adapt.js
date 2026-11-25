// Petalwave se adapta a vos:
// 1) el look sigue a tu música: si un estilo pasa a dominar lo que escuchás, te sugiere (o pone solo) un tema y un
//    fondo que le quedan. Se decide con el mismo perfil de gustos que las recomendaciones (taste.js).
// 2) tus accesos: los lugares que más abrís (playlists, mixes, artistas, vistas) aparecen a un toque en Inicio.
// Todo se calcula en tu equipo.
import { P, bus, toast, debounce } from './core.js';
import { profile } from './taste.js';
import { setTheme } from './theme.js';
import { E as C, setC } from './custom.js';

// estilos que cambian el look (se buscan en tus estilos y géneros favoritos)
export const LOOKS = [
  { key: 'electro', name: 'phonk y electrónica', match: ['phonk', 'drill', 'trap', 'techno', 'house', 'bassboosted', 'edit', 'funk', 'hardstyle', 'hardtekk', 'tekk', 'dubstep', 'edm', 'electro', 'synthwave', 'gym', 'workout'], theme: 'cyberpunk', wp: 'synth', look: 'synthwave' },
  { key: 'chill', name: 'slowed, lofi y chill', match: ['slowed', 'reverb', 'lofi', 'spedup', 'speedup', 'nightcore', 'chill', 'sad', 'study', 'sleep', 'rain', 'vaporwave'], theme: 'midnight', wp: 'lluvia', look: 'noche de lluvia' },
  { key: 'latino', name: 'urbano y latino', match: ['reggaeton', 'rkt', 'cumbia', 'bachata', 'salsa', 'corrido', 'urbano', 'latin', 'dembow', 'cuarteto', 'merengue'], theme: 'blood', wp: 'sakura', look: 'lluvia de pétalos' },
  { key: 'rock', name: 'rock y metal', match: ['rock', 'metal', 'punk', 'grunge', 'alternative', 'alternativ', 'indie'], theme: 'dark', wp: 'espacio', look: 'viaje espacial' },
  { key: 'pop', name: 'pop', match: ['pop', 'kpop', 'dance', 'anime', 'opening'], theme: 'petal', wp: 'burbujas', look: 'burbujas' },
  { key: 'calma', name: 'acústico e instrumental', match: ['acoustic', 'acustico', 'instrumental', 'piano', 'jazz', 'classical', 'clasica', 'ambient', 'ost', 'orchestral', 'symphonic', 'folk'], theme: 'mono', wp: 'luciernagas', look: 'luciérnagas' },
];

// el estilo que domina hoy (o null si todavía no hay suficiente para saberlo)
export function dominantLook(p = profile()) {
  if (p.positives < 6) return null;
  const score = new Map();
  for (const [k, v] of p.A) {
    if (v <= 0 || !(k.startsWith('t:') || k.startsWith('g:'))) continue;
    const name = k.slice(2).replace(/[\s-]/g, '');
    for (const l of LOOKS) if (l.match.some((m) => name === m || name.includes(m))) score.set(l.key, (score.get(l.key) || 0) + v);
  }
  const best = [...score].sort((a, b) => b[1] - a[1]);
  if (!best.length || best[0][1] < 0.45) return null;
  if (best[1] && best[1][1] > best[0][1] * 0.85) return null;   // empate: mejor no cambiar nada
  return LOOKS.find((l) => l.key === best[0][0]);
}

const ST = () => P.get('adaptState') || {};
const setST = (o) => P.set('adaptState', { ...ST(), ...o });
const already = (l) => P.get('theme') === l.theme && C().wpPick === l.wp;

let pending = null;   // sugerencia para mostrar en Inicio
export const pendingLook = () => pending;

export function applyLook(l, { quiet = false } = {}) {
  const prev = { theme: P.get('theme'), wp: C().wpPick };
  setTheme(l.theme);
  // si subiste tu propio fondo, ese no se toca: cambia solo el tema
  if (C().wpPick !== 'mine') setC('wpPick', l.wp);
  setST({ last: l.key, at: Date.now() });
  pending = null;
  bus.emit('adapt');
  if (!quiet) toast(`look "${l.look}" ❀`, { sub: 'porque escuchás mucho ' + l.name, ms: 6000, action: { label: 'deshacer', fn: () => { setTheme(prev.theme); setC('wpPick', prev.wp); } } });
}
export function dismissLook() {
  if (pending) setST({ last: pending.key, at: Date.now() });
  pending = null;
  bus.emit('adapt');
}

function check() {
  const mode = C().adaptLook || 'suggest';
  if (mode === 'off') { pending = null; return; }
  const l = dominantLook();
  const st = ST();
  if (!l || l.key === st.last) return;
  if (already(l)) { setST({ last: l.key, at: Date.now() }); return; }
  // no cambiar el look más de una vez cada 3 días
  if (st.at && Date.now() - st.at < 3 * 86400000) return;
  if (mode === 'auto') return applyLook(l);
  if (!pending || pending.key !== l.key) { pending = l; bus.emit('adapt'); }
}

// ---------- tus accesos (lo que más abrís) ----------
// se anota cada vez que abrís una vista de la biblioteca; pesa más lo reciente
const NAMES = { recs: 'Recomendadas', disc: 'Descubrí', hist: 'Historial', recent: 'Recientes', songs: 'Canciones', artists: 'Artistas', albums: 'Álbumes', genres: 'Géneros', years: 'Años' };
export function recordNav(v, label) {
  if (!v || !v.type || v.type === 'dupes') return;
  const key = v.type + ':' + (typeof v.key === 'object' ? JSON.stringify(v.key) : v.key || '');
  const name = label || NAMES[v.type] || (typeof v.key === 'object' ? v.key.album : v.key) || v.type;
  const u = { ...(P.get('navUse') || {}) };
  for (const k of Object.keys(u)) u[k] = { ...u[k], n: u[k].n * 0.97 };   // lo viejo se va olvidando
  u[key] = { v, name: String(name).slice(0, 60), n: ((u[key] && u[key].n) || 0) + 1, at: Date.now() };
  const top = Object.entries(u).sort((a, b) => b[1].n - a[1].n).slice(0, 30);
  P.set('navUse', Object.fromEntries(top));
}
export function topNav(n = 6) {
  return Object.values(P.get('navUse') || {}).filter((x) => x.n >= 1.5).sort((a, b) => b.n - a.n).slice(0, n);
}

export function initAdapt() {
  const run = debounce(check, 4000);
  bus.on('taste', run);
  setTimeout(check, 6000);
}
