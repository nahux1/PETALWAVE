// "me gusta" de petalwave: funciona siempre (PC y Android, con o sin cuenta) y se guarda en la playlist fija "Me gusta".
// Si hay sesión de YouTube Music y la canción viene de YouTube, también se marca ahí.
import { $$, bus, api, toast } from './core.js';
import { D, T, plOp } from './data.js';
import { current } from './player.js';
import { signal } from './taste.js';

let ytmAuth = false;
const likedList = () => D.playlists.find((p) => p.id === 'liked');
export const isLiked = (id) => { const l = likedList(); return !!(l && id && l.tracks.includes(id)); };

export async function toggleLike(id, on) {
  const t = T(id);
  if (!t) return;
  const want = on === undefined ? !isLiked(id) : on;
  // la interfaz cambia al instante; si el servidor falla, se vuelve atrás
  const l = likedList();
  if (l) { l.tracks = l.tracks.filter((x) => x !== id); if (want) l.tracks.unshift(id); }
  updateLike();
  try { await plOp({ like: { id, on: want } }); }
  catch (e) { toast(e.message, { kind: 'err' }); }
  updateLike();
  let sub = t.title;
  if (ytmAuth && t.ytId) {
    try { await api.post('/api/ytm/rate', { videoId: t.ytId, rating: want ? 'LIKE' : 'INDIFFERENT' }); sub += ' · también en YouTube Music'; }
    catch { sub += ' · (YouTube Music no respondió)'; }
  }
  toast(want ? 'Me gusta ♥' : 'Quitado de Me gusta', { sub, ms: 1800 });
  signal(want ? 'like' : 'unlike', t);
  bus.emit('like', { id, on: want });
}

export function likeCurrent() {
  const t = current();
  if (!t) return toast('No hay nada sonando', { kind: 'warn' });
  return toggleLike(t.id);
}

// todos los corazones del reproductor (barra, barra del celular, pantalla completa)
export function updateLike() {
  const t = current();
  const on = !!(t && isLiked(t.id));
  for (const b of $$('[data-act="like"]')) {
    b.hidden = !t;
    b.classList.toggle('on', on);
    b.classList.toggle('liked', on);
    b.title = on ? 'quitar de Me gusta (h)' : 'me gusta (h)';
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
}

export function initLikes() {
  bus.on('np', updateLike);
  bus.on('pl:loaded', updateLike);
  bus.on('ytm:status', (s) => { ytmAuth = !!(s && s.auth); });
  updateLike();
}
