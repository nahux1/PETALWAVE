// sin internet: Petalwave sigue sonando con lo que tenés.
// - lo que suena online se guarda solo (data/stream-cache) hasta el espacio que elijas (ajustes → sin internet)
// - si se corta internet (o activás el modo sin internet): aparece "✈ sin internet" arriba, la cola salta las canciones
//   que no están guardadas, la cola infinita usa solo lo guardado y lo que no se puede escuchar se ve apagado
// - "guardar sin internet" en listas y canciones online: las baja a lo guardado sin sumarlas a tu carpeta de música
// - letras: la de cada canción que escuchás (y de lo que guardás) queda guardada; sin internet se muestran esas
import { P, api, bus, toast, modal, esc, fmtSize, $, local } from './core.js';
import { castSaved } from './cast.js';
import { D, T } from './data.js';
import * as player from './player.js';
import { netType } from './smartdl.js';

const st = { online: navigator.onLine !== false, cached: new Set(), bytes: 0, maxMB: 0, saving: 0, ready: false };
let localYt = null, localN = -1;

export const isOffline = () => P.get('offlineMode') === true || !st.online;
export const offlineState = () => st;
const localIds = () => {
  if (localN !== D.tracks.length) { localYt = new Set(D.tracks.filter((t) => t.ytId && !t.video).map((t) => t.ytId)); localN = D.tracks.length; }
  return localYt;
};
// ¿se puede escuchar sin internet? (archivo de tu biblioteca o guardada)
export function playable(t) {
  if (!t) return false;
  if (t.cast) return castSaved(t);   // capítulos de podcast guardados (las radios necesitan internet)
  if (!t.remote) return true;
  return st.cached.has(t.ytId) || localIds().has(t.ytId);
}
export const savedOffline = (t) => !!t && t.remote && st.cached.has(t.ytId);
// todo lo que podés escuchar ahora sin internet
export function offlineIds() {
  const lib = D.tracks.filter((t) => !t.video).map((t) => t.id);
  const saved = [...st.cached].map((v) => T('yt_' + v)).filter((t) => t && !localIds().has(t.ytId)).map((t) => t.id);
  return [...lib, ...saved];
}

export async function refreshOffline() {
  try { const j = await api.get('/api/offline'); st.cached = new Set(j.ids || []); st.bytes = j.bytes || 0; st.maxMB = j.maxMB || 0; st.saving = j.saving || 0; st.ready = true; } catch {}
  bus.emit('offline:list', st);
  markRows();
  return st;
}

let fails = 0;
async function checkNet(force = false) {
  let ok = navigator.onLine !== false;
  if (ok) {
    let r = true;
    try { r = !!(await api.get('/api/net' + (force ? '?force=1' : ''))).online; } catch { r = true; }   // si el servidor no contesta, no es falta de internet
    fails = r ? 0 : fails + 1;
    ok = fails < 2;   // una sola prueba lenta (datos móviles) no alcanza para decir "sin internet"
  }
  if (ok !== st.online) {
    st.online = ok;
    if (P.get('offlineMode') !== true) {
      const n = offlineIds().length;
      if (!ok) toast('✈ sin internet', { sub: n ? `suena lo que tenés: ${n} canciones` : 'no hay canciones guardadas todavía', ms: 3200 });
      else { toast('volvió internet ✓', { ms: 1600 }); refreshOffline(); }
    }
    apply();
  }
  return ok;
}

function apply() {
  const off = isOffline();
  document.body.classList.toggle('pw-offline', off);
  let b = $('#tOff');
  if (!b) {
    const at = $('#tDeps') || $('#tTheme');
    if (!at) return;
    b = document.createElement('button');
    b.className = 'mod ico'; b.id = 'tOff'; b.title = 'sin internet: qué podés escuchar';
    b.onclick = () => openOffline();
    at.before(b);
  }
  b.hidden = !off;
  b.innerHTML = `✈ <span>${P.get('offlineMode') === true ? 'modo sin internet' : 'sin internet'}</span>`;
  markRows();
  bus.emit('offline', off);
}

// lo que no se puede escuchar sin internet se ve apagado (las filas online tienen data-warm="<videoId>")
let markT = 0;
function markRows() {
  clearTimeout(markT);
  markT = setTimeout(() => {
    const off = isOffline(), loc = localIds();
    for (const el of document.querySelectorAll('[data-warm]')) {
      const v = el.dataset.warm;
      el.classList.toggle('pw-nooff', off && !!v && !st.cached.has(v) && !loc.has(v));
    }
  }, 120);
}

export async function saveOffline(tracks) {
  const vids = [...new Set(tracks.filter((t) => t && t.remote && t.ytId && t.available !== false).map((t) => t.ytId))].filter((v) => !st.cached.has(v));
  if (!vids.length) return toast('ya está todo guardado para escuchar sin internet ✓', { ms: 1800 });
  if (isOffline()) return toast('ahora no hay internet: probá cuando vuelva', { kind: 'warn' });
  try {
    const r = await api.post('/api/offline/save', { ids: vids });
    toast(`guardando ${r.queued} para escuchar sin internet ✈`, { sub: 'se bajan de a una en segundo plano · no van a tu carpeta de música · con sus letras', ms: 2600 });
    watchSaving();
    if (P.get('offlineLyrics') !== false) saveLyrics(tracks.filter((t) => t && t.remote), { quiet: true });
  } catch (e) { toast(e.message, { kind: 'err' }); }
}

// ---------- letras sin internet ----------
// El servidor guarda en disco cada letra que encuentra (data/lyrics). Acá se pide la letra de lo que escuchás
// y de lo que guardás, así sin internet también aparece. Se recuerda cuáles ya están (para el contador).
const LYR = 'pw-lyr-saved';
const lyrSaved = new Set(local.get(LYR, []) || []);
let lyrT = 0;
export function noteLyrics(id) { if (lyrSaved.has(id)) return; lyrSaved.add(id); clearTimeout(lyrT); lyrT = setTimeout(() => local.set(LYR, [...lyrSaved].slice(-20000)), 1500); }
export const lyricsSaved = () => lyrSaved.size;
const lyrQs = (t) => (t.remote ? '?' + new URLSearchParams({ title: t.title || '', artist: t.artist || '', album: t.album || '', duration: String(Math.round(t.duration || 0)) }) : '');
async function fetchLyrics(t) {
  if (!t || t.video || t.isVideo || t.cast || lyrSaved.has(t.id) || isOffline()) return null;
  try { const j = await api.get('/api/lyrics/' + t.id + lyrQs(t)); if (j && j.text) { noteLyrics(t.id); return true; } return false; } catch { return null; }
}
let lyrRun = null;
export async function saveLyrics(tracks, { quiet = false } = {}) {
  const list = tracks.filter((t) => t && !t.video && !t.isVideo && !t.cast && !lyrSaved.has(t.id));
  if (!list.length) { if (!quiet) toast('las letras ya están guardadas ✓', { ms: 1600 }); return; }
  if (isOffline()) { if (!quiet) toast('ahora no hay internet: probá cuando vuelva', { kind: 'warn' }); return; }
  if (lyrRun) { lyrRun.push(...list); return; }
  lyrRun = list.slice();
  let ok = 0, done = 0;
  const total = () => done + lyrRun.length;
  if (!quiet) toast(`guardando letras de ${list.length} canciones…`, { sub: 'en segundo plano · podés seguir usando Petalwave', ms: 2200 });
  const worker = async () => { while (lyrRun.length && !isOffline()) { const t = lyrRun.shift(); if (await fetchLyrics(t)) ok++; done++; if (!quiet && done % 25 === 0) toast(`letras: ${done}/${total()}`, { ms: 1200 }); } };
  await Promise.all([worker(), worker()]);
  lyrRun = null;
  if (!quiet) toast(`letras guardadas: ${ok} de ${done}`, { sub: done - ok ? `${done - ok} no tienen letra en YouTube Music ni en LRCLIB` : 'listo ✓', ms: 3200 });
  bus.emit('offline:list', st);
}
let watchT = 0;
function watchSaving() {
  clearTimeout(watchT);
  watchT = setTimeout(async () => { await refreshOffline(); if (st.saving) watchSaving(); }, 6000);
}

export async function removeOffline({ ids = [], all = false } = {}) {
  await api.post('/api/offline/remove', { ids, all });
  return refreshOffline();
}

export async function openOffline() {
  await refreshOffline();
  const ids = offlineIds();
  const lib = D.tracks.filter((t) => !t.video).length;
  const forced = P.get('offlineMode') === true;
  const f = await modal({
    title: '✈ sin internet',
    html: `<div class="offbox">
      <p>${!st.online ? 'No hay internet ahora.' : forced ? 'Está activado el <b>modo sin internet</b>: Petalwave no usa internet para la música.' : 'Hay internet.'}
      Sin internet suena lo que tenés en tu PC o celular y lo que quedó guardado.</p>
      <div class="offgrid">
        <div><b>${lib}</b><span>de tu biblioteca</span></div>
        <div><b>${ids.length - lib}</b><span>online guardadas</span></div>
        <div><b>${fmtSize(st.bytes)}</b><span>de ${st.maxMB >= 1024 ? (st.maxMB / 1024).toFixed(st.maxMB % 1024 ? 1 : 0) + ' GB' : st.maxMB + ' MB'}</span></div>
        <div><b>${lyrSaved.size}</b><span>letras guardadas</span></div>
      </div>
      ${st.saving ? `<p class="m">guardando ${st.saving} en segundo plano…</p>` : ''}
    </div>`,
    actions: [
      { label: forced ? 'volver a usar internet' : 'modo sin internet', value: 'mode' },
      { label: 'ajustes', value: 'cfg' },
      !isOffline() && { label: '📝 guardar letras de todo', value: 'lyr' },
      ids.length && { label: '▶ escuchar todo mezclado', value: 'play', primary: true },
    ].filter(Boolean),
  });
  if (f === 'play') player.playList(ids, Math.floor(Math.random() * ids.length), { shuffle: true });
  if (f === 'mode') setOfflineMode(!forced);
  if (f === 'cfg') bus.emit('open-settings', 'offline');
  if (f === 'lyr') saveLyrics(ids.map(T).filter(Boolean));
}

export function setOfflineMode(on) {
  P.set('offlineMode', !!on);
  apply();
  toast(on ? '✈ modo sin internet' : 'usando internet de nuevo', { sub: on ? 'solo suena lo guardado · no gasta datos' : '', ms: 2000 });
  if (!on) checkNet(true);
}

// guardar sola la canción online que estás escuchando (a los 30 s, así no se guarda lo que salteás)
let autoT = 0;
function autoSave(t) {
  clearTimeout(autoT);
  if (!t || !t.remote || !t.ytId || st.cached.has(t.ytId) || localIds().has(t.ytId)) return;
  autoT = setTimeout(() => {
    const c = player.current();
    if (!c || c.id !== t.id || P.get('offlineAuto') === false || isOffline()) return;
    if (netType() === 'datos' && P.get('offlineWifi') !== false) return;   // Android con datos móviles: solo con WiFi
    api.post('/api/offline/save', { ids: [t.ytId] }).then(() => setTimeout(refreshOffline, 20000)).catch(() => {});
  }, 30000);
}

export function initOffline() {
  player.setGate((t) => !isOffline() || playable(t));
  apply();
  refreshOffline();
  checkNet();
  setInterval(() => checkNet(), 45000);
  addEventListener('online', () => checkNet(true));
  addEventListener('offline', () => checkNet(true));
  bus.on('np', (t) => autoSave(t));
  let lyrNp = 0;
  bus.on('np', (t) => { clearTimeout(lyrNp); if (P.get('offlineLyrics') !== false) lyrNp = setTimeout(() => { const c = player.current(); if (c && t && c.id === t.id) fetchLyrics(t); }, 20000); });
  // una canción online que no carga: puede ser que se cortó internet
  bus.on('eng:error', () => { const t = player.current(); if (t && t.remote) checkNet(true); });
  new MutationObserver(() => { if (isOffline()) markRows(); }).observe(document.body, { childList: true, subtree: true });
}
