// reproductor: cola, historial, repetir/aleatorio, reanudación, estadísticas, Media Session y UI de "now playing"
import { $, $$, bus, P, api, toast, fmtTime, coverUrl, host, clamp } from './core.js';
import { engine } from './audio.js';
import { D, T, trackLabel } from './data.js';
import { themeForTrack } from './theme.js';

export const S = { queue: [], qi: -1, history: [], repeat: 'off', shuffle: false, orig: null };
export const current = () => T(S.queue[S.qi]);
let errors = 0;

// ---------- persistencia (cola, posición, modos) ----------
function persist() {
  const st = { queue: S.queue.slice(0, 2000), qi: S.qi, repeat: S.repeat, shuffle: S.shuffle, pos: engine.time || 0, history: S.history.slice(0, 200) };
  P.all().player = st; P.save();
}
setInterval(() => { if (!engine.paused) persist(); }, 6000);
addEventListener('beforeunload', persist);

export function restore() {
  const st = P.get('player');
  if (!st) return;
  S.queue = (st.queue || []).filter((id) => T(id));
  S.history = (st.history || []).filter((id) => T(id));
  S.repeat = ['off', 'all', 'one'].includes(st.repeat) ? st.repeat : 'off';
  S.shuffle = !!st.shuffle;
  S.qi = Math.min(st.qi == null ? -1 : st.qi, S.queue.length - 1);
  renderModes();
  bus.emit('queue');
  if (P.get('resume') && S.qi >= 0) {
    ensure();
    start(S.qi, { autoplay: false, startAt: st.pos || 0, silent: true });
  }
}

function ensure() { engine.init(ensureVideo()); applySound(); }
function ensureVideo() {
  let v = $('#vidSlot video');
  if (!v) { v = document.createElement('video'); v.playsInline = true; $('#vidSlot').appendChild(v); }
  return v;
}

// ---------- sesión de escucha (estadísticas reales) ----------
let sess = null, lastTick = performance.now();
setInterval(() => {
  const now = performance.now();
  if (sess && !engine.paused) sess.sec += (now - lastTick) / 1000;
  lastTick = now;
}, 1000);
function endSession(completed) {
  if (!sess) return;
  const s = sess; sess = null;
  if (s.sec < 2) return;
  const t = T(s.id);
  api.post('/api/stats/play', { id: s.id, seconds: Math.round(s.sec), duration: t ? t.duration : 0, completed }).catch(() => {});
  if (t && (completed || s.sec >= Math.min(30, (t.duration || 60) * 0.5))) D.plays[s.id] = (D.plays[s.id] || 0) + 1;
}

// ---------- reproducir ----------
async function start(i, { fade = 0, autoplay = true, startAt = 0, silent = false } = {}) {
  const id = S.queue[i];
  const t = T(id);
  if (!t) return;
  ensure();
  endSession(false);
  S.qi = i;
  if (!silent) { S.history = [id, ...S.history.filter((x) => x !== id)].slice(0, 200); }
  sess = { id, sec: 0 };
  engine.setSongDb(+P.get('vol').perSong[id] || 0);
  engine.crossfade = +P.get('crossfade') || 0;
  themeForTrack(t);
  renderNP();
  bus.emit('queue');
  bus.emit('np', t);
  mediaSession(t);
  if (!silent && autoplay) notifyChange(t);
  await engine.load(t, { fade, autoplay, startAt });
  persist();
  prefetchNext();
}
// la primera vez que suena una canción online, yt-dlp tarda unos segundos: se resuelve la siguiente por adelantado
function prefetchNext() {
  for (let k = 1; k <= 2; k++) {
    const n = T(S.queue[S.qi + k]);
    if (n && n.remote && n.ytId) fetch(`/stream/${n.ytId}?prefetch=1`).catch(() => {});
  }
}

export function playList(ids, index = 0, { shuffle } = {}) {
  ids = ids.filter((id) => T(id));
  if (!ids.length) return;
  if (shuffle !== undefined) S.shuffle = shuffle;
  S.queue = ids.slice();
  S.orig = null;
  let i = clamp(index, 0, ids.length - 1);
  if (S.shuffle) {
    S.orig = ids.slice();
    const first = S.queue.splice(i, 1)[0];
    shuffleArr(S.queue);
    S.queue.unshift(first);
    i = 0;
  }
  renderModes();
  start(i);
}
export function playId(id, context) {
  const list = context && context.includes(id) ? context : [id];
  playList(list, list.indexOf(id));
}
export function playNext(ids) {
  ids = [].concat(ids).filter((id) => T(id));
  if (S.qi < 0) return playList(ids);
  S.queue.splice(S.qi + 1, 0, ...ids);
  bus.emit('queue'); persist();
  toast(ids.length > 1 ? `${ids.length} canciones van a sonar después` : 'va a sonar después ↵', { ms: 1600 });
}
export function addQueue(ids) {
  ids = [].concat(ids).filter((id) => T(id));
  if (S.qi < 0) return playList(ids);
  S.queue.push(...ids);
  bus.emit('queue'); persist();
  toast(ids.length > 1 ? `${ids.length} canciones agregadas a la cola` : 'agregada a la cola', { ms: 1600 });
}
export function removeAt(i) {
  if (i === S.qi) return next();
  S.queue.splice(i, 1);
  if (i < S.qi) S.qi--;
  bus.emit('queue'); persist();
}
export function moveIn(from, to) {
  if (from === to || from === to - 1) return;
  const cur = S.queue[S.qi];
  const [id] = S.queue.splice(from, 1);
  S.queue.splice(to > from ? to - 1 : to, 0, id);
  S.qi = Math.max(0, S.queue.indexOf(cur));
  bus.emit('queue'); persist();
}
export function clearQueue() {
  const cur = S.queue[S.qi];
  S.queue = cur ? [cur] : [];
  S.qi = cur ? 0 : -1;
  bus.emit('queue'); persist();
}
export function jump(i) { if (S.queue[i]) start(i); }

export function next({ auto = false, fade = 0 } = {}) {
  if (!S.queue.length) return;
  if (auto && S.repeat === 'one') return start(S.qi, { fade: 0 });
  let i = S.qi + 1;
  if (i >= S.queue.length) {
    if (S.repeat === 'all' || !auto) {
      if (!auto && S.repeat !== 'all') { toast('fin de la cola', { ms: 1400 }); return; }
      if (S.shuffle) { const cur = S.queue[S.qi]; shuffleArr(S.queue); if (S.queue[0] === cur && S.queue.length > 1) S.queue.push(S.queue.shift()); }
      i = 0;
    } else { endSession(true); bus.emit('ended-queue'); return; }
  }
  start(i, { fade });
}
export function prev() {
  if (engine.time > 3 || S.qi <= 0) return engine.seek(0);
  start(S.qi - 1);
}
export async function toggle() {
  if (!engine.active) {
    if (S.qi >= 0) return start(S.qi);
    if (D.tracks.length) return playList(D.tracks.map((t) => t.id), 0);
    return;
  }
  await engine.toggle();
}
export function seekBy(s) { engine.seek(engine.time + s); }

export function toggleRepeat() {
  S.repeat = S.repeat === 'off' ? 'all' : S.repeat === 'all' ? 'one' : 'off';
  renderModes(); persist();
  toast('repetir: ' + { off: 'no', all: 'toda la cola', one: 'esta canción' }[S.repeat], { ms: 1400 });
}
export function toggleShuffle() {
  S.shuffle = !S.shuffle;
  const cur = S.queue[S.qi];
  if (S.shuffle) {
    S.orig = S.queue.slice();
    const rest = S.queue.slice(S.qi + 1);
    shuffleArr(rest);
    S.queue = [...S.queue.slice(0, S.qi + 1), ...rest];
  } else if (S.orig) {
    S.queue = S.orig.filter((id) => T(id));
    S.qi = Math.max(0, S.queue.indexOf(cur));
    S.orig = null;
  }
  renderModes(); bus.emit('queue'); persist();
  toast('aleatorio: ' + (S.shuffle ? 'sí' : 'no'), { ms: 1400 });
}
export async function radio(seed) {
  const t = T(seed || S.queue[S.qi]);
  if (!t) return toast('poné una canción primero');
  const j = await api.get('/api/similar/' + t.id + '?n=40');
  if (!j.ids.length) return toast('no encontré canciones parecidas en tu biblioteca');
  playList([t.id, ...j.ids], 0, { shuffle: false });
  toast('radio de «' + t.title + '»', { sub: `${j.ids.length} canciones parecidas de tu biblioteca` });
}
function shuffleArr(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

// ---------- temporizador para dormir (con fundido suave al final) ----------
export const sleep = { until: 0, endOfTrack: false, fading: false };
export function setSleep(min) {
  sleep.fading = false;
  if (min === 'track') { sleep.until = 0; sleep.endOfTrack = true; toast('se detiene al terminar esta canción ⏾', { ms: 1800 }); }
  else if (!min) { sleep.until = 0; sleep.endOfTrack = false; applySound(); toast('temporizador apagado', { ms: 1400 }); }
  else { sleep.until = Date.now() + min * 60000; sleep.endOfTrack = false; toast(`se detiene en ${min} min ⏾`, { ms: 1800 }); }
  renderSleep();
}
function renderSleep() {
  const on = sleep.until || sleep.endOfTrack;
  $$('[data-act="sleep"]').forEach((b) => b.classList.toggle('on', !!on));
  let txt = '';
  if (sleep.endOfTrack) txt = 'fin';
  else if (sleep.until) { const s = Math.max(0, Math.round((sleep.until - Date.now()) / 1000)); txt = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
  $$('[data-np="sleep"]').forEach((el) => { el.textContent = txt; el.hidden = !txt; });
}
setInterval(() => {
  if (!sleep.until) return;
  const left = sleep.until - Date.now();
  renderSleep();
  if (left <= 8000 && !sleep.fading && !engine.paused) {      // últimos 8 s: bajar el volumen de a poco
    sleep.fading = true;
    if (engine.ctx) engine.master.gain.setTargetAtTime(0, engine.ctx.currentTime, 2.2);
  }
  if (left <= 0) { sleep.until = 0; stopForSleep(); }
}, 1000);
async function stopForSleep() {
  await engine.pause();
  sleep.fading = false; sleep.endOfTrack = false;
  applySound();                                                  // volver al volumen normal (en pausa)
  renderSleep();
  toast('temporizador: música detenida ⏾ que descanses', { ms: 3500 });
}

// ---------- eventos del motor ----------
bus.on('eng:nearend', () => {
  if (sleep.endOfTrack) return;                                  // el temporizador corta al final: no fundir
  const fade = +P.get('crossfade') || 0;
  if (fade <= 0 || S.repeat === 'one') return;
  if (S.qi + 1 >= S.queue.length && S.repeat !== 'all') return;
  next({ auto: true, fade });
});
bus.on('eng:ended', () => { endSession(true); errors = 0; if (sleep.endOfTrack) return stopForSleep(); next({ auto: true }); });
bus.on('eng:error', (msg) => {
  const t = current();
  errors++;
  toast('no se pudo reproducir ' + (t ? '«' + t.title + '»' : ''), { kind: 'err', sub: String(msg || '') });
  if (errors < 3 && S.qi + 1 < S.queue.length) setTimeout(() => next(), 900);
});
bus.on('eng:state', (s) => {
  const t = current();
  if (t && t.remote) setText('fmt', s === 'wait' ? '☁ conectando con YouTube Music…' : '☁ online · YouTube Music');
  renderPlayState(s); if (s === 'play') errors = 0; if ('mediaSession' in navigator) navigator.mediaSession.playbackState = s === 'pause' ? 'paused' : 'playing'; });

// ---------- notificaciones de cambio de canción ----------
function notifyChange(t) {
  if (P.get('notifyToast')) toast(t.title, { sub: [t.artist, t.album].filter(Boolean).join(' · ') || '♪', img: t.hasCover || t.video ? coverUrl(t.id) : null });
  if (P.get('notify') && host.native && !document.hasFocus()) host.send('notify:' + t.title + '\n' + (t.artist || ''));
}

// ---------- Media Session (teclas multimedia y panel de Windows) ----------
function mediaSession(t) {
  if (!('mediaSession' in navigator)) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: t.title, artist: t.artist || '', album: t.album || '',
      artwork: [{ src: location.origin + coverUrl(t.id), sizes: '512x512', type: 'image/jpeg' }],
    });
  } catch {}
}
if ('mediaSession' in navigator) {
  const ms = navigator.mediaSession, h = (a, fn) => { try { ms.setActionHandler(a, fn); } catch {} };
  h('play', () => toggle()); h('pause', () => engine.pause());
  h('previoustrack', () => prev()); h('nexttrack', () => next());
  h('seekbackward', () => seekBy(-10)); h('seekforward', () => seekBy(10));
  h('seekto', (d) => engine.seek(d.seekTime));
}

// ---------- volumen ----------
export function applySound() {
  const v = P.get('vol'), eq = P.get('eq');
  engine.setVolume(v.master, v.muted);
  engine.setNorm(!!v.norm);
  engine.setEq(eq);
  renderVol();
}
export function setVol(x) {
  const v = P.get('vol');
  v.master = Math.round(clamp(x, 0, 1.5) * 100) / 100;
  if (v.master > 0) v.muted = false;
  P.save(); applySound();
}
export function toggleMute() { const v = P.get('vol'); v.muted = !v.muted; P.save(); applySound(); }
export function setSongDb(db) {
  const t = current(); if (!t) return;
  const v = P.get('vol');
  if (!db) delete v.perSong[t.id]; else v.perSong[t.id] = db;
  const keys = Object.keys(v.perSong); if (keys.length > 1500) delete v.perSong[keys[0]];
  P.save(); engine.setSongDb(db); bus.emit('vol');
}
function renderVol() {
  const v = P.get('vol'), pct = Math.round(v.master * 100), off = v.muted || v.master === 0;
  $('#tVolTxt').textContent = off ? 'mute' : pct + '%';
  $('#tVol').classList.toggle('boost', v.master > 1 && !v.muted);
  $('#tVol use').setAttribute('href', off ? '#i-mute' : '#i-vol');
  $$('[data-np="volicon"] use').forEach((u) => u.setAttribute('href', off ? '#i-mute' : '#i-vol'));
  $$('[data-vol]').forEach((r) => { if (document.activeElement !== r) r.value = pct; });
  bus.emit('vol');
}
document.addEventListener('input', (e) => { if (e.target.matches('[data-vol]')) setVol(+e.target.value / 100); });
document.addEventListener('wheel', (e) => {
  if (!e.target.closest('[data-vol],#tVol')) return;
  e.preventDefault(); setVol(P.get('vol').master + (e.deltaY < 0 ? 0.05 : -0.05));
}, { passive: false });

// ---------- UI de "now playing" (todas las vistas: panel, mini, pantalla completa) ----------
const setText = (k, v) => $$(`[data-np="${k}"]`).forEach((el) => { if (el.textContent !== v) el.textContent = v; });
export function renderNP() {
  const t = current();
  setText('title', t ? t.title : 'nada sonando');
  setText('artist', t ? t.artist || '—' : '—');
  setText('album', t ? (t.album ? t.album + (t.year ? ` (${t.year})` : '') : '—') : '—');
  setText('fmt', !t ? '—' : t.remote ? '☁ online · YouTube Music' : [t.ext, t.bitrate ? t.bitrate + ' kbps' : '', t.sampleRate ? (t.sampleRate / 1000) + ' kHz' : ''].filter(Boolean).join(' · '));
  setText('queue', `${S.qi + 1 > 0 ? S.qi + 1 : 0} / ${S.queue.length}`);
  setText('plays', t ? String(D.plays[t.id] || 0) : '—');
  setText('line', t ? trackLabel(t) : 'sin reproducir');
  document.title = t ? '♪ ' + trackLabel(t) : 'Petalwave';
  const cover = $('#cover'), img = $('#coverImg');
  cover.classList.toggle('video', !!(t && t.video));
  const src = t ? coverUrl(t.id) : '';
  if (t && !t.video) {
    if (img.dataset.id !== t.id) {
      img.hidden = true; img.dataset.id = t.id;
      img.onload = () => { img.hidden = false; unbox(img); }; img.onerror = () => (img.hidden = true);
      img.src = src;
    }
  } else { img.hidden = true; img.dataset.id = ''; }
  $$('[data-np="coverimg"]').forEach((el) => { el.onload = () => unbox(el); el.onerror = () => el.removeAttribute('src'); if (t) el.src = src; else el.removeAttribute('src'); });
  const fb = $('#fbg'); if (fb) fb.style.backgroundImage = t ? `url(${src})` : '';
  renderTime(true);
}
// miniaturas de video de YouTube (4:3 con franjas negras arriba y abajo): agrandar para que el dibujo llene la carátula
const _ub = document.createElement('canvas'); _ub.width = _ub.height = 48;
function unbox(img) {
  img.style.transform = '';
  try {
    const x = _ub.getContext('2d', { willReadFrequently: true });
    x.clearRect(0, 0, 48, 48); x.drawImage(img, 0, 0, 48, 48);
    const d = x.getImageData(0, 0, 48, 48).data;
    const dark = (y) => { let s = 0, mx = 0; for (let i = 0; i < 48; i++) { const k = (y * 48 + i) * 4, l = (d[k] + d[k + 1] + d[k + 2]) / 3; s += l; if (l > mx) mx = l; } return s / 48 < 16 && mx < 45; };
    let top = 0, bot = 0;
    while (top < 16 && dark(top)) top++;
    while (bot < 16 && dark(47 - bot)) bot++;
    if (Math.min(top, bot) >= 3 && top + bot < 40) img.style.transform = `scale(${(48 / (48 - top - bot)).toFixed(3)})`;
  } catch {}
}
function renderPlayState(s) {
  const playing = s === 'play' || s === 'wait';
  $$('[data-np="playicon"] use').forEach((u) => u.setAttribute('href', playing ? '#i-pause' : '#i-play'));
  if (playing) loop();
}
function renderModes() {
  $$('[data-act="shuffle"]').forEach((b) => b.classList.toggle('on', S.shuffle));
  $$('[data-act="repeat"]').forEach((b) => { b.classList.toggle('on', S.repeat !== 'off'); b.title = 'repetir: ' + { off: 'no', all: 'toda la cola', one: 'esta canción' }[S.repeat]; });
  $$('[data-np="repicon"] use').forEach((u) => u.setAttribute('href', S.repeat === 'one' ? '#i-rep1' : '#i-rep'));
}

// barra de progreso: arrastrable, con tiempo al pasar el mouse
let drag = null;
function ratioFrom(tr, x) { const r = tr.getBoundingClientRect(); return clamp((x - r.left) / r.width, 0, 1); }
document.addEventListener('pointerdown', (e) => {
  const tr = e.target.closest('[data-seek] .tr'); if (!tr || !engine.duration) return;
  e.preventDefault();
  drag = { tr, seek: tr.closest('[data-seek]'), ratio: ratioFrom(tr, e.clientX) };
  drag.seek.classList.add('drag');
  tr.setPointerCapture(e.pointerId);
  renderTime(true);
});
document.addEventListener('pointermove', (e) => {
  const tr = drag ? drag.tr : e.target.closest('[data-seek] .tr');
  if (!tr) return;
  const ratio = ratioFrom(tr, e.clientX);
  const tip = tr.querySelector('[data-np="tip"]');
  if (tip) { tip.style.left = ratio * 100 + '%'; tip.textContent = fmtTime(ratio * engine.duration); }
  if (drag) { drag.ratio = ratio; renderTime(true); }
});
document.addEventListener('pointerup', () => {
  if (!drag) return;
  engine.seek(drag.ratio * engine.duration);
  drag.seek.classList.remove('drag');
  drag = null;
});

let lastDraw = 0, looping = false;
function renderTime(force) {
  const d = engine.duration || 0, t = drag ? drag.ratio * d : engine.time;
  const pct = d ? (t / d) * 100 : 0;
  $$('[data-np="fill"]').forEach((el) => (el.style.width = pct + '%'));
  $$('[data-np="knob"]').forEach((el) => (el.style.left = pct + '%'));
  if (force || performance.now() - lastDraw > 250) {
    lastDraw = performance.now();
    setText('pos', fmtTime(t)); setText('dur', fmtTime(d));
    const b = d ? (engine.buffered / d) * 100 : 0;
    $$('[data-np="buffered"]').forEach((el) => (el.style.width = b + '%'));
    if ('mediaSession' in navigator && d && navigator.mediaSession.setPositionState) {
      try { navigator.mediaSession.setPositionState({ duration: d, position: Math.min(t, d), playbackRate: 1 }); } catch {}
    }
    bus.emit('time', t);
  }
}
// solo corre mientras suena (y la ventana está visible): en pausa no gasta CPU
function loop() {
  if (looping) return;
  looping = true;
  const f = () => {
    if (engine.paused && !drag) { looping = false; renderTime(true); return; }
    if (!document.hidden) renderTime(false);
    requestAnimationFrame(f);
  };
  requestAnimationFrame(f);
}
bus.on('eng:seek', () => renderTime(true));
bus.on('eng:meta', () => renderTime(true));
bus.on('eng:buffer', () => renderTime(true));
