// descargas inteligentes: Petalwave baja solo tus favoritas para escuchar sin internet
// - qué baja: primero tus ♥ que todavía suenan online, después lo mejor de "descubrí" (según tus gustos)
// - cuándo: al abrir y cada 3 horas; en Android, por defecto solo con WiFi
// - cuánto: como mucho 10 por vez y hasta el límite que elijas (ajustes → descargas)
import { P, api, bus, toast, local } from './core.js';
import { D, T } from './data.js';
import { recsOnline } from './taste.js';

const DONE_KEY = 'pw-smartdl';      // videoIds que ya se bajaron solos (para respetar el límite)
const LAST_KEY = 'pw-smartdl-last';
const EVERY = 3 * 3600e3;
const PER_RUN = 10;
let running = false;

export function netType() {
  const nat = window.PetalwaveNative;
  try { if (nat && nat.net) return nat.net(); } catch {}
  return navigator.onLine === false ? 'sin' : 'wifi';
}
export const smartDone = () => local.get(DONE_KEY, []) || [];

export async function runSmartDl({ force = false } = {}) {
  if (running || !P.get('smartDl')) return { skipped: 'apagado' };
  if (!force && Date.now() - (local.get(LAST_KEY, 0) || 0) < EVERY) return { skipped: 'temprano' };
  const net = netType();
  if (net === 'sin') return { skipped: 'sin internet' };
  if (net === 'datos' && P.get('smartDlWifi') !== false) return { skipped: 'solo con WiFi' };
  running = true;
  try {
    local.set(LAST_KEY, Date.now());
    const done = new Set(smartDone());
    const max = +P.get('smartDlMax') || 50;
    const room = Math.min(PER_RUN, max - done.size);
    if (room <= 0) return { skipped: 'límite' };
    const have = new Set(D.tracks.map((t) => t.ytId).filter(Boolean));
    let queued = new Set();
    try { const j = await api.get('/api/downloads'); for (const x of [...(j.active || []), ...(j.history || [])].filter((x) => x.status !== 'error' && x.status !== 'cancelado')) { const m = /[?&]v=([\w-]{11})/.exec(x.url || ''); if (m) queued.add(m[1]); } } catch {}
    const want = [];
    const add = (vid) => { if (vid && !have.has(vid) && !done.has(vid) && !queued.has(vid) && !want.includes(vid)) want.push(vid); };
    // 1) tus me gusta que todavía son online
    const liked = D.playlists.find((p) => p.id === 'liked');
    for (const id of (liked ? liked.tracks : [])) { const t = T(id); if (t && t.remote) add(t.ytId); }
    // 2) lo mejor de "descubrí"
    if (want.length < room) { try { const r = await recsOnline(); for (const it of r.items.slice(0, 15)) add(it.videoId); } catch {} }
    const pick = want.slice(0, room);
    if (!pick.length) return { queued: 0 };
    const d = P.get('dl') || {};
    const format = d.format === 'mp4' || !d.format ? 'mp3' : d.format;
    await api.post('/api/downloads', { urls: pick.map((v) => 'https://music.youtube.com/watch?v=' + v), format, quality: format === 'mp3' ? d.quality || '320' : 'best', cookies: d.cookies || '' });
    for (const v of pick) done.add(v);
    local.set(DONE_KEY, [...done].slice(-2000));
    toast(`bajando ${pick.length} para escuchar sin internet ⇣`, { sub: 'descargas inteligentes · ajustes → descargas', ms: 2600 });
    bus.emit('smartdl', { queued: pick.length });
    return { queued: pick.length };
  } catch (e) { return { error: e.message }; }
  finally { running = false; }
}

export function initSmartDl() {
  setTimeout(() => runSmartDl(), 20e3);          // un rato después de abrir (que cargue todo primero)
  setInterval(() => runSmartDl(), 30 * 60e3);    // revisa cada media hora; baja cada 3 h como mucho
  bus.on('prefs', (k) => { if (k === 'smartDl' && P.get('smartDl')) runSmartDl({ force: true }); });
}
