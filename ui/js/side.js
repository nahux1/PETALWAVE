// panel lateral: cola (reordenable), historial y letras (sincronizadas cuando hay marcas de tiempo)
import { $, $$, bus, P, api, esc, fmtTime, coverUrl, icon, ctxMenu, toast, emptyState, local } from './core.js';
import { D, T } from './data.js';
import { S, jump, removeAt, moveIn, clearQueue, playList, current, addQueue, playNext, insertAt, restoreQueue } from './player.js';
import { engine } from './audio.js';
import { karaoke } from './comfort.js';
import { getLang } from './i18n.js';
import { getDragIds, trackMenu, newPlaylist } from './library.js';
import { djInfo, djOn, toggleDj, djOrder } from './dj.js';
import { isOffline, noteLyrics } from './offline.js';

let tab = 'queue';
export function setSideTab(t) {
  tab = t; P.set('sideTab', t);
  $$('#sideTabs .tab').forEach((b) => b.classList.toggle('on', b.dataset.side === t));
  $('#sbQueue').hidden = t !== 'queue'; $('#sbHist').hidden = t !== 'hist'; $('#sbLyrics').hidden = t !== 'lyrics';
  if (t === 'queue') renderQueue(); else if (t === 'hist') renderHist(); else renderLyrics();
}

// ---------- cola ----------
let dj = false;
function qrow(t, i, cls) {
  return `<div class="qrow ${cls}" data-qi="${i}" draggable="true"><span class="ix">${i === S.qi ? '♪' : i + 1}</span>
    <img loading="lazy" src="${coverUrl(t.id, 't')}" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'th'}))">
    <div style="min-width:0"><div class="n">${esc(t.title)}</div><div class="a">${esc(t.artist || '—')} · ${t.live ? 'en vivo' : fmtTime(t.duration)}${dj && djInfo(t.id) ? ` · <span class="bpm">${Math.round(djInfo(t.id).b)} bpm</span>` : ''}</div></div>
    <button class="x" data-qx="${i}" title="quitar">${icon('x')}</button></div>`;
}
function renderQueue() {
  $('#cQueue').textContent = S.queue.length ? `${S.queue.length - Math.max(0, S.qi)}` : '';
  if (tab !== 'queue') return;
  const box = $('#sbQueue');
  if (!S.queue.length) { box.innerHTML = emptyState('La cola está vacía', 'Tocá una canción, un mix de Inicio o arrastrá canciones acá.', [{ label: 'ir al inicio', attr: 'data-goto="home"' }], '♫'); return; }
  const from = Math.max(0, S.qi - 2), to = Math.min(S.queue.length, S.qi + 150);
  dj = djOn();
  let html = `<div class="m" style="display:flex;justify-content:space-between;gap:6px;padding:2px 6px 6px;flex-wrap:wrap"><span style="flex:1">${S.queue.length} en cola${S.shuffle ? ' · aleatorio' : ''}${S.repeat !== 'off' ? ' · repetir ' + (S.repeat === 'one' ? 'una' : 'todo') : ''}</span><button class="cb sm ${dj ? 'on' : ''}" data-act="dj" id="qDj" title="modo DJ: cruces largos a tempo, entrando en el golpe">🎧 DJ</button>${dj ? '<button class="cb sm" id="qDjSort" title="ordenar lo que queda por ritmo y energía">⇅ ordenar</button>' : ''}<button class="cb sm" id="qSave" title="guardar la cola como playlist">guardar</button><button class="cb sm" id="qClear">limpiar</button></div>`;
  for (let i = from; i < to; i++) { const t = T(S.queue[i]); if (t) html += qrow(t, i, i === S.qi ? 'cur' : i < S.qi ? 'past' : ''); }
  if (to < S.queue.length) html += `<div class="m" style="padding:6px">… y ${S.queue.length - to} más</div>`;
  box.innerHTML = html;
  const cur = box.querySelector('.qrow.cur'); if (cur) cur.scrollIntoView({ block: 'nearest' });
  $('#qClear').onclick = () => {
    const q = S.queue.slice(), qi = S.qi;
    clearQueue();
    toast('cola vaciada', { action: { label: 'deshacer', fn: () => restoreQueue(q, qi) }, ms: 5000 });
  };
  $('#qSave').onclick = () => newPlaylist(S.queue.slice());
  $('#qDj').onclick = () => toggleDj();
  const ds = $('#qDjSort'); if (ds) ds.onclick = () => djOrder();
}
// quitar con "deshacer" (por si se tocó sin querer)
function removeWithUndo(i) {
  if (i === S.qi) return removeAt(i);
  const id = S.queue[i], t = T(id);
  removeAt(i);
  toast('quitada de la cola', { sub: t ? t.title : '', action: { label: 'deshacer', fn: () => insertAt(i, id) }, ms: 5000 });
}
function initQueue() {
  const box = $('#sbQueue');
  box.addEventListener('click', (e) => {
    const x = e.target.closest('[data-qx]'); if (x) { e.stopPropagation(); return removeWithUndo(+x.dataset.qx); }
    const r = e.target.closest('[data-qi]'); if (r) jump(+r.dataset.qi);
  });
  box.addEventListener('contextmenu', (e) => {
    const r = e.target.closest('[data-qi]'); if (!r) return;
    e.preventDefault();
    const i = +r.dataset.qi;
    ctxMenu(e.clientX, e.clientY, [
      { label: 'reproducir ahora', icon: 'play', fn: () => jump(i) },
      { label: 'reproducir después', icon: 'next', fn: () => { const id = S.queue[i]; if (i !== S.qi) { removeAt(i); playNext([id]); } } },
      i > S.qi + 1 && { label: 'que suene después', icon: 'next', fn: () => moveIn(i, S.qi + 1) },
      i > 0 && i !== S.qi && { label: 'subir', icon: 'back', fn: () => moveIn(i, i - 1) },
      i < S.queue.length - 1 && i !== S.qi && { label: 'bajar', icon: 'fwd', fn: () => moveIn(i, i + 2) },
      { label: 'quitar de la cola', icon: 'x', fn: () => removeWithUndo(i) },
      { sep: true },
      { label: 'más opciones…', icon: 'more', fn: () => trackMenu(e.clientX, e.clientY, [S.queue[i]]) },
    ]);
  });
  let dragQ = -1;
  box.addEventListener('dragstart', (e) => { const r = e.target.closest('[data-qi]'); if (r) { dragQ = +r.dataset.qi; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', 'q'); } });
  box.addEventListener('dragend', () => { dragQ = -1; $$('.qrow.dragover').forEach((r) => r.classList.remove('dragover')); });
  box.addEventListener('dragover', (e) => {
    if (dragQ < 0 && !getDragIds()) return;
    e.preventDefault();
    $$('.qrow.dragover').forEach((r) => r.classList.remove('dragover'));
    const r = e.target.closest('[data-qi]'); if (r) r.classList.add('dragover');
  });
  box.addEventListener('drop', (e) => {
    e.preventDefault();
    const r = e.target.closest('[data-qi]');
    const to = r ? +r.dataset.qi : S.queue.length;
    if (dragQ >= 0) { moveIn(dragQ, to); dragQ = -1; return; }
    const ids = getDragIds();
    if (ids) { if (!S.queue.length) playList(ids, 0); else if (r) { S.queue.splice(to, 0, ...ids); if (to <= S.qi) S.qi += ids.length; bus.emit('queue'); } else addQueue(ids); }
  });
}

// ---------- historial ----------
function renderHist() {
  if (tab !== 'hist') return;
  const box = $('#sbHist');
  const list = S.history.map(T).filter(Boolean);
  if (!list.length) { box.innerHTML = '<div class="empty">todavía no escuchaste nada en esta sesión</div>'; return; }
  box.innerHTML = list.map((t, i) => `<div class="qrow" data-h="${i}"><span class="ix">${i + 1}</span><img loading="lazy" src="${coverUrl(t.id, 't')}" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'th'}))"><div style="min-width:0"><div class="n">${esc(t.title)}</div><div class="a">${esc(t.artist || '—')}</div></div><span></span></div>`).join('');
  box.onclick = (e) => { const r = e.target.closest('[data-h]'); if (r) playList(S.history.slice(), +r.dataset.h); };
}

// ---------- letras ----------
let lyr = { id: null, lines: null, plain: '', source: '', loading: false, none: false, online: false };
const LRC = /\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
function parseLrc(text) {
  const out = [];
  let offset = 0;
  const off = /\[offset:\s*([+-]?\d+)\]/i.exec(text); if (off) offset = +off[1] / 1000;
  for (const raw of text.split(/\r?\n/)) {
    const stamps = [...raw.matchAll(LRC)];
    if (!stamps.length) continue;
    const body = raw.replace(LRC, '');
    const words = body.replace(/<\d+:\d+(?:\.\d+)?>/g, '').replace(/\s+/g, ' ').trim();
    // tiempos por palabra si la letra los trae; si no, el karaoke los estima
    let wt = null;
    if (/<\d+:\d+/.test(body)) {
      wt = [];
      for (const m of body.matchAll(/<(\d+):(\d+(?:\.\d+)?)>\s*([^<]*)/g)) for (const w of m[3].trim().split(/\s+/).filter(Boolean)) wt.push(+m[1] * 60 + +m[2] - offset);
      if (wt.length !== words.split(' ').length) wt = null;
    }
    for (const s of stamps) out.push({ t: +s[1] * 60 + +s[2] + (s[3] ? +('0.' + s[3]) : 0) - offset, text: words || '♪', wt });
  }
  return out.sort((a, b) => a.t - b.t);
}
export async function loadLyrics(t) {
  if (!t) { lyr = { id: null }; return paintLyrics(); }
  if (lyr.id === t.id && (lyr.lines || lyr.plain || lyr.none)) return paintLyrics();
  if (t.cast) { lyr = { id: t.id, none: true, cast: t.cast }; return paintLyrics(); }
  lyr = { id: t.id, loading: true };
  paintLyrics();
  try {
    // las canciones online no tienen archivo: se manda título/artista/duración para buscar la letra
    const off = isOffline();
    const prm = String(t.id).startsWith('yt_') ? { title: t.title || '', artist: t.artist || '', album: t.album || '', duration: String(Math.round(t.duration || 0)) } : {};
    if (off) prm.off = '1';   // sin internet: solo las guardadas (no esperar a que fallen las búsquedas)
    const qs = Object.keys(prm).length ? '?' + new URLSearchParams(prm) : '';
    const j = await api.get('/api/lyrics/' + t.id + qs);
    if (lyr.id !== t.id) return;
    if (j.text) noteLyrics(t.id);
    if (j.none || j.error) lyr = { id: t.id, none: true, online: j.online, ytm: j.ytm, ytId: j.ytId, offline: j.offline || off };
    else if (j.synced) lyr = { id: t.id, lines: parseLrc(j.text), source: j.source };
    else lyr = { id: t.id, plain: j.text, source: j.source };
  } catch { lyr = { id: t.id, none: true }; }
  // si ya se tradujo esta letra antes, se muestra traducida
  try { const c = (local.get('pw-lyr-tr', {}) || {})[t.id + ':' + getLang()]; if (c && (lyr.lines || lyr.plain)) lyr.tr = c.lines; } catch {}
  paintLyrics();
}
function lyricsHtml() {
  const empty = (title, sub, hint) => `<div class="lyr-empty"><svg class="i"><use href="#i-lyr"/></svg><b>${title}</b>${sub ? `<span class="m">${sub}</span>` : ''}${hint ? `<span class="hint">${hint}</span>` : ''}</div>`;
  if (!lyr.id) return empty('nada sonando', 'la letra aparece acá cuando pongas una canción');
  if (lyr.loading) return `<div class="lyr-empty loading"><svg class="i"><use href="#i-lyr"/></svg><b>buscando la letra…</b></div>`;
  if (lyr.none && lyr.cast) return empty(lyr.cast === 'radio' ? 'radio en vivo' : 'podcast', lyr.cast === 'radio' ? 'las radios no tienen letra · arriba se ve el tema que está pasando (si la radio lo manda)' : 'los podcasts no tienen letra');
  if (lyr.none && lyr.offline) return empty('✈ sin internet', 'la letra de esta canción no quedó guardada', 'cuando vuelva internet aparece sola · las letras de lo que escuchás se guardan solas');
  if (lyr.none) return empty('sin letra',
    lyr.ytm && lyr.ytId ? 'YouTube Music no tiene letra para esta versión' : 'no se encontró letra para esta canción',
    lyr.online ? 'se buscó en YouTube Music y LRCLIB' : 'activá LRCLIB en ajustes → letras para buscar en más lugares');
  const tr = lyr.tr, tools = `<div class="lyr-tools"><button class="cb sm" data-lt="tr">${tr ? 'ocultar traducción' : '🌐 traducir'}</button></div>`;
  if (lyr.lines && lyr.lines.length) return tools + lyr.lines.map((l, i) => `<div class="ln" data-l="${i}" data-t="${l.t}">${l.text.split(' ').map((w) => `<span class="lw">${esc(w)}</span>`).join(' ')}${tr && tr[i] && tr[i] !== l.text ? `<div class="tr">${esc(tr[i])}</div>` : ''}</div>`).join('') + `<div class="src">fuente: ${esc(lyr.source)}${tr ? ' · traducción: MyMemory' : ''}</div>`;
  return tools + `<pre>${esc(lyr.plain || '')}</pre>${tr ? `<pre class="tr">${esc(tr.join('\n'))}</pre>` : ''}<div class="src">fuente: ${esc(lyr.source)} · sin marcas de tiempo</div>`;
}
function paintLyrics() {
  for (const box of [$('#sbLyrics'), $('#fLyrics')]) {
    if (!box || (box.id === 'sbLyrics' && tab !== 'lyrics') || (box.id === 'fLyrics' && $('#full').hidden)) continue;
    box.innerHTML = lyricsHtml();
    box.dataset.cur = '-1';
  }
  syncLyrics(engine.time);
}
// traducir la letra (MyMemory: gratis, ~5000 letras por día sin cuenta). Cada traducción se guarda y no se vuelve a pedir.
const TR_KEY = 'pw-lyr-tr';
async function toggleTranslation() {
  if (lyr.tr) { lyr.tr = null; lyr.trOff = true; return paintLyrics(); }
  const src = lyr.lines ? lyr.lines.map((l) => l.text) : String(lyr.plain || '').split(/\r?\n/);
  if (!src.length) return;
  const to = getLang();
  const cache = local.get(TR_KEY, {}) || {}, ck = lyr.id + ':' + to;
  if (cache[ck]) { lyr.tr = cache[ck].lines; lyr.trOff = false; return paintLyrics(); }
  const id = lyr.id;
  toast('traduciendo la letra…', { ms: 1500 });
  try {
    // de a pedazos de hasta 480 letras, cortando entre líneas (♪ y líneas repetidas no se mandan dos veces)
    const uniq = [...new Set(src.filter((s) => s && s !== '♪'))];
    const chunks = []; let cur = [];
    for (const s of uniq) { if ((cur.join('\n') + '\n' + s).length > 480 && cur.length) { chunks.push(cur); cur = []; } cur.push(s.slice(0, 480)); }
    if (cur.length) chunks.push(cur);
    const map = new Map(); let same = 0;
    for (const c of chunks) {
      const r = await fetch('https://api.mymemory.translated.net/get?' + new URLSearchParams({ q: c.join('\n'), langpair: 'autodetect|' + to }), { signal: AbortSignal.timeout(15000) }).then((x) => x.json());
      if (r.quotaFinished || r.responseStatus === 429) throw new Error('se terminaron las traducciones gratis de hoy: mañana se puede de nuevo');
      if (r.responseStatus !== 200 && r.responseStatus !== '200') throw new Error(String(r.responseDetails || 'el traductor no respondió').slice(0, 120));
      const det = r.responseData && r.responseData.detectedLanguage;
      if (det && det.slice(0, 2) === to) same++;
      const out = String(r.responseData.translatedText || '').split(/\r?\n/);
      c.forEach((s, i) => map.set(s, out.length === c.length ? out[i] : (i === 0 ? out.join(' ') : '')));
    }
    if (same === chunks.length) { toast('la letra ya está en ' + ({ es: 'español', en: 'inglés', pt: 'portugués' }[to] || to), { ms: 1800 }); return; }
    const lines = src.map((s) => map.get(s) || (s === '♪' ? '♪' : ''));
    cache[ck] = { lines, at: Date.now() };
    const keys = Object.keys(cache).sort((a, b) => cache[b].at - cache[a].at);
    for (const k of keys.slice(60)) delete cache[k];   // las últimas 60 canciones
    local.set(TR_KEY, cache);
    if (lyr.id === id) { lyr.tr = lines; lyr.trOff = false; paintLyrics(); }
  } catch (e) { toast('no se pudo traducir', { kind: 'err', sub: e.message }); }
}
function renderLyrics() { if (current()) loadLyrics(current()); else paintLyrics(); }
export function syncLyrics(time) {
  if (!lyr.lines || !lyr.lines.length) return;
  for (const box of [$('#sbLyrics'), $('#fLyrics')]) if (box && box.offsetParent !== null) karaoke(time, lyr.lines, box);
  let i = -1;
  for (let k = 0; k < lyr.lines.length; k++) { if (lyr.lines[k].t <= time + 0.15) i = k; else break; }
  for (const box of [$('#sbLyrics'), $('#fLyrics')]) {
    if (!box || box.offsetParent === null || box.dataset.cur === String(i)) continue;
    box.dataset.cur = String(i);
    box.querySelectorAll('.ln').forEach((el, k) => { el.classList.toggle('on', k === i); el.classList.toggle('past', k < i); });
    const on = box.querySelector('.ln.on');
    if (on) box.scrollTo({ top: on.offsetTop - box.clientHeight * 0.38, behavior: 'smooth' });
  }
}
export function refreshFullLyrics() { paintLyrics(); }

export function initSide() {
  initQueue();
  $('#sideTabs .tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-side]'); if (b) setSideTab(b.dataset.side); });
  for (const id of ['#sbLyrics', '#fLyrics']) $(id).addEventListener('click', (e) => {
    if (e.target.closest('[data-lt="tr"]')) return toggleTranslation();
    const l = e.target.closest('[data-t]'); if (l) engine.seek(+l.dataset.t);
  });
  bus.on('queue', () => { renderQueue(); renderHist(); });
  bus.on('np', (t) => { if (tab === 'lyrics' || !$('#full').hidden) loadLyrics(t); else lyr = { id: null }; });
  bus.on('queue:paint', () => { if (tab === 'queue' && djOn()) renderQueue(); });
  // volvió internet: si la letra no estaba guardada, buscarla de nuevo
  bus.on('offline', (off) => { if (!off && lyr.offline && lyr.id) { const t = T(lyr.id); lyr = { id: null }; if (t && (tab === 'lyrics' || !$('#full').hidden)) loadLyrics(t); } });
  bus.on('time', (t) => syncLyrics(t));
  setSideTab(P.get('sideTab') || 'queue');
}
