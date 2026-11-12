// panel lateral: cola (reordenable), historial y letras (sincronizadas cuando hay marcas de tiempo)
import { $, $$, bus, P, api, esc, fmtTime, coverUrl, icon, ctxMenu } from './core.js';
import { D, T } from './data.js';
import { S, jump, removeAt, moveIn, clearQueue, playList, current, addQueue, playNext } from './player.js';
import { engine } from './audio.js';
import { getDragIds, trackMenu } from './library.js';

let tab = 'queue';
export function setSideTab(t) {
  tab = t; P.set('sideTab', t);
  $$('#sideTabs .tab').forEach((b) => b.classList.toggle('on', b.dataset.side === t));
  $('#sbQueue').hidden = t !== 'queue'; $('#sbHist').hidden = t !== 'hist'; $('#sbLyrics').hidden = t !== 'lyrics';
  if (t === 'queue') renderQueue(); else if (t === 'hist') renderHist(); else renderLyrics();
}

// ---------- cola ----------
function qrow(t, i, cls) {
  return `<div class="qrow ${cls}" data-qi="${i}" draggable="true"><span class="ix">${i === S.qi ? '♪' : i + 1}</span>
    <img loading="lazy" src="${coverUrl(t.id, 't')}" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'th'}))">
    <div style="min-width:0"><div class="n">${esc(t.title)}</div><div class="a">${esc(t.artist || '—')} · ${fmtTime(t.duration)}</div></div>
    <button class="x" data-qx="${i}" title="quitar">${icon('x')}</button></div>`;
}
function renderQueue() {
  $('#cQueue').textContent = S.queue.length ? `${S.queue.length - Math.max(0, S.qi)}` : '';
  if (tab !== 'queue') return;
  const box = $('#sbQueue');
  if (!S.queue.length) { box.innerHTML = '<div class="empty">la cola está vacía.<br>doble clic en una canción, o arrastrala acá.</div>'; return; }
  const from = Math.max(0, S.qi - 2), to = Math.min(S.queue.length, S.qi + 150);
  let html = `<div class="m" style="display:flex;justify-content:space-between;padding:2px 6px 6px"><span>${S.queue.length} en cola${S.shuffle ? ' · aleatorio' : ''}${S.repeat !== 'off' ? ' · repetir ' + (S.repeat === 'one' ? 'una' : 'todo') : ''}</span><button class="cb sm" id="qClear">limpiar</button></div>`;
  for (let i = from; i < to; i++) { const t = T(S.queue[i]); if (t) html += qrow(t, i, i === S.qi ? 'cur' : i < S.qi ? 'past' : ''); }
  if (to < S.queue.length) html += `<div class="m" style="padding:6px">… y ${S.queue.length - to} más</div>`;
  box.innerHTML = html;
  const cur = box.querySelector('.qrow.cur'); if (cur) cur.scrollIntoView({ block: 'nearest' });
  $('#qClear').onclick = clearQueue;
}
function initQueue() {
  const box = $('#sbQueue');
  box.addEventListener('click', (e) => {
    const x = e.target.closest('[data-qx]'); if (x) { e.stopPropagation(); return removeAt(+x.dataset.qx); }
    const r = e.target.closest('[data-qi]'); if (r) jump(+r.dataset.qi);
  });
  box.addEventListener('contextmenu', (e) => {
    const r = e.target.closest('[data-qi]'); if (!r) return;
    e.preventDefault();
    const i = +r.dataset.qi;
    ctxMenu(e.clientX, e.clientY, [
      { label: 'reproducir ahora', icon: 'play', fn: () => jump(i) },
      { label: 'reproducir después', icon: 'next', fn: () => { const id = S.queue[i]; if (i !== S.qi) { removeAt(i); playNext([id]); } } },
      { label: 'quitar de la cola', icon: 'x', fn: () => removeAt(i) },
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
    const words = raw.replace(LRC, '').replace(/<\d+:\d+(?:\.\d+)?>/g, '').trim();
    for (const s of stamps) out.push({ t: +s[1] * 60 + +s[2] + (s[3] ? +('0.' + s[3]) : 0) - offset, text: words || '♪' });
  }
  return out.sort((a, b) => a.t - b.t);
}
export async function loadLyrics(t) {
  if (!t) { lyr = { id: null }; return paintLyrics(); }
  if (lyr.id === t.id && (lyr.lines || lyr.plain || lyr.none)) return paintLyrics();
  lyr = { id: t.id, loading: true };
  paintLyrics();
  try {
    // las canciones online no tienen archivo: se manda título/artista/duración para buscar la letra
    const qs = String(t.id).startsWith('yt_') ? '?' + new URLSearchParams({ title: t.title || '', artist: t.artist || '', album: t.album || '', duration: String(Math.round(t.duration || 0)) }) : '';
    const j = await api.get('/api/lyrics/' + t.id + qs);
    if (lyr.id !== t.id) return;
    if (j.none || j.error) lyr = { id: t.id, none: true, online: j.online, ytm: j.ytm, ytId: j.ytId };
    else if (j.synced) lyr = { id: t.id, lines: parseLrc(j.text), source: j.source };
    else lyr = { id: t.id, plain: j.text, source: j.source };
  } catch { lyr = { id: t.id, none: true }; }
  paintLyrics();
}
function lyricsHtml() {
  const empty = (title, sub, hint) => `<div class="lyr-empty"><svg class="i"><use href="#i-lyr"/></svg><b>${title}</b>${sub ? `<span class="m">${sub}</span>` : ''}${hint ? `<span class="hint">${hint}</span>` : ''}</div>`;
  if (!lyr.id) return empty('nada sonando', 'la letra aparece acá cuando pongas una canción');
  if (lyr.loading) return `<div class="lyr-empty loading"><svg class="i"><use href="#i-lyr"/></svg><b>buscando la letra…</b></div>`;
  if (lyr.none) return empty('sin letra',
    lyr.ytm && lyr.ytId ? 'YouTube Music no tiene letra para esta versión' : 'no se encontró letra para esta canción',
    lyr.online ? 'se buscó en YouTube Music y LRCLIB' : 'activá LRCLIB en ajustes → letras para buscar en más lugares');
  if (lyr.lines && lyr.lines.length) return lyr.lines.map((l, i) => `<div class="ln" data-l="${i}" data-t="${l.t}">${esc(l.text)}</div>`).join('') + `<div class="src">fuente: ${esc(lyr.source)}</div>`;
  return `<pre>${esc(lyr.plain || '')}</pre><div class="src">fuente: ${esc(lyr.source)} · sin marcas de tiempo</div>`;
}
function paintLyrics() {
  for (const box of [$('#sbLyrics'), $('#fLyrics')]) {
    if (!box || (box.id === 'sbLyrics' && tab !== 'lyrics') || (box.id === 'fLyrics' && $('#full').hidden)) continue;
    box.innerHTML = lyricsHtml();
    box.dataset.cur = '-1';
  }
  syncLyrics(engine.time);
}
function renderLyrics() { if (current()) loadLyrics(current()); else paintLyrics(); }
export function syncLyrics(time) {
  if (!lyr.lines || !lyr.lines.length) return;
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
  for (const id of ['#sbLyrics', '#fLyrics']) $(id).addEventListener('click', (e) => { const l = e.target.closest('[data-t]'); if (l) engine.seek(+l.dataset.t); });
  bus.on('queue', () => { renderQueue(); renderHist(); });
  bus.on('np', (t) => { if (tab === 'lyrics' || !$('#full').hidden) loadLyrics(t); else lyr = { id: null }; });
  bus.on('time', (t) => syncLyrics(t));
  setSideTab(P.get('sideTab') || 'queue');
}
