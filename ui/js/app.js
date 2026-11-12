// arranque de petalwave: une todos los módulos, workspaces, atajos, arrastrar y soltar, modos de ventana
import { $, $$, bus, P, api, toast, host, connectStream, closeCtx, debounce, osd, ctxMenu } from './core.js';
import { applyTheme, cycleTheme, setDyn } from './theme.js';
import { engine } from './audio.js';
import { D, loadLibrary, loadPlaylists, loadAuto, T } from './data.js';
import * as player from './player.js';
import { toggleVolPop, openEq } from './eq.js';
import { initLibrary, go, render as renderLib, newPlaylist } from './library.js';
import { initSide, setSideTab, refreshFullLyrics, loadLyrics } from './side.js';
import { initDownloads, setDeps, uploadCookies, log } from './downloads.js';
import { initSync } from './syncui.js';
import { renderStats } from './statsui.js';
import { renderSettings, keyName, isRecordingKey } from './settings.js';
import { attach, MODES, setMode, setViewMode, cycleMode, start as startViz } from './viz.js';
import { initYtm, likeCurrent } from './ytmui.js';
import { applyCustom, C, setC, FULL_BG, FULL_VIZ, cyclePerf } from './custom.js';
import { initBg, loadWallpaper } from './bgfx.js';
import { initUpdate } from './update.js';
import { applyCaps } from './caps.js';

// ---------- workspaces (como Hyprland: 1..5) ----------
const WS = ['music', 'dl', 'sync', 'stats', 'cfg'];
function setWs(ws) {
  if (!WS.includes(ws)) ws = 'music';
  $$('#wsNav [data-ws]').forEach((b) => b.classList.toggle('on', b.dataset.ws === ws));
  $$('#wsa > .ws').forEach((w) => (w.hidden = w.dataset.ws !== ws));
  P.set('ws', ws);
  if (ws === 'stats') renderStats();
  if (ws === 'cfg') renderSettings();
  if (ws === 'music') renderLib();
}
bus.on('ws', setWs);

// ---------- modos de ventana ----------
function applyPrefsClasses() {
  document.body.classList.toggle('noblur', !P.get('blur'));
  document.body.classList.toggle('noanim', !P.get('anim'));
  document.body.classList.toggle('compact', !!P.get('compact'));
  $$('[data-act="compact"]').forEach((b) => b.classList.toggle('on', !!P.get('compact')));
}
bus.on('prefs', () => { applyPrefsClasses(); renderLib(); });
function toggleCompact() { P.set('compact', !P.get('compact')); applyPrefsClasses(); renderLib(); toast(P.get('compact') ? 'modo compacto' : 'modo normal', { ms: 1200 }); }
let miniOn = false;
function toggleMini(force) {
  miniOn = force === undefined ? !miniOn : force;
  document.body.classList.toggle('mini', miniOn);
  host.send('mini:' + (miniOn ? 1 : 0));
  if (miniOn) { toggleFull(false); startViz(); }
}
function toggleFull(force) {
  const f = $('#full');
  const on = force === undefined ? f.hidden : force;
  f.hidden = !on;
  document.body.classList.toggle('full-on', on);
  host.send('full:' + (on ? 1 : 0));
  if (on) { refreshFullLyrics(); loadLyrics(player.current()); startViz(); }
}

// ---------- acciones (botones con data-act en cualquier vista) ----------
const ACTIONS = {
  toggle: () => player.toggle(), next: () => player.next(), prev: () => player.prev(),
  fwd: () => player.seekBy(10), back: () => player.seekBy(-10), fwdLong: () => player.seekBy(30), backLong: () => player.seekBy(-30),
  shuffle: () => player.toggleShuffle(), repeat: () => player.toggleRepeat(),
  mute: () => player.toggleMute(), volUp: () => player.setVol(P.get('vol').master + 0.05), volDown: () => player.setVol(P.get('vol').master - 0.05),
  vol: () => toggleVolPop(), eq: () => openEq(), radio: () => player.radio(), like: () => likeCurrent(),
  sleep: () => {
    const b = $('[data-act="sleep"]').getBoundingClientRect();
    const on = player.sleep.until || player.sleep.endOfTrack;
    ctxMenu(b.left, b.bottom + 6, [
      { header: 'temporizador para dormir' },
      ...[15, 30, 45, 60, 90].map((m) => ({ label: `${m} minutos`, icon: 'moon', fn: () => player.setSleep(m) })),
      { label: 'al terminar esta canción', icon: 'moon', fn: () => player.setSleep('track') },
      on && { sep: true },
      on && { label: 'apagar temporizador', icon: 'x', fn: () => player.setSleep(0) },
    ]);
  },
  full: () => toggleFull(), mini: () => toggleMini(), compact: toggleCompact,
  peek: () => togglePeek(),
  perf: () => { const m = cyclePerf(); toast(m.icon + ' ' + m.name, { sub: m.desc, ms: 2200 }); },
  fullcfg: () => {
    const b = $('[data-act="fullcfg"]').getBoundingClientRect(), c = C();
    const pick = (k, list) => list.map(([v, t]) => ({ label: (c[k] === v ? '● ' : '○ ') + t, fn: () => setC(k, v) }));
    const lv = (k, opts, unit) => opts.map((v) => ({ label: (c[k] === v ? '● ' : '○ ') + v + unit, fn: () => setC(k, v) }));
    ctxMenu(b.left - 230, b.bottom + 6, [
      { header: 'pantalla completa' },
      { label: 'fondo', icon: 'wall', sub: pick('fullBg', FULL_BG) },
      { label: 'visualizador', icon: 'stats', sub: pick('fullViz', FULL_VIZ) },
      { label: 'altura del visualizador', icon: 'stats', sub: lv('fullVizH', [15, 30, 50, 75, 100], '%') },
      { label: 'brillo del fondo', icon: 'theme', sub: lv('fullDim', [15, 32, 50, 70], '%') },
      { label: 'desenfoque de la carátula', icon: 'eye', sub: lv('fullBlur', [0, 20, 50, 90], ' px') },
      { sep: true },
      { label: 'más opciones en ajustes', icon: 'cfg', fn: () => { toggleFull(false); setWs('cfg'); } },
    ]);
  },
  theme: () => { const had = P.get('dyn'); const n = cycleTheme(); if (!had) toast('tema: ' + n, { ms: 1200 }); }, dyn: () => { setDyn(!P.get('dyn')); toast(P.get('dyn') ? 'colores de la carátula ◐' : 'colores del tema ◑', { ms: 1300 }); },
  viz: () => toast('visualizador: ' + cycleMode(), { ms: 1100 }), lyrics: () => setSideTab('lyrics'), queue: () => setSideTab('queue'),
  search: () => { setWs('music'); $('#q').focus(); $('#q').select(); },
  ws1: () => setWs('music'), ws2: () => setWs('dl'), ws3: () => setWs('sync'), ws4: () => setWs('stats'), ws5: () => setWs('cfg'),
};
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (b && ACTIONS[b.dataset.act]) { e.preventDefault(); ACTIONS[b.dataset.act](); }
});

// ---------- atajos de teclado (configurables) ----------
let lastTyping = 0;
const REPEATABLE = new Set(['fwd', 'back', 'fwdLong', 'backLong', 'volUp', 'volDown']);
document.addEventListener('keydown', (e) => {
  if (isRecordingKey()) return;
  const tag = e.target.tagName;
  const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target.isContentEditable;
  if (e.key === 'Escape') {
    if (typing) { e.target.blur(); return; }
    if (!$('#full').hidden) return toggleFull(false);
    if (miniOn) return toggleMini(false);
    if (document.body.classList.contains('peek')) return togglePeek(false);
    closeCtx(); toggleVolPop(false); return;
  }
  if (typing) { lastTyping = Date.now(); return; }
  if (!$('#modal').hidden) return;
  // una letra suelta justo después de escribir (la caja se redibujó y perdió el foco) no es un atajo
  const plain = e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey;
  if (plain && Date.now() - lastTyping < 1200) { lastTyping = Date.now(); return; }
  const k = keyName(e); if (!k) return;
  const sc = P.get('shortcuts');
  const act = Object.keys(sc).find((a) => sc[a] === k);
  // tecla mantenida (vvvvv): solo se repiten las acciones que tiene sentido repetir
  if (e.repeat && !REPEATABLE.has(act)) { if (act) e.preventDefault(); return; }
  if (act && ACTIONS[act]) { e.preventDefault(); ACTIONS[act](); feedback(act); }
});
// ver el fondo: esconde las ventanas y saca el desenfoque para mirar el wallpaper / fondo animado nítido
function togglePeek(force) {
  const on = document.body.classList.toggle('peek', force);
  $$('[data-act="peek"]').forEach((b) => b.classList.toggle('on', on));
  if (on) toast('viendo el fondo', { sub: `${P.get('shortcuts').peek || 'b'}, Esc o clic para volver`, ms: 1800 });
}
addEventListener('click', (e) => { if (document.body.classList.contains('peek') && !e.target.closest('.top,.toast')) togglePeek(false); }, true);
// aviso visual de lo que hizo el atajo
function feedback(act) {
  const v = P.get('vol'), pct = Math.round(v.master * 100);
  const map = {
    next: ['next', 'siguiente'], prev: ['prev', 'anterior'],
    fwd: ['fwd', '+10 s'], back: ['back', '−10 s'], fwdLong: ['fwd', '+30 s'], backLong: ['back', '−30 s'],
    volUp: [v.muted ? 'mute' : 'vol', `volumen ${pct}%`, Math.min(100, pct / 1.5)], volDown: [v.muted ? 'mute' : 'vol', `volumen ${pct}%`, Math.min(100, pct / 1.5)],
    mute: [v.muted ? 'mute' : 'vol', v.muted ? 'silencio' : `sonido ${pct}%`],
  };
  if (act === 'toggle') return setTimeout(() => osd(engine.paused ? 'pause' : 'play', engine.paused ? 'pausa' : 'reproduciendo'), 180);
  if (map[act]) osd(...map[act]);
}

// ---------- comandos de la bandeja / ventana nativa ----------
bus.on('host:cmd', (c) => { if (ACTIONS[c]) ACTIONS[c](); });
bus.on('host:win', (w) => { if (w === 'mini-off') toggleMini(false); if (w === 'full-off') { const f = $('#full'); if (!f.hidden) { f.hidden = true; document.body.classList.remove('full-on'); } } });

// ---------- arrastrar y soltar archivos ----------
let dragN = 0;
const isFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
addEventListener('dragenter', (e) => { if (isFiles(e)) { dragN++; document.body.classList.add('drag'); } });
addEventListener('dragleave', (e) => { if (isFiles(e) && --dragN <= 0) { dragN = 0; document.body.classList.remove('drag'); } });
addEventListener('dragover', (e) => { if (isFiles(e)) e.preventDefault(); });
addEventListener('drop', async (e) => {
  if (!isFiles(e)) return;
  e.preventDefault(); dragN = 0; document.body.classList.remove('drag');
  const files = [...e.dataTransfer.files];
  const audio = files.filter((f) => /\.(mp3|flac|wav|ogg|oga|opus|m4a|aac|weba|mp4|webm|m4v)$/i.test(f.name));
  for (const f of files) {
    if (/\.lrc$/i.test(f.name)) {
      const t = player.current(); if (!t) { toast('poné la canción y después soltá el .lrc', { kind: 'warn' }); continue; }
      try { await api.raw('/api/lyrics/' + t.id, f, { 'Content-Type': 'text/plain' }); toast('letra guardada ✓', { sub: t.title }); loadLyrics({ ...t }); setSideTab('lyrics'); } catch (err) { toast(err.message, { kind: 'err' }); }
    } else if (/\.txt$/i.test(f.name) || f.type === 'text/plain') uploadCookies(f);
    else if (f.type.startsWith('image/')) uploadWallpaper(f);
    else if (e.shiftKey && /^video\/(mp4|webm)$/.test(f.type)) uploadWallpaper(f);   // shift + soltar un video = fondo animado
  }
  if (e.shiftKey) audio.splice(0, audio.length, ...audio.filter((f) => !/^video\/(mp4|webm)$/.test(f.type)));
  if (audio.length) {
    toast(`importando ${audio.length} archivo${audio.length > 1 ? 's' : ''}…`, { ms: 2000 });
    const ids = [];
    for (const f of audio) {
      try { const r = await api.raw('/api/import', f, { 'x-filename': encodeURIComponent(f.name), 'Content-Type': 'application/octet-stream' }); if (r.track) ids.push(r.track.id); }
      catch (err) { toast(f.name + ': ' + err.message, { kind: 'err' }); }
    }
    if (ids.length) { await loadLibrary(); toast(`${ids.length} importado${ids.length > 1 ? 's' : ''} a «importados» ✓`, { sub: 'doble clic para escuchar' }); }
  }
});

// ---------- wallpaper ----------
// imagen, GIF animado o video (mp4/webm) en loop: lo dibuja bgfx.js
async function uploadWallpaper(file) {
  const video = /^video\//.test(file.type);
  try {
    if (video) toast('subiendo video de fondo…', { ms: 1800 });
    await api.raw('/api/wallpaper', file, { 'Content-Type': file.type });
    await loadWallpaper();
    toast(video ? 'fondo animado activado ❀' : file.type === 'image/gif' ? 'GIF de fondo activado ❀' : 'wallpaper actualizado ❀', { sub: video ? 'sin sonido, en loop · ajustes → fondo para pausarlo con la música' : '' });
  } catch (e) { toast(e.message, { kind: 'err' }); }
}
export function pickWallpaper() {
  const f = $('#filePick'); f.accept = 'image/*,video/mp4,video/webm'; f.onchange = () => { if (f.files[0]) uploadWallpaper(f.files[0]); f.value = ''; }; f.click();
}
bus.on('wallpaper:pick', pickWallpaper);
$('#tWp').onclick = (e) => {
  if (e.shiftKey) return api.del('/api/wallpaper').then(() => { loadWallpaper(); toast('wallpaper por defecto'); });
  pickWallpaper();
};
$('#tTheme').onclick = () => ACTIONS.theme();
$('#tTheme').oncontextmenu = (e) => { e.preventDefault(); ACTIONS.dyn(); };
$('#tVol').onclick = (e) => { e.stopPropagation(); toggleVolPop(); };
$('#cover').onclick = () => toggleFull(true);
$$('#wsNav [data-ws]').forEach((b) => (b.onclick = () => setWs(b.dataset.ws)));

// ---------- barra superior: reloj, cpu, ram, escaneo ----------
const clock = () => { $('#tClock').textContent = new Date().toTimeString().slice(0, 5); };
clock(); setInterval(clock, 10000);
async function sys() {
  if (document.hidden || miniOn) return;
  try { const s = await api.get('/api/sys'); $('#tCpu').textContent = s.cpu + '%'; $('#tRam').textContent = s.ram + '%'; } catch {}
}
sys(); setInterval(sys, 3000);

// ---------- visualizadores ----------
function initViz() {
  attach($('#cv'));
  attach($('#cvMini'), { mode: 'spectrum', small: true });
  attach($('#cvFull'), { mode: 'spectrum' });
  // visualizador de la pantalla completa: modo propio, el mismo del panel o ninguno
  const fullViz = () => { const m = C().fullViz; $('#cvFull').hidden = m === 'off'; setViewMode($('#cvFull'), m === 'same' || m === 'off' ? null : m); };
  bus.on('custom', fullViz); fullViz();
  const box = $('#vizModes');
  box.innerHTML = MODES.map((m) => `<button data-vm="${m.id}">${m.name}</button>`).join('');
  const mark = () => { $$('[data-vm]').forEach((b) => b.classList.toggle('on', b.dataset.vm === P.get('viz'))); $('#vizLbl').textContent = (MODES.find((m) => m.id === P.get('viz')) || MODES[0]).name; };
  box.onclick = (e) => { const b = e.target.closest('[data-vm]'); if (b) setMode(b.dataset.vm); };
  bus.on('viz:mode', mark);
  mark();
  $('#cv').ondblclick = () => cycleMode();
}

// ---------- arranque ----------
async function boot() {
  let server = {};
  try { server = await api.get('/api/settings'); } catch {}
  await P.load(server);
  applyPrefsClasses();
  applyTheme();
  applyCustom();
  bus.on('custom', debounce(() => renderLib(), 150));
  initLibrary();
  initSide();
  initDownloads();
  initSync();
  initYtm();
  initViz();
  initBg();
  initUpdate();
  applyCaps();
  try { setDeps(await api.get('/api/status')); } catch {}
  connectStream();
  await Promise.all([loadLibrary(), loadPlaylists(), loadAuto()]);
  player.restore();
  player.renderNP();
  setWs(P.get('ws') || 'music');
  // eventos del servidor
  const reload = debounce(async () => { await loadLibrary(); loadAuto(); }, 700);
  bus.on('sse:library', reload);
  bus.on('sse:scan', (s) => {
    const el = $('#tScan');
    el.hidden = !s.scanning;
    el.textContent = s.scanning ? `escaneando ${s.done}/${s.total}` : '';
    D.scan = s;
  });
  bus.on('sse:open', reload);
  // si se cierra la cola, cargar mixes automáticos actualizados
  setInterval(() => { if (!document.hidden) loadAuto(); }, 10 * 60000);
}
boot().catch((e) => { console.error(e); toast('error al iniciar: ' + e.message, { kind: 'err', ms: 8000 }); });
