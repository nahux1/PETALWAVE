// conexiones: Discord ("Escuchando …" en tu perfil, solo Windows) y Last.fm (registra lo que escuchás, PC y celular).
import { P, api, bus, toast, local, isRemote } from './core.js';
import { engine } from './audio.js';
import * as player from './player.js';
import { md5 } from './md5.js';

const isAndroid = !!window.PetalwaveNative;
const clean = (s) => String(s || '').replace(/\s*[([][^)\]]*(official|video|audio|lyric|letra|visuali[sz]er|music video|\bmv\b|\bhd\b|4k|remaster|clip)[^)\]]*[)\]]/gi, '').trim();
const firstArtist = (t) => (t.albumArtist || t.artist || '').split(/\s*(?:,|&| feat\.? | ft\.? | x )\s*/i)[0].trim();

// ======================= Discord =======================
let presT = 0, lastPres = '';
function presence() {
  if (isAndroid) return;
  clearTimeout(presT);
  presT = setTimeout(() => {
    const on = P.get('discord') === true;
    const t = player.current();
    let a = null;
    if (on && t && engine.active) {
      const dur = engine.duration || t.duration || 0, now = Date.now(), pos = engine.time || 0;
      a = { title: clean(t.title) || t.title, artist: t.artist, album: t.album, ytId: t.ytId || (isRemote(t.id) ? t.id.slice(3) : ''), paused: engine.paused };
      if (!a.paused && dur > 0) { a.start = now - pos * 1000; a.end = a.start + dur * 1000; }
    }
    const key = JSON.stringify(a && { ...a, start: a.start && Math.round(a.start / 3000), end: a.end && Math.round(a.end / 3000) });
    if (key === lastPres) return;
    lastPres = key;
    api.post('/api/presence', { activity: a }).catch(() => {});
  }, 700);
}
export async function discordStatus() { try { return await api.get('/api/discord'); } catch { return { connected: false }; } }
export async function setDiscord(on, clientId) {
  if (clientId !== undefined) P.set('discordId', clientId.trim());
  P.set('discord', !!on);
  await api.post('/api/discord/config', { enabled: !!on, clientId: P.get('discordId') || '' }).catch(() => {});
  lastPres = ''; presence();
}

// ======================= Last.fm =======================
const LFM = 'https://ws.audioscrobbler.com/2.0/';
const lf = () => P.get('lastfm') || {};
export const lastfmUser = () => lf().user || '';
function sign(params, secret) {
  const keys = Object.keys(params).filter((k) => k !== 'format' && k !== 'callback').sort();
  return md5(keys.map((k) => k + params[k]).join('') + secret);
}
async function call(method, params = {}, { post = true, signed = true } = {}) {
  const c = lf();
  if (!c.key || (signed && !c.secret)) throw new Error('falta la clave de Last.fm');
  const p = { method, api_key: c.key, ...params };
  if (signed && c.sk && method !== 'auth.getToken' && method !== 'auth.getSession') p.sk = c.sk;
  if (signed) p.api_sig = sign(p, c.secret);
  p.format = 'json';
  const body = new URLSearchParams(p);
  const r = await fetch(post ? LFM : LFM + '?' + body, post ? { method: 'POST', body, signal: AbortSignal.timeout(12000) } : { signal: AbortSignal.timeout(12000) });
  const j = await r.json().catch(() => ({}));
  if (j.error) { const e = new Error(j.message || 'error de Last.fm ' + j.error); e.code = j.error; throw e; }
  return j;
}

// conectar: Last.fm abre una página para que autorices; Petalwave espera hasta que lo hagas (2 minutos)
export async function lastfmConnect(key, secret) {
  P.set('lastfm', { key: key.trim(), secret: secret.trim() });
  const { token } = await call('auth.getToken', {}, { post: false });
  window.open(`https://www.last.fm/api/auth/?api_key=${encodeURIComponent(key.trim())}&token=${encodeURIComponent(token)}`, '_blank');
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    try {
      const j = await call('auth.getSession', { token }, { post: false });
      if (j.session && j.session.key) { P.set('lastfm', { ...lf(), sk: j.session.key, user: j.session.name }); return j.session.name; }
    } catch (e) { if (e.code !== 14) throw e; }   // 14 = todavía no autorizaste
  }
  throw new Error('no se autorizó a tiempo: probá de nuevo');
}
export function lastfmDisconnect() { const c = lf(); P.set('lastfm', { key: c.key, secret: c.secret }); }

// reglas de Last.fm: canción de más de 30 s, escuchada la mitad o 4 minutos (lo que pase primero)
const QKEY = 'pw-scrobble-queue';
let sess = null;
function startSession(t) {
  sess = null;
  if (!t || !lf().sk || P.get('lastfmOn') === false) return;
  sess = { t, at: Math.floor(Date.now() / 1000), sec: 0, done: false };
  const artist = firstArtist(t), track = clean(t.title) || t.title;
  if (artist && track) call('track.updateNowPlaying', { artist, track, ...(t.album ? { album: t.album } : {}), ...(t.duration ? { duration: Math.round(t.duration) } : {}) }).catch(() => {});
}
setInterval(() => {
  if (!sess || sess.done || engine.paused) return;
  const c = player.current();
  if (!c || c.id !== sess.t.id) return;
  sess.sec++;
  const dur = engine.duration || sess.t.duration || 0;
  if (dur > 30 && sess.sec >= Math.min(dur / 2, 240)) { sess.done = true; scrobble(sess.t, sess.at); }
}, 1000);
async function scrobble(t, at) {
  const q = local.get(QKEY, []) || [];
  q.push({ artist: firstArtist(t), track: clean(t.title) || t.title, album: t.album || '', duration: Math.round(t.duration || 0), timestamp: at });
  local.set(QKEY, q.slice(-500));
  flush();
}
let flushing = false;
async function flush() {
  if (flushing || !lf().sk) return;
  flushing = true;
  try {
    let q = local.get(QKEY, []) || [];
    while (q.length) {
      const part = q.slice(0, 50), p = {};
      part.forEach((s, i) => { p[`artist[${i}]`] = s.artist; p[`track[${i}]`] = s.track; p[`timestamp[${i}]`] = s.timestamp; if (s.album) p[`album[${i}]`] = s.album; if (s.duration) p[`duration[${i}]`] = s.duration; });
      try { await call('track.scrobble', p); }
      catch (e) { if (e.code === 9) { toast('Last.fm: se venció la sesión, conectalo de nuevo en ajustes', { kind: 'warn' }); lastfmDisconnect(); } break; }   // sin internet: queda guardado
      q = (local.get(QKEY, []) || []).slice(part.length);
      local.set(QKEY, q);
    }
  } finally { flushing = false; }
}
export const pendingScrobbles = () => (local.get(QKEY, []) || []).length;
export async function lastfmLove(t, on) {
  if (!lf().sk || !t) return;
  try { await call(on ? 'track.love' : 'track.unlove', { artist: firstArtist(t), track: clean(t.title) || t.title }); } catch {}
}

export function initIntegrations() {
  bus.on('np', (t) => { presence(); startSession(t); });
  bus.on('eng:state', (s) => { if (s !== 'wait') presence(); });
  bus.on('eng:seek', presence);
  bus.on('like', (d) => { if (d && d.id) import('./data.js').then(({ T }) => lastfmLove(T(d.id), d.on)); });
  if (!isAndroid && P.get('discord') === true) api.post('/api/discord/config', { enabled: true, clientId: P.get('discordId') || '' }).catch(() => {});
  setInterval(flush, 5 * 60e3);
  setTimeout(flush, 15000);
}
