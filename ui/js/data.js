// datos compartidos de la biblioteca (pistas locales + pistas online de YouTube Music, reproducciones, playlists)
import { api, bus, norm, local, debounce } from './core.js';

export const D = { tracks: [], byId: new Map(), remote: new Map(), plays: {}, playlists: [], auto: [], folders: [], scan: null };
export const T = (id) => D.byId.get(id) || D.remote.get(id);
export const mainArtist = (t) => (t.albumArtist || t.artist || '').split(/\s*(?:,|&| feat\.? | ft\.? | x )\s*/i)[0].trim() || 'desconocido';
export const trackLabel = (t) => (t.artist ? `${t.artist} — ${t.title}` : t.title);

// ---------- pistas online (YouTube Music, sin descargar) ----------
// se guardan en caché local para que la cola y la reanudación funcionen al abrir el programa
for (const t of local.get('pw-remote', []) || []) if (t && t.id) D.remote.set(t.id, t);
const saveRemote = debounce(() => local.set('pw-remote', [...D.remote.values()].slice(-3000)), 1000);
export function remoteTrack(it) {
  const id = 'yt_' + it.videoId;
  const artist = (it.artists || []).filter(Boolean).join(', ');
  const t = {
    id, remote: true, ytId: it.videoId, title: it.title || '', artist, albumArtist: '', album: it.album || '',
    duration: it.duration || 0, ext: 'online', bitrate: 0, video: false, hasCover: true, added: 0, name: it.title || '',
    genre: '', year: null, trackNo: null, available: it.available !== false,
    // videoclips (OMV) y videos subidos (UGC) cuentan como video, para poder ocultarlos
    vtype: it.type || '', isVideo: /MUSIC_VIDEO_TYPE_(OMV|UGC)|^video$/i.test(it.type || ''),
  };
  t._s = norm([t.title, t.artist, t.album].join(' '));
  t._a = mainArtist(t);
  D.remote.set(id, t);
  saveRemote();
  return t;
}
export const ytm = { status: null, playlists: null, lists: new Map(), loading: new Set() };
export async function loadYtmPlaylists() {
  try { ytm.playlists = (await api.get('/api/ytm/playlists')).items; } catch { ytm.playlists = null; }
  bus.emit('ytm:nav');
}
// trae una lista de tu cuenta: lo que ya tenés suena desde el archivo, lo demás online
export async function loadYtmList(key, force) {
  const have = ytm.lists.get(key);
  if (!force && have && Date.now() - have.at < 5 * 60e3) return have;
  if (ytm.loading.has(key)) return have;
  ytm.loading.add(key);
  bus.emit('ytm:list', key);
  try {
    const r = await api.get(key === 'liked' ? '/api/ytm/liked' : '/api/ytm/playlist/' + encodeURIComponent(key));
    const ids = (r.tracks || []).filter((it) => it.videoId).map((it) => {
      const loc = it.local && D.byId.get(it.local) ? it.local : (D.tracks.find((t) => t.ytId === it.videoId) || {}).id;
      return loc || remoteTrack(it).id;
    });
    const l = { ids, at: Date.now(), title: key === 'liked' ? 'Me gusta' : r.title, thumb: r.thumb, error: null };
    ytm.lists.set(key, l);
    return l;
  } catch (e) {
    ytm.lists.set(key, { ids: have ? have.ids : [], at: Date.now(), error: e.message, title: have ? have.title : '' });
  } finally { ytm.loading.delete(key); bus.emit('ytm:list', key); }
  return ytm.lists.get(key);
}

export async function loadLibrary() {
  const j = await api.get('/api/library');
  for (const t of j.tracks) {
    t._s = norm([t.title, t.artist, t.album, t.albumArtist, t.genre, t.name, t.year].filter(Boolean).join(' '));
    t._a = mainArtist(t);
  }
  D.tracks = j.tracks;
  D.byId = new Map(j.tracks.map((t) => [t.id, t]));
  D.plays = j.plays || {};
  D.folders = j.folders || [];
  D.scan = j.scan;
  // si una canción online ya se descargó, las listas pasan a usar el archivo local
  const byYt = new Map(j.tracks.filter((t) => t.ytId).map((t) => [t.ytId, t.id]));
  for (const l of ytm.lists.values()) l.ids = l.ids.map((id) => (id.startsWith('yt_') && byYt.get(id.slice(3))) || id);
  bus.emit('lib:loaded');
}
export async function loadPlaylists() {
  const j = await api.get('/api/playlists');
  D.playlists = j.items;
  bus.emit('pl:loaded');
}
export async function loadAuto() {
  try { D.auto = (await api.get('/api/autoplaylists')).items; } catch { D.auto = []; }
  bus.emit('auto:loaded');
}
export async function plOp(body) {
  const r = await api.post('/api/playlists', body);
  await loadPlaylists();
  return r;
}
