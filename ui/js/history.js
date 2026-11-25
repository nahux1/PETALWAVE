// historial de música: todo lo que sonó, por día, con cuánto lo escuchaste (sale de las señales de gustos: taste.js)
import { $, esc, icon, coverUrl, toast, confirm2, api } from './core.js';
import { T, remoteTrack } from './data.js';
import { playList } from './player.js';
import { tasteEvents, forgetListens } from './taste.js';

let filter = 'all', limit = 300;
const DAYMS = 86400000;
const fmt = (s) => { s = Math.max(0, Math.round(s || 0)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function dayLabel(ts) {
  const d = new Date(ts), today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.round((today - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / DAYMS);
  if (diff === 0) return 'hoy';
  if (diff === 1) return 'ayer';
  if (diff < 7) return d.toLocaleDateString('es', { weekday: 'long' });
  return d.toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}
const how = (e) => {
  if (e.k === 'skip') return { cls: 'lh-skip', txt: e.s != null ? 'saltada · ' + Math.round(e.s) + ' s' : 'saltada' };
  const r = e.d ? e.s / e.d : 1;
  if (r >= 0.8 || (e.d && e.s >= e.d - 10)) return { cls: 'lh-full', txt: 'entera' };
  return { cls: 'lh-part', txt: fmt(e.s) + (e.d ? ' de ' + fmt(e.d) : '') };
};

// la canción para volver a escucharla (de la biblioteca o, si era online, de YouTube Music)
function trackOf(e) {
  return T(e.id) || (e.yt && (T('yt_' + e.yt) || remoteTrack({ videoId: e.yt, title: e.ti, artists: [e.a], duration: e.d }))) || null;
}

function listens(q) {
  const all = tasteEvents().filter((e) => (e.k === 'play' || e.k === 'skip') && (e.ti || e.id));
  let l = all.slice().sort((a, b) => b.t - a.t);
  if (filter === 'full') l = l.filter((e) => e.k === 'play' && how(e).cls === 'lh-full');
  if (filter === 'skip') l = l.filter((e) => e.k === 'skip');
  if (q) { const n = norm(q); l = l.filter((e) => norm(e.ti + ' ' + e.a).includes(n)); }
  return { all, l };
}

export function renderHistory(head, body) {
  const q = ($('#q') || {}).value ? $('#q').value.trim() : '';
  const { all, l } = listens(q);
  const now = Date.now(), t0 = new Date(); t0.setHours(0, 0, 0, 0);
  const today = all.filter((e) => e.t >= +t0), week = all.filter((e) => now - e.t < 7 * DAYMS);
  const mins = (arr) => Math.round(arr.reduce((a, e) => a + (e.s || 0), 0) / 60);
  const topA = (() => { const m = new Map(); for (const e of week) if (e.k === 'play' && e.a) m.set(e.a, (m.get(e.a) || 0) + 1); return [...m].sort((a, b) => b[1] - a[1])[0]; })();
  const qc = $('#qCount'); if (qc) qc.textContent = q ? `${l.length} resultados` : '';
  head.innerHTML = `<div class="ttlbar"><div><div class="sub">tu música</div><h2>historial</h2>
      <div class="sub">hoy: ${today.length} canciones · ${mins(today)} min · esta semana: ${week.length} · ${mins(week)} min${topA ? ' · lo que más sonó: ' + esc(topA[0]) : ''}</div>
      <div class="acts"><button class="go" data-hh="play">${icon('play')} volver a escuchar</button>
        <span class="xchips hchips">${[['all', 'todo'], ['full', 'escuchadas enteras'], ['skip', 'saltadas']].map(([k, t]) => `<button class="xchip ${filter === k ? 'on' : ''}" data-hf="${k}">${t}</button>`).join('')}</span>
        <button class="cb sm danger" data-hh="clear">borrar historial</button></div></div></div>`;
  if (!l.length) {
    body.innerHTML = `<div class="empty">${all.length ? 'nada con ese filtro' : 'todavía no escuchaste nada: lo que suene va a aparecer acá, por día'}</div>`;
  } else {
    let html = '', last = '';
    for (const e of l.slice(0, limit)) {
      const d = dayLabel(e.t);
      if (d !== last) { html += `<div class="lhday">${esc(d)}</div>`; last = d; }
      const h = how(e), cov = e.yt ? 'yt_' + e.yt : e.id;
      html += `<div class="lhrow ${h.cls}" data-t="${e.t}"><span class="lhtime">${new Date(e.t).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}</span>
        <img loading="lazy" src="${coverUrl(cov, 't')}" onerror="this.classList.add('x')">
        <span class="lhtt"><b>${esc(e.ti || '—')}</b><span>${esc(e.a || '')}</span></span>
        <span class="lhhow">${esc(h.txt)}</span><button class="ib sm" data-hp="${e.t}" title="escuchar">${icon('play')}</button></div>`;
    }
    if (l.length > limit) html += `<div class="lhmore"><button class="cb" data-hh="more">ver más (${l.length - limit})</button></div>`;
    body.innerHTML = `<div class="lhist">${html}</div>`;
  }
  head.querySelectorAll('[data-hf]').forEach((b) => (b.onclick = () => { filter = b.dataset.hf; limit = 300; renderHistory(head, body); }));
  const shown = l.slice(0, limit);
  const playFrom = (i) => {
    // la elegida y, después, las que siguen en el historial (sin repetir)
    const ids = [], seen = new Set();
    for (const e of shown.slice(i)) { const t = trackOf(e); if (t && !seen.has(t.id)) { seen.add(t.id); ids.push(t.id); } if (ids.length >= 200) break; }
    if (!ids.length) return toast('No encuentro esa canción', { kind: 'warn' });
    playList(ids, 0);
  };
  head.querySelector('[data-hh="play"]').onclick = () => playFrom(0);
  head.querySelector('[data-hh="clear"]').onclick = async () => {
    if (!(await confirm2('Borrar historial', 'Se borra la lista de todo lo que escuchaste. <b>Tus ♥, playlists y estadísticas quedan.</b><br>Las recomendaciones van a dejar de tener en cuenta lo que escuchabas.', 'borrar', true))) return;
    try { await api.del('/api/taste?only=listens'); forgetListens(); toast('historial borrado'); renderHistory(head, body); } catch (err) { toast(err.message, { kind: 'err' }); }
  };
  body.onclick = (ev) => {
    if (ev.target.closest('[data-hh="more"]')) { limit += 300; return renderHistory(head, body); }
    const r = ev.target.closest('.lhrow'); if (!r) return;
    const i = shown.findIndex((e) => String(e.t) === r.dataset.t);
    if (i >= 0) playFrom(i);
  };
}
