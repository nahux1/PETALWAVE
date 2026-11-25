// buscador único (tecla /): tu biblioteca, artistas, playlists y YouTube Music en un solo lugar, mientras escribís
import { $, api, bus, esc, icon, coverUrl, norm, debounce, local } from './core.js';
import { D, T, remoteTrack } from './data.js';
import { playList } from './player.js';
import { go } from './library.js';

const HIST = 'pw-gs-hist';
let items = [];       // resultados en pantalla (para teclado y clics)
let sel = 0, lastQ = '', onlineFor = '', online = [];

const words = (q) => norm(q).split(/\s+/).filter(Boolean);
const matches = (s, ws) => ws.every((w) => s.includes(w));

function localResults(q) {
  const ws = words(q);
  if (!ws.length) return { songs: [], artists: [], pls: [] };
  const songs = D.tracks.filter((t) => matches(t._s || norm(t.title + ' ' + t.artist), ws))
    .sort((a, b) => (D.plays[b.id] || 0) - (D.plays[a.id] || 0)).slice(0, 8);
  const seen = new Set(), artists = [];
  for (const t of D.tracks) { const a = t._a; if (!a || seen.has(a)) continue; if (matches(norm(a), ws)) { seen.add(a); artists.push({ name: a, id: t.id }); if (artists.length >= 4) break; } }
  const pls = D.playlists.filter((p) => matches(norm(p.name), ws)).slice(0, 4);
  return { songs, artists, pls };
}

function render() {
  const box = $('#gsRes');
  const q = $('#gsQ').value.trim();
  items = [];
  const it = (kind, html, act, warm) => { items.push(act); return `<div class="gs-it" data-i="${items.length - 1}"${warm ? ` data-warm="${esc(warm)}"` : ''}>${html}</div>`; };
  const songRow = (t, sub) => `<img src="${coverUrl(t.id, 't')}" onerror="this.classList.add('x')"><div class="gs-t"><b>${esc(t.title)}</b><span>${esc(sub || t.artist || '')}</span></div>`;
  if (!q) {
    const hist = local.get(HIST, []) || [];
    box.innerHTML = hist.length ? `<div class="gs-h">búsquedas recientes</div>` + hist.map((h) => it('h', `<span class="gs-ic">${icon('hist')}</span><div class="gs-t"><b>${esc(h)}</b></div>`, () => { $('#gsQ').value = h; onInput(); })).join('')
      : '<div class="gs-empty">Buscá en tu música y en YouTube Music al mismo tiempo ❀</div>';
    return paintSel();
  }
  const r = localResults(q);
  let html = '';
  if (r.songs.length) html += '<div class="gs-h">en tu biblioteca</div>' + r.songs.map((t, i) => it('s', songRow(t), () => { playList(r.songs.map((x) => x.id), i); remember(q); })).join('');
  if (r.artists.length) html += '<div class="gs-h">artistas</div>' + r.artists.map((a) => it('a', `<img class="round" src="${coverUrl(a.id, 't')}" onerror="this.classList.add('x')"><div class="gs-t"><b>${esc(a.name)}</b><span>artista</span></div>`, () => { bus.emit('ws', 'music'); go({ type: 'artist', key: a.name }); remember(q); })).join('');
  if (r.pls.length) html += '<div class="gs-h">playlists</div>' + r.pls.map((p) => it('p', `<span class="gs-ic">${icon(p.id === 'liked' ? 'heart' : 'lyr')}</span><div class="gs-t"><b>${esc(p.name)}</b><span>${p.tracks.length} canciones</span></div>`, () => { bus.emit('ws', 'music'); go({ type: 'pl', key: p.id }); remember(q); })).join('');
  const have = new Set(D.tracks.map((t) => t.ytId).filter(Boolean));
  const on = onlineFor === q ? online.filter((x) => !have.has(x.videoId)).slice(0, 8) : [];
  html += '<div class="gs-h">youtube music' + (onlineFor !== q ? ' · buscando…' : '') + '</div>';
  if (on.length) html += on.map((x, i) => { const t = T('yt_' + x.videoId) || remoteTrack(x); return it('o', songRow(t, '☁ ' + (t.artist || 'online')), () => { playList(on.map((y) => 'yt_' + y.videoId), i); remember(q); }, x.videoId); }).join('');
  else if (onlineFor === q) html += '<div class="gs-empty sm">sin resultados online</div>';
  box.innerHTML = html || '<div class="gs-empty">nada por acá</div>';
  paintSel();
}
function paintSel() {
  sel = Math.max(0, Math.min(sel, items.length - 1));
  document.querySelectorAll('#gsRes .gs-it').forEach((el) => el.classList.toggle('on', +el.dataset.i === sel));
}
function remember(q) {
  const h = [q, ...(local.get(HIST, []) || []).filter((x) => x !== q)].slice(0, 8);
  local.set(HIST, h);
  close();
}
const searchOnline = debounce(async (q) => {
  if (q.length < 2) return;
  try { const r = await api.get('/api/ytm/search?filter=songs&q=' + encodeURIComponent(q)); if ($('#gsQ').value.trim() !== q) return; online = (r.items || []).filter((x) => x.videoId && !x.isVideo); }
  catch { online = []; }
  onlineFor = q;
  render();
}, 350);
function onInput() {
  const q = $('#gsQ').value.trim();
  if (q === lastQ) return;
  lastQ = q; sel = 0;
  render();
  if (q.length >= 2) searchOnline(q);
}

export function open() {
  const g = $('#gsearch');
  g.hidden = false;
  document.body.classList.add('gs-open');
  const inp = $('#gsQ');
  inp.value = ''; lastQ = ''; render();
  setTimeout(() => inp.focus(), 30);
}
export function close() { $('#gsearch').hidden = true; document.body.classList.remove('gs-open'); }

export function initGsearch() {
  const inp = $('#gsQ');
  inp.addEventListener('input', onInput);
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); sel++; paintSel(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel--; paintSel(); }
    else if (e.key === 'Enter') { e.preventDefault(); const a = items[sel]; if (a) a(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
  });
  $('#gsRes').addEventListener('click', (e) => { const r = e.target.closest('.gs-it'); if (r && items[+r.dataset.i]) items[+r.dataset.i](); });
  $('#gsClose').onclick = close;
  $('#gsearch').addEventListener('click', (e) => { if (e.target.id === 'gsearch') close(); });
  bus.on('gsearch', open);
  bus.on('gsearch:close', close);
}
