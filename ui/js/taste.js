// ❀ gustos y recomendaciones de Petalwave (el mismo algoritmo en Windows y Android)
//
// 1. Señales: cada vez que escuchás algo se guarda una "señal" (data/taste.json):
//    escuchada entera +1 · más de la mitad +0.5 · saltada en los primeros segundos −1 · me gusta +3 ·
//    quitar me gusta −2 · agregar a una playlist +1.5 · "no me interesa" −3.
//    Las señales pierden la mitad de su peso cada 45 días: lo que escuchás ahora pesa más.
// 2. Perfil: cada señal suma (o resta) a los rasgos de la canción: artista, artistas invitados, género,
//    estilo (slowed, phonk, remix, lofi…) y década. Así sabe que te gusta "Artista X" o "lo slowed",
//    aunque nunca hayas escuchado esa canción puntual.
// 3. Puntaje: cada canción candidata se puntúa con tu perfil, más lo que ya sabe de esa canción,
//    menos si la escuchaste hace muy poco, con un poco de azar del día para descubrir cosas nuevas,
//    y sin repetir mucho el mismo artista.
// 4. Candidatas: tu biblioteca ("para vos") y, con YouTube Music, las radios de tus canciones favoritas
//    y lo más escuchado de tus artistas ("descubrí": canciones nuevas que no tenés).
import { api, bus, norm, local, debounce } from './core.js';
import { D, T, remoteTrack, mainArtist } from './data.js';

const DAY = 864e5;
const HALF_LIFE = 45 * DAY;
// pesos de cada rasgo; el estilo pesa bastante porque en bibliotecas bajadas de YouTube casi cada canción es de un artista distinto,
// y la década poco: el "año" de un video suele ser el de subida, no el de la música
const W = { artist: 1, feat: 0.45, genre: 0.5, tag: 0.6, decade: 0.05, own: 0.9 };
// estilos que se reconocen en el título (y en el género)
const TAGS = ['slowed', 'reverb', 'sped up', 'speed up', 'nightcore', 'phonk', 'remix', 'lofi', 'lo-fi', 'acoustic', 'acustico', 'live', 'en vivo',
  'cover', 'instrumental', '8d', 'edit', 'funk', 'trap', 'drill', 'reggaeton', 'cumbia', 'rkt', 'techno', 'house', 'mashup', 'bass boosted', 'ost',
  'anime', 'opening', 'rock', 'metal', 'jazz', 'piano', 'synthwave', 'vaporwave', 'hardstyle', 'dubstep', 'kpop', 'k-pop', 'corrido', 'bachata', 'salsa'];

let events = [];
let pending = [];
let loaded = false;
let prof = null;            // perfil calculado (se invalida con cada señal nueva)

// ---------- rasgos de una canción ----------
const splitArtists = (s) => String(s || '').split(/\s*(?:,|&|;|\/| feat\.? | ft\.? | x | y | with )\s*/i).map((a) => norm(a).trim()).filter(Boolean);
export function features(t) {
  const arts = splitArtists(t.artist || t.a);
  const main = norm(t._a || (t.artist ? mainArtist(t) : arts[0] || '')).trim();
  const text = ' ' + norm([t.title || t.ti, t.genre || t.g, t.album].join(' ')).replace(/[()[\]{}|·\-_.]/g, ' ') + ' ';
  const tags = TAGS.filter((w) => text.includes(' ' + w + ' ')).map((w) => w.replace(/[\s-]/g, ''));
  const g = norm(String(t.genre || t.g || '').split(/[;,/]/)[0]).trim();
  const y = +(t.year || t.y) || 0;
  return { main, feats: arts.filter((a) => a !== main).slice(0, 3), genre: g, tags: [...new Set(tags)], decade: y > 1900 ? Math.floor(y / 10) * 10 : 0 };
}
// la misma canción local u online se reconoce por su id de YouTube si lo tiene
const keyOf = (t) => (t && (t.ytId || t.yt)) ? 'yt:' + (t.ytId || t.yt) : t && t.id ? 'id:' + t.id : '';
const titleKey = (t) => norm(mainArtist(t) + ' ' + String(t.title || '').replace(/\(.*?\)|\[.*?\]/g, '')).replace(/\s+/g, ' ').trim();

// ---------- señales ----------
export async function loadTaste() {
  try { events = (await api.get('/api/taste')).events || []; } catch { events = []; }
  loaded = true; prof = null;
  bus.emit('taste');
}
const flush = debounce(() => {
  if (!pending.length) return;
  const batch = pending.splice(0, pending.length);
  api.post('/api/taste', { events: batch }).catch(() => { pending.unshift(...batch); });
}, 1500);
addEventListener('pagehide', () => { if (pending.length) try { navigator.sendBeacon('/api/taste', new Blob([JSON.stringify({ events: pending })], { type: 'application/json' })); pending = []; } catch {} });

export function signal(kind, t, extra = {}) {
  if (!t) return;
  const e = { t: Date.now(), k: kind, id: t.id, yt: t.ytId || undefined, a: t.artist || '', ti: t.title || '', g: t.genre || '', y: t.year || undefined, ...extra };
  events.push(e); pending.push(e);
  if (events.length > 6000) events.splice(0, events.length - 6000);
  prof = null;
  flush();
  bus.emit('taste');
}
// al terminar o cambiar de canción (lo llama el reproductor con los segundos que de verdad sonó)
export function onListen(t, sec, completed) {
  if (!t || !(sec > 0)) return;
  const d = t.duration || 0;
  const r = d ? sec / d : 0;
  if (completed || r >= 0.5 || sec >= 60) signal('play', t, { s: Math.round(sec), d: Math.round(d) });
  else if (sec < 30) signal('skip', t, { s: Math.round(sec), d: Math.round(d) });
}

function weightOf(e) {
  switch (e.k) {
    case 'play': { const r = e.d ? e.s / e.d : 1; return r >= 0.8 || (e.d && e.s >= e.d - 10) ? 1 : r >= 0.5 ? 0.5 : 0.25; }
    case 'skip': return e.s != null && e.s < 10 ? -1 : -0.6;
    case 'like': return 3;
    case 'unlike': return -2;
    case 'pl': return 1.5;
    case 'nope': return -3;
    default: return 0;
  }
}

// ---------- perfil ----------
export function profile() {
  if (prof) return prof;
  const now = Date.now();
  const aff = new Map();      // rasgo → peso
  const own = new Map();      // canción → peso
  const lastPlay = new Map(); // canción → última vez que sonó
  const nope = new Set();
  const add = (k, v) => aff.set(k, (aff.get(k) || 0) + v);
  const feed = (src, w) => {
    const f = features(src);
    if (f.main) add('a:' + f.main, w * W.artist);
    for (const a of f.feats) add('a:' + a, w * W.feat);
    if (f.genre) add('g:' + f.genre, w * W.genre);
    for (const x of f.tags) add('t:' + x, w * W.tag / Math.max(1, f.tags.length / 2));
    if (f.decade) add('d:' + f.decade, w * W.decade);
  };
  // punto de partida: reproducciones viejas y tus "me gusta" (de antes de que existieran las señales)
  const liked = D.playlists.find((p) => p.id === 'liked');
  const seen = new Set(events.map((e) => (e.yt ? 'yt:' + e.yt : 'id:' + e.id)));
  for (const [id, n] of Object.entries(D.plays || {})) {
    const t = T(id); if (!t || !n || seen.has(keyOf(t))) continue;
    const w = 0.35 * Math.log1p(n);
    feed(t, w); own.set(keyOf(t), (own.get(keyOf(t)) || 0) + w);
  }
  for (const id of (liked ? liked.tracks : [])) {
    const t = T(id); if (!t || seen.has(keyOf(t))) continue;
    feed(t, 2); own.set(keyOf(t), (own.get(keyOf(t)) || 0) + 2);
  }
  // señales, con olvido gradual
  for (const e of events) {
    const w = weightOf(e) * Math.pow(0.5, (now - e.t) / HALF_LIFE);
    if (!w) continue;
    const k = e.yt ? 'yt:' + e.yt : 'id:' + e.id;
    feed({ artist: e.a, title: e.ti, genre: e.g, year: e.y }, w);
    own.set(k, (own.get(k) || 0) + w);
    if (e.k === 'play' || e.k === 'skip') lastPlay.set(k, Math.max(lastPlay.get(k) || 0, e.t));
    if (e.k === 'nope') nope.add(k); else if (e.k === 'like') nope.delete(k);
  }
  const sq = (x) => x / (1 + Math.abs(x));   // aplasta a −1…1: 1 escucha no pesa como 50, pero 50 pesan más
  const A = new Map([...aff].map(([k, v]) => [k, sq(v / 2)]));
  const O = new Map([...own].map(([k, v]) => [k, sq(v / 2)]));
  const top = (pfx, n) => [...A].filter(([k, v]) => k.startsWith(pfx) && v > 0.15).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => ({ name: k.slice(2), v }));
  const positives = [...O].filter(([, v]) => v > 0).length;
  prof = { A, O, lastPlay, nope, positives, signals: events.length, topArtists: top('a:', 8), topGenres: top('g:', 5), topTags: top('t:', 5) };
  return prof;
}

// nombre "lindo" de un artista del perfil (el que figura en tu biblioteca)
const prettyArtist = (n) => { const t = D.tracks.find((x) => norm(x._a) === n) || [...D.remote.values()].find((x) => norm(x._a) === n); return t ? t._a : n; };

// ---------- puntaje ----------
// azar estable durante el día (la lista no cambia en cada clic, pero sí de un día a otro)
const dayRand = (s) => { let h = 2166136261 ^ Math.floor(Date.now() / DAY); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return ((h >>> 0) % 1000) / 1000; };
export function score(t, p = profile()) {
  const f = features(t);
  const g = (k) => p.A.get(k) || 0;
  const parts = {
    artist: g('a:' + f.main) * W.artist,
    feat: f.feats.reduce((a, x) => Math.max(a, g('a:' + x)), 0) * W.feat,
    genre: f.genre ? g('g:' + f.genre) * W.genre : 0,
    // el estilo que más te gusta cuenta entero, los demás un poco
    tag: f.tags.length ? (() => { const v = f.tags.map((x) => g('t:' + x)).sort((a, b) => b - a); return (v[0] + 0.3 * v.slice(1).reduce((a, b) => a + b, 0)) * W.tag; })() : 0,
    decade: f.decade ? g('d:' + f.decade) * W.decade : 0,
    own: (p.O.get(keyOf(t)) || 0) * W.own,
  };
  let s = Object.values(parts).reduce((a, b) => a + b, 0);
  return { s, parts, f };
}
function reason(t, r) {
  const { parts, f } = r;
  const best = Object.entries(parts).filter(([k, v]) => v > 0.08 && k !== 'decade').sort((a, b) => b[1] - a[1])[0];
  if (!best) return 'para descubrir algo distinto';
  switch (best[0]) {
    case 'own': return 'te gusta esta canción';
    case 'artist': return 'porque escuchás ' + prettyArtist(f.main);
    case 'feat': return 'con artistas que escuchás';
    case 'genre': return 'por tu gusto por ' + (t.genre || f.genre);
    case 'tag': return 'te gusta lo ' + f.tags[0];
    default: return '';
  }
}

// elige las mejores sin repetir mucho el mismo artista
function pick(scored, n, perArtist = 3) {
  scored.sort((a, b) => b.final - a.final);
  const out = [], cnt = new Map();
  for (const x of scored) {
    const a = x.f.main || '?';
    const c = cnt.get(a) || 0;
    if (c >= perArtist) continue;
    cnt.set(a, c + 1); out.push(x);
    if (out.length >= n) break;
  }
  return out;
}

// ---------- recomendaciones de tu biblioteca ----------
export function recsLocal(n = 40) {
  const p = profile();
  const now = Date.now();
  const scored = [];
  for (const t of D.tracks) {
    if (t.video || t.isVideo) continue;
    const k = keyOf(t);
    if (p.nope.has(k)) continue;
    const r = score(t, p);
    let fin = r.s;
    const last = p.lastPlay.get(k) || 0;
    if (now - last < DAY) fin -= 0.7;                 // la escuchaste hoy
    else if (now - last < 3 * DAY) fin -= 0.3;
    if (!(D.plays || {})[t.id] && !last) fin += 0.12;  // todavía no la escuchaste
    fin += (dayRand(t.id) - 0.5) * 0.3;                // un poco de azar para descubrir
    scored.push({ t, final: fin, f: r.f, why: reason(t, r) });
  }
  return pick(scored, n).filter((x) => x.final > -0.3).map((x) => ({ id: x.t.id, why: x.why, score: x.final }));
}

// ---------- descubrir en YouTube Music (canciones que no tenés) ----------
const CACHE_KEY = 'pw-discover';
let discovering = null;
export function cachedDiscover() { const c = local.get(CACHE_KEY, null); return c && Date.now() - c.at < 6 * 3600e3 ? c : null; }
export async function recsOnline({ force = false, n = 40 } = {}) {
  if (!force) { const c = cachedDiscover(); if (c) { for (const it of c.items) if (!T('yt_' + it.videoId)) remoteTrack(it); return c; } }
  if (discovering) return discovering;
  discovering = (async () => {
    const p = profile();
    const have = new Set(), haveTitle = new Set();
    for (const t of D.tracks) { if (t.ytId) have.add(t.ytId); haveTitle.add(titleKey(t)); }
    const recent = new Set(events.filter((e) => Date.now() - e.t < 7 * DAY && e.yt).map((e) => e.yt));
    // semillas: tus canciones con mejor puntaje propio que tengan id de YouTube (un poco al azar entre las mejores)
    const seedPool = [...p.O].filter(([k, v]) => k.startsWith('yt:') && v > 0.2).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k]) => k.slice(3));
    for (const t of D.tracks) if (t.ytId && seedPool.length < 10 && (p.O.get('id:' + t.id) || 0) > 0.2 && !seedPool.includes(t.ytId)) seedPool.push(t.ytId);
    const seeds = seedPool.sort((a, b) => dayRand(a) - dayRand(b)).slice(0, 3);
    const artists = p.topArtists.slice(0, 3).map((a) => prettyArtist(a.name));
    const cand = new Map();
    const take = (items, src, w) => (items || []).forEach((it, i) => {
      if (!it || !it.videoId || it.isVideo || /MUSIC_VIDEO_TYPE_UGC/.test(it.type || '')) return;
      const c = cand.get(it.videoId) || { it, hits: 0, rank: 1, src: [] };
      c.hits += w; c.rank = Math.min(c.rank, i / 50); c.src.push(src); cand.set(it.videoId, c);
    });
    const jobs = [
      ...seeds.map((v) => api.get('/api/ytm/radio/' + v).then((r) => take(r.tracks || r.items, 'radio', 1)).catch(() => {})),
      ...artists.map((a) => api.get('/api/ytm/search?filter=songs&q=' + encodeURIComponent(a)).then((r) => take((r.items || []).slice(0, 15), 'artista', 0.7)).catch(() => {})),
    ];
    await Promise.all(jobs);
    const scored = [];
    for (const [vid, c] of cand) {
      if (have.has(vid) || recent.has(vid) || seeds.includes(vid) || p.nope.has('yt:' + vid)) continue;
      const t = T('yt_' + vid) || remoteTrack(c.it);
      if (haveTitle.has(titleKey(t))) continue;          // ya la tenés (otra subida de la misma canción)
      const r = score(t, p);
      const fin = r.s + 0.25 * Math.log1p(c.hits) + 0.2 * (1 - c.rank) + (dayRand(vid) - 0.5) * 0.25;
      scored.push({ t, final: fin, f: r.f, why: r.parts.artist > 0.1 ? reason(t, r) : c.src.includes('radio') ? 'parecida a lo que escuchás' : reason(t, r), it: c.it });
    }
    const best = pick(scored, n, 2);
    const out = { at: Date.now(), seeds, artists, items: best.map((x) => ({ ...x.it, why: x.why })) };
    local.set(CACHE_KEY, out);
    return out;
  })();
  try { return await discovering; } finally { discovering = null; }
}

// "no me interesa": baja ese tema y un poco a su artista; sale de las recomendaciones
export function nope(t) {
  signal('nope', t);
  const c = local.get(CACHE_KEY, null);
  if (c && t.ytId) { c.items = c.items.filter((x) => x.videoId !== t.ytId); local.set(CACHE_KEY, c); }
}

export const tasteReady = () => loaded;
export const tasteEvents = () => events;
