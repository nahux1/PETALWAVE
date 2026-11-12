// biblioteca: vistas (canciones, artistas, álbumes, géneros, años, recientes, duplicados, playlists, automáticas),
// búsqueda instantánea, lista virtualizada, selección múltiple, menú contextual, arrastrar a playlists y edición de etiquetas
import { $, $$, bus, P, api, esc, fmtTime, fmtSize, norm, icon, coverUrl, toast, modal, prompt2, confirm2, ctxMenu, debounce, ago } from './core.js';
import { D, T, loadLibrary, loadPlaylists, loadAuto, plOp, trackLabel, ytm, loadYtmList, loadYtmPlaylists } from './data.js';
import { playList, playNext, addQueue, radio, S as PS, current } from './player.js';
import { openRadio } from './ytmui.js';
import { C } from './custom.js';

const ROW_H = () => (document.body.classList.contains('compact') ? 38 : C().rowH);
const COLS = '44px minmax(0,2.6fr) minmax(0,1.3fr) 60px 42px 64px 32px';
let view = { type: 'songs' };
let ids = [];                 // ids visibles en la vista actual (después de buscar/filtrar/ordenar)
let sel = new Set(), anchor = -1;
let dupes = [];

export const lib = { view: () => view, ids: () => ids };

// ---------- navegación ----------
export function go(v) {
  view = v;
  sel.clear(); anchor = -1;
  $$('#lnav [data-view], #lnav [data-pl], #lnav [data-auto], #lnav [data-ytm]').forEach((b) => b.classList.toggle('on',
    (b.dataset.view && b.dataset.view === v.type && !v.key) || (b.dataset.pl && v.type === 'pl' && b.dataset.pl === v.key) ||
    (b.dataset.auto && v.type === 'auto' && b.dataset.auto === v.key) || (b.dataset.ytm && v.type === 'ytm' && b.dataset.ytm === v.key)));
  $('#lbody').scrollTop = 0;
  if (['songs', 'artists', 'albums', 'genres', 'years', 'recent', 'dupes'].includes(v.type) && !v.key) P.set('libView', v.type);
  render();
}

function applyNavFilter() {
  const q = norm(($('#navFlt') || {}).value || '').trim();
  $$('#navYtm [data-ytm], #navPl [data-pl], #navAuto [data-auto]').forEach((b) => b.classList.toggle('flt-hide', !!q && !norm(b.textContent).includes(q)));
  // al buscar, abrir las secciones para que se vean los resultados
  if (q) $$('#lnav .lgrp.closed').forEach((g) => { if (g.dataset.grp !== 'lib') g.classList.add('peek'), g.classList.remove('closed'); });
  else $$('#lnav .lgrp.peek').forEach((g) => { g.classList.remove('peek'); g.classList.add('closed'); });
}
function renderNav() {
  const artists = new Set(), albums = new Set();
  for (const t of D.tracks) { artists.add(t._a); if (t.album) albums.add(t.album + '|' + (t.albumArtist || t.artist)); }
  $('#cSongs').textContent = D.tracks.length || '';
  $('#cArtists').textContent = artists.size || '';
  $('#cAlbums').textContent = albums.size || '';
  $('#navAuto').innerHTML = D.auto.slice(0, 9).map((a) => `<button data-auto="${esc(a.id)}" title="${esc(a.desc)}">${esc(a.name)}<span class="c">${a.tracks.length}</span></button>`).join('') || '<div class="m" style="padding:2px 8px">escuchá algo y aparecen tus mixes</div>';
  // listas de tu cuenta de YouTube Music: suenan online sin descargar (lo que ya tenés, desde el archivo)
  const st = ytm.status;
  const cnt = (k) => { const l = ytm.lists.get(k); return l ? l.ids.length : ''; };
  $('#navYtm').innerHTML = !st ? '<div class="ytm-hint">conectando…</div>'
    : !st.auth ? `<div class="ytm-hint">iniciá sesión en <a data-goytm>YouTube Music (3)</a> para ver tus me gusta y playlists acá, sin descargar</div>`
    : `<button data-ytm="liked">${icon('heart')}me gusta<span class="c">${cnt('liked')}</span></button>` +
      (ytm.playlists || []).filter((p) => p.playlistId && p.playlistId !== 'LM' && p.playlistId !== 'SE').map((p) => `<button data-ytm="${esc(p.playlistId)}" title="${esc(p.title)}">${icon('sync')}${esc(p.title)}<span class="c">${cnt(p.playlistId) || p.count || ''}</span></button>`).join('');
  $$('#lnav [data-ytm]').forEach((b) => b.classList.toggle('on', view.type === 'ytm' && b.dataset.ytm === view.key));
  $('#navPl').innerHTML = D.playlists.map((p) => `<button data-pl="${esc(p.id)}">${icon('lyr')}${esc(p.name)}<span class="c">${p.tracks.length}</span></button>`).join('') || '<div class="m" style="padding:2px 8px">sin playlists todavía</div>';
  // re-marcar la vista activa
  $$('#lnav [data-pl]').forEach((b) => b.classList.toggle('on', view.type === 'pl' && b.dataset.pl === view.key));
  $$('#lnav [data-auto]').forEach((b) => b.classList.toggle('on', view.type === 'auto' && b.dataset.auto === view.key));
  applyNavFilter();
}

// ---------- datos de cada vista ----------
function filtered(list) {
  const q = norm($('#q').value.trim()), ext = $('#fExt').value, kind = $('#fKind').value;
  const words = q ? q.split(/\s+/) : [];
  const isVid = (t) => !!(t.video || t.isVideo);
  return list.filter((t) => t && (!ext || t.ext === ext) && (!kind || (kind === 'video') === isVid(t)) && words.every((w) => t._s.includes(w)));
}
const SORTS = {
  title: (a, b) => a.title.localeCompare(b.title, 'es', { sensitivity: 'base' }),
  artist: (a, b) => a._a.localeCompare(b._a, 'es', { sensitivity: 'base' }) || (a.album || '').localeCompare(b.album || '') || (a.trackNo || 0) - (b.trackNo || 0),
  album: (a, b) => (a.album || '￿').localeCompare(b.album || '￿', 'es') || (a.trackNo || 0) - (b.trackNo || 0),
  duration: (a, b) => a.duration - b.duration,
  plays: (a, b) => (D.plays[a.id] || 0) - (D.plays[b.id] || 0),
  added: (a, b) => a.added - b.added,
  ext: (a, b) => a.ext.localeCompare(b.ext),
  year: (a, b) => (a.year || 0) - (b.year || 0),
};
function sorted(list, sort) {
  if (!sort) return list;
  const f = SORTS[sort.key] || SORTS.added;
  return list.slice().sort((a, b) => f(a, b) * sort.dir);
}

// orden por vista (playlists, YouTube Music, mixes…): null = orden original de la lista
const viewSorts = new Map();
const vkey = () => view.type + ':' + (typeof view.key === 'object' ? JSON.stringify(view.key) : view.key || '');
const curSort = () => (view.type === 'songs' ? P.get('libSort') : viewSorts.get(vkey()) || null);
function viewTracks() {
  const vs = view.type === 'songs' ? null : viewSorts.get(vkey());
  const list = viewTracksRaw();
  return vs ? sorted(list, vs) : list;
}
function viewTracksRaw() {
  const all = D.tracks;
  switch (view.type) {
    case 'songs': return sorted(filtered(all), P.get('libSort'));
    case 'recent': return filtered(all).sort((a, b) => b.added - a.added).slice(0, 200);
    case 'artist': return sorted(filtered(all.filter((t) => t._a === view.key)), { key: 'album', dir: 1 });
    case 'album': return filtered(all.filter((t) => t.album === view.key.album && (t.albumArtist || t.artist) === view.key.artist)).sort((a, b) => (a.discNo || 0) - (b.discNo || 0) || (a.trackNo || 0) - (b.trackNo || 0) || a.title.localeCompare(b.title));
    case 'genre': return sorted(filtered(all.filter((t) => (t.genre || '—') === view.key)), P.get('libSort'));
    case 'year': return sorted(filtered(all.filter((t) => String(t.year || '—') === view.key)), { key: 'artist', dir: 1 });
    case 'pl': { const p = D.playlists.find((x) => x.id === view.key); return p ? filtered(p.tracks.map(T)) : []; }
    case 'auto': { const a = D.auto.find((x) => x.id === view.key); return a ? filtered(a.tracks.map(T)) : []; }
    case 'ytm': {
      const l = ytm.lists.get(view.key);
      if (!l || Date.now() - l.at > 5 * 60e3) loadYtmList(view.key);   // sincronizar en segundo plano
      return l ? filtered(l.ids.map(T)) : [];
    }
    default: return [];
  }
}

// ---------- render ----------
export function render() {
  const head = $('#lhead'), body = $('#lbody');
  body.oncontextmenu = null;
  const q = $('#q').value.trim();
  if (['artists', 'albums', 'genres', 'years'].includes(view.type) && !q) return renderGroups(head, body);
  if (view.type === 'dupes') return renderDupes(head, body);
  // con búsqueda escrita en una vista de grupos, mostrar canciones
  const list = ['artists', 'albums', 'genres', 'years'].includes(view.type) ? sorted(filtered(D.tracks), P.get('libSort')) : viewTracks();
  ids = list.map((t) => t.id);
  $('#qCount').textContent = q ? `${ids.length} resultados` : '';
  head.innerHTML = headerHtml(list) + tableHead();
  bindHeader(head, list);
  renderTable(body);
}

function headerHtml(list) {
  const total = list.reduce((a, t) => a + (t.duration || 0), 0);
  const sub = `${list.length} canciones · ${fmtTime(total)}`;
  const acts = (extra = '') => `<div class="acts"><button class="go" data-h="play">${icon('play')} reproducir</button><button class="cb" data-h="shuffle">${icon('shuf')} aleatorio</button>${extra}</div>`;
  const big = (title, coverId, kind, extra) => `<div class="ttlbar">${coverId ? `<img class="hcover" src="${coverUrl(coverId)}" onerror="this.style.visibility='hidden'">` : ''}<div><div class="sub">${esc(kind)}</div><h2 data-raw>${esc(title)}</h2><div class="sub">${sub}</div>${acts(extra)}</div></div>`;
  const firstCover = (l) => (l.find((t) => t.hasCover || t.video) || l[0] || {}).id;
  switch (view.type) {
    case 'artist': return big(view.key, firstCover(list), 'artista', `<button class="cb" data-h="radio">${icon('radio')} radio</button>`);
    case 'album': return big(view.key.album, firstCover(list), 'álbum · ' + view.key.artist);
    case 'genre': return big(view.key, null, 'género');
    case 'year': return big(view.key, null, 'año');
    case 'pl': { const p = D.playlists.find((x) => x.id === view.key); return p ? big(p.name, firstCover(list), 'playlist · arrastrá para ordenar', `<button class="cb" data-h="rename">renombrar</button><button class="cb danger" data-h="delpl">borrar</button>`) : ''; }
    case 'auto': { const a = D.auto.find((x) => x.id === view.key); return a ? big(a.name, firstCover(list), a.desc, `<button class="cb" data-h="savepl">guardar como playlist</button>`) : ''; }
    case 'ytm': {
      const l = ytm.lists.get(view.key) || {};
      const pl = (ytm.playlists || []).find((p) => p.playlistId === view.key);
      const online = list.filter((t) => t.remote).length;
      const name = view.key === 'liked' ? 'Me gusta' : (pl && pl.title) || l.title || 'playlist';
      const syncTxt = ytm.loading.has(view.key) ? 'sincronizando…' : l.at ? 'sincronizado ' + ago(l.at) : '';
      const noVid = $('#fKind').value === 'audio';
      const extra = `<button class="cb" data-h="ytmsync">${icon('sync')} actualizar</button>${online ? `<button class="cb" data-h="ytmdl">${icon('dl')} descargar las ${online} online</button>` : ''}<button class="cb ${noVid ? 'on' : ''}" data-h="novideo" title="ocultar videoclips y videos subidos por usuarios">sin videos</button>`;
      return `<div class="ttlbar"><img class="hcover" src="${pl && pl.thumb ? esc(pl.thumb) : coverUrl((list[0] || {}).id || '')}" referrerpolicy="no-referrer" onerror="this.style.visibility='hidden'"><div>
        <div class="sub">youtube music · ☁ ${online} online sin descargar · ${list.length - online} en tu PC · ${esc(syncTxt)}</div><h2 data-raw>${esc(name)}</h2>
        <div class="sub">${sub}${l.error ? ' · <span style="color:var(--warn)">' + esc(l.error) + '</span>' : ''}</div>${acts(extra)}</div></div>`;
    }
    case 'recent': return `<div class="ttlbar"><div><h2>recientes</h2><div class="sub">lo último que entró a la biblioteca · ${sub}</div>${acts()}</div></div>`;
    default: return `<div class="ttlbar" style="padding-bottom:6px"><div><div class="sub">${sub}${D.scan && D.scan.scanning ? ' · escaneando…' : ''}</div>${acts()}</div></div>`;
  }
}
function tableHead() {
  const s = curSort();
  const h = (k, l) => `<span data-sort="${k}" class="${s && s.key === k ? 'on' : ''}" title="ordenar por ${l}">${l}${s && s.key === k ? (s.dir > 0 ? ' ↑' : ' ↓') : ''}</span>`;
  const orig = view.type !== 'songs' ? `<span data-sort="" class="${s ? '' : 'on'}" title="orden original de la lista">#</span>` : '<span>#</span>';
  return `<div class="thead">${orig}${h('title', 'título')}${h('album', 'álbum')}${h('duration', 'dur')}${h('plays', '▶')}${h('ext', 'fmt')}<span></span></div>`;
}
function bindHeader(head, list) {
  head.querySelectorAll('[data-sort]').forEach((el) => (el.onclick = () => {
    const k = el.dataset.sort;
    const first = k === 'added' || k === 'plays' ? -1 : 1;
    if (view.type === 'songs') {
      if (!k) return;
      const s = P.get('libSort');
      P.set('libSort', s.key === k ? { key: k, dir: -s.dir } : { key: k, dir: first });
    } else {
      // ascendente → descendente → orden original (como pide la gente en YouTube Music y Spotify)
      const s = viewSorts.get(vkey());
      if (!k) viewSorts.delete(vkey());
      else if (!s || s.key !== k) viewSorts.set(vkey(), { key: k, dir: first });
      else if (s.dir === first) viewSorts.set(vkey(), { key: k, dir: -first });
      else viewSorts.delete(vkey());
    }
    render();
  }));
  head.querySelectorAll('[data-h]').forEach((b) => (b.onclick = async () => {
    const a = b.dataset.h;
    if (a === 'play') playList(ids, 0, { shuffle: false });
    if (a === 'shuffle') playList(ids, Math.floor(Math.random() * ids.length), { shuffle: true });
    if (a === 'radio') radio(ids[0]);
    if (a === 'rename') { const n = await prompt2('Renombrar playlist', 'Nombre nuevo:', (D.playlists.find((p) => p.id === view.key) || {}).name); if (n) { await plOp({ id: view.key, rename: n }); render(); } }
    if (a === 'delpl') { const p = D.playlists.find((x) => x.id === view.key); if (await confirm2('Borrar playlist', `¿Borrar «${esc(p.name)}»? Las canciones no se borran.`, 'borrar', true)) { await plOp({ id: view.key, delete: true }); go({ type: 'songs' }); } }
    if (a === 'novideo') { $('#fKind').value = $('#fKind').value === 'audio' ? '' : 'audio'; render(); return; }
    if (a === 'ytmsync') { await loadYtmList(view.key, true); toast('lista sincronizada con YouTube Music ⟳', { ms: 1500 }); }
    if (a === 'ytmdl') {
      const online = ids.map(T).filter((t) => t && t.remote && t.available !== false);
      const d = P.get('dl'), format = d.format === 'mp4' ? 'mp3' : d.format;
      try { const r = await api.post('/api/downloads', { urls: online.map((t) => `https://music.youtube.com/watch?v=${t.ytId}`), format, quality: format === 'mp3' ? d.quality || '320' : 'best', cookies: d.cookies || '' }); toast(`${r.ids.length} descargas en cola ⇣`, { sub: 'cuando terminen, suenan desde tu PC' }); }
      catch (e) { toast(e.message, { kind: 'err' }); }
    }
    if (a === 'savepl') { const au = D.auto.find((x) => x.id === view.key); const n = await prompt2('Guardar como playlist', 'Nombre:', au.name.replace(/^\W+\s*/, '')); if (n) { await plOp({ create: { name: n, tracks: au.tracks } }); toast('playlist guardada'); } }
  }));
}

// ---------- tabla virtualizada ----------
function renderTable(body) {
  if (!ids.length) {
    if (view.type === 'ytm') { const l = ytm.lists.get(view.key); body.innerHTML = `<div class="empty">${!l || ytm.loading.has(view.key) ? 'trayendo tu lista de YouTube Music…' : l.error ? esc(l.error) : 'esta lista está vacía'}</div>`; return; }
    body.innerHTML = `<div class="empty">${D.tracks.length ? 'nada coincide con la búsqueda' : D.scan && D.scan.scanning ? 'escaneando tu música…' : 'tu biblioteca está vacía.<br><br>descargá algo (workspace 2), arrastrá archivos acá o agregá carpetas en ajustes (5).'}</div>`;
    return;
  }
  const rh = ROW_H();
  body.innerHTML = `<div class="vl-in" style="height:${ids.length * rh}px"></div>`;
  const inner = body.firstChild;
  let last = '';
  const paint = () => {
    const top = body.scrollTop, h = body.clientHeight;
    const a = Math.max(0, Math.floor(top / rh) - 8), b = Math.min(ids.length, Math.ceil((top + h) / rh) + 8);
    const key = a + ':' + b + ':' + (current() || {}).id;
    if (key === last) return updateSel();
    last = key;
    const cur = (current() || {}).id;
    let html = '';
    for (let i = a; i < b; i++) {
      const t = T(ids[i]); if (!t) continue;
      html += `<div class="row ${t.id === cur ? 'cur' : ''} ${sel.has(t.id) ? 'sel' : ''} ${t.available === false ? 'na' : ''}" style="top:${i * rh}px" data-i="${i}" draggable="true">
        <span class="ix"><span class="num">${t.id === cur ? '♪' : view.type === 'album' && t.trackNo ? t.trackNo : i + 1}</span><span class="pi" data-play>${icon('play')}</span></span>
        <span class="tc"><img loading="lazy" src="${coverUrl(t.id)}" onerror="this.classList.add('x')"><span class="tt"><div class="t">${esc(t.title)}</div><div class="a">${esc(t.artist || '—')}</div></span></span>
        <span class="c2">${esc(t.album || '')}</span>
        <span class="num2">${fmtTime(t.duration)}</span>
        <span class="num2">${D.plays[t.id] || ''}</span>
        <span>${t.remote ? '<span class="tg cloud" title="suena online desde YouTube Music, sin descargar">☁ web</span>' : `<span class="tg">${esc(t.ext)}</span>`}</span>
        <button class="more" data-more title="más opciones">${icon('more')}</button>
      </div>`;
    }
    inner.innerHTML = html;
  };
  body.onscroll = () => requestAnimationFrame(paint);
  body._paint = () => { last = ''; paint(); };
  paint();
}
export function repaint() { const b = $('#lbody'); if (b._paint) b._paint(); }
// la selección cambia solo clases (redibujar entre los dos clics de un doble clic rompería el doble clic)
function updateSel() { $$('#lbody .row').forEach((r) => r.classList.toggle('sel', sel.has(ids[+r.dataset.i]))); }

// interacción con las filas (delegada: sirve para cualquier cantidad de filas)
function rowIndex(el) { const r = el.closest('.row'); return r ? +r.dataset.i : -1; }
function onRowClick(e) {
  const i = rowIndex(e.target); if (i < 0) return;
  const id = ids[i];
  if (e.target.closest('[data-play]')) return playList(ids, i, { shuffle: PS.shuffle });
  if (e.target.closest('[data-more]')) { if (!sel.has(id)) { sel = new Set([id]); anchor = i; } repaint(); return trackMenu(e.clientX, e.clientY); }
  if (e.ctrlKey || e.metaKey) { sel.has(id) ? sel.delete(id) : sel.add(id); anchor = i; }
  else if (e.shiftKey && anchor >= 0) { sel = new Set(ids.slice(Math.min(anchor, i), Math.max(anchor, i) + 1)); }
  else { sel = new Set([id]); anchor = i; }
  updateSel();
}
function onRowDbl(e) { const i = rowIndex(e.target); if (i >= 0 && !e.target.closest('[data-more]')) playList(ids, i, { shuffle: PS.shuffle }); }
function onRowCtx(e) {
  const i = rowIndex(e.target); if (i < 0) return;
  e.preventDefault();
  if (!sel.has(ids[i])) { sel = new Set([ids[i]]); anchor = i; repaint(); }
  trackMenu(e.clientX, e.clientY);
}

// ---------- menú contextual de canciones ----------
export function trackMenu(x, y, idsArg) {
  const chosen = idsArg || ids.filter((id) => sel.has(id));
  if (!chosen.length) return;
  const one = chosen.length === 1 ? T(chosen[0]) : null;
  const plIn = view.type === 'pl' ? view.key : null;
  const remote = chosen.map(T).filter((t) => t && t.remote);
  if (remote.length) {   // canciones online de YouTube Music
    const yt = (one && one.ytId) || null;
    return ctxMenu(x, y, [
      { header: one ? one.title.slice(0, 40) : `${chosen.length} canciones` },
      { label: 'reproducir (online)', icon: 'play', fn: () => (chosen.length > 1 ? playList(chosen, 0) : playList(ids, ids.indexOf(chosen[0]))) },
      { label: 'reproducir después', icon: 'next', fn: () => playNext(chosen) },
      { label: 'agregar a la cola', icon: 'queue', fn: () => addQueue(chosen) },
      yt && { label: 'radio de YouTube Music', icon: 'radio', fn: () => openRadio(yt, one.title) },
      { sep: true },
      { label: 'agregar a playlist', icon: 'plus', sub: () => [
        { label: 'nueva playlist…', icon: 'plus', fn: () => newPlaylist(chosen) },
        D.playlists.length && { sep: true },
        ...D.playlists.map((p) => ({ label: p.name, raw: true, icon: 'lyr', fn: () => addToPl(p.id, chosen) })),
      ] },
      plIn && { label: 'quitar de esta playlist', icon: 'x', fn: async () => { await plOp({ id: plIn, remove: chosen }); render(); } },
      { label: remote.length > 1 ? `descargar ${remote.length} a mi PC` : 'descargar a mi PC', icon: 'dl', fn: async () => {
        const d = P.get('dl'), format = d.format === 'mp4' ? 'mp3' : d.format;
        try { const r = await api.post('/api/downloads', { urls: remote.map((t) => `https://music.youtube.com/watch?v=${t.ytId}`), format, quality: format === 'mp3' ? d.quality || '320' : 'best', cookies: d.cookies || '' }); toast(`${r.ids.length} en cola ⇣`); }
        catch (e) { toast(e.message, { kind: 'err' }); }
      } },
      yt && ytm.status && ytm.status.auth && { label: 'me gusta en YouTube Music', icon: 'heart', fn: () => api.post('/api/ytm/rate', { videoId: yt, rating: 'LIKE' }).then(() => toast('me gusta ♥')).catch((e) => toast(e.message, { kind: 'err' })) },
      yt && { label: 'copiar link', icon: 'plus', fn: () => navigator.clipboard.writeText(`https://music.youtube.com/watch?v=${yt}`).then(() => toast('link copiado')) },
    ]);
  }
  ctxMenu(x, y, [
    { header: one ? one.title.slice(0, 40) : `${chosen.length} canciones` },
    { label: 'reproducir', icon: 'play', key: 'enter', fn: () => (chosen.length > 1 ? playList(chosen, 0) : playList(ids, ids.indexOf(chosen[0]))) },
    { label: 'reproducir después', icon: 'next', fn: () => playNext(chosen) },
    { label: 'agregar a la cola', icon: 'queue', fn: () => addQueue(chosen) },
    one && { label: 'radio (similares de tu biblioteca)', icon: 'radio', fn: () => radio(one.id) },
    one && one.ytId && { label: 'radio de YouTube Music', icon: 'radio', fn: () => openRadio(one.ytId, one.title) },
    { sep: true },
    { label: 'agregar a playlist', icon: 'plus', sub: () => [
      { label: 'nueva playlist…', icon: 'plus', fn: () => newPlaylist(chosen) },
      D.playlists.length && { sep: true },
      ...D.playlists.map((p) => ({ label: p.name, raw: true, icon: 'lyr', fn: () => addToPl(p.id, chosen) })),
    ] },
    plIn && { label: 'quitar de esta playlist', icon: 'x', fn: async () => { await plOp({ id: plIn, remove: chosen }); render(); } },
    { sep: true },
    one && { label: 'ir al artista', icon: 'radio', fn: () => go({ type: 'artist', key: one._a }) },
    one && one.album && { label: 'ir al álbum', icon: 'folder', fn: () => go({ type: 'album', key: { album: one.album, artist: one.albumArtist || one.artist } }) },
    one && { label: 'editar etiquetas…', icon: 'cfg', fn: () => editMeta(one) },
    one && { label: 'mostrar en la carpeta', icon: 'folder', fn: () => api.post(`/api/track/${one.id}/reveal`) },
    { sep: true },
    { label: chosen.length > 1 ? `enviar ${chosen.length} a la papelera` : 'enviar a la papelera', icon: 'x', danger: true, fn: () => trash(chosen) },
  ]);
}
async function addToPl(pid, chosen) {
  const p = D.playlists.find((x) => x.id === pid);
  const before = p ? p.tracks.length : 0;
  await plOp({ id: pid, add: chosen });
  const after = (D.playlists.find((x) => x.id === pid) || {}).tracks.length;
  toast(after > before ? `agregada${after - before > 1 ? 's ' + (after - before) : ''} a «${p.name}»` : 'ya estaba en la playlist', { ms: 1600 });
  if (view.type === 'pl' && view.key === pid) render();
}
export async function newPlaylist(chosen = []) {
  const name = await prompt2('Nueva playlist', 'Nombre:', '');
  if (!name) return;
  const p = await plOp({ create: { name, tracks: chosen } });
  toast(`playlist «${p.name}» creada` + (chosen.length ? ` con ${chosen.length}` : ''));
  go({ type: 'pl', key: p.id });
}
async function trash(chosen) {
  const list = chosen.map(T).filter(Boolean);
  const ok = await confirm2('Enviar a la papelera', `${list.length === 1 ? `«${esc(list[0].title)}»` : list.length + ' canciones'} va${list.length > 1 ? 'n' : ''} a la <b>papelera de reciclaje</b> de Windows. Se puede recuperar desde ahí.`, 'enviar a la papelera', true);
  if (!ok) return;
  let n = 0;
  for (const t of list) {
    if (current() && current().id === t.id) { toast('no se puede borrar la canción que está sonando', { kind: 'warn' }); continue; }
    try { await api.post(`/api/track/${t.id}/trash`); n++; } catch (e) { toast(e.message, { kind: 'err' }); }
  }
  if (n) toast(`${n} a la papelera`);
}
async function editMeta(t) {
  const f = (k, l, v, type = 'text') => `<label>${l}</label><input type="${type}" data-k="${k}" value="${esc(v == null ? '' : v)}">`;
  const r = await modal({
    title: 'Editar etiquetas',
    html: `<div class="m" style="margin-bottom:10px;word-break:break-all">${esc(t.path)}</div><div class="fl">
      ${f('title', 'título', t.title)}${f('artist', 'artista', t.artist)}${f('album', 'álbum', t.album)}${f('albumArtist', 'artista del álbum', t.albumArtist)}
      ${f('genre', 'género', t.genre)}${f('year', 'año', t.year, 'number')}${f('trackNo', 'n° de pista', t.trackNo, 'number')}</div>
      <div class="m" style="margin-top:10px">se escriben en el archivo con ffmpeg, sin recodificar el audio.</div>`,
    actions: [{ label: 'cancelar', value: null }, { label: 'guardar', primary: true, fn: (box) => { const o = {}; box.querySelectorAll('[data-k]').forEach((i) => (o[i.dataset.k] = i.value)); return o; } }],
  });
  if (!r) return;
  try {
    if (current() && current().id === t.id) toast('guardando… (la canción sigue sonando)', { ms: 1500 });
    await api.post(`/api/track/${t.id}/meta`, r);
    await loadLibrary();
    toast('etiquetas guardadas ✓');
  } catch (e) { toast(e.message, { kind: 'err', ms: 5000 }); }
}

// ---------- vistas de grupos (artistas, álbumes, géneros, años) ----------
function renderGroups(head, body) {
  ids = [];
  $('#qCount').textContent = '';
  const groups = new Map();
  for (const t of filtered(D.tracks)) {
    let k, label, sub;
    if (view.type === 'artists') { k = t._a; }
    else if (view.type === 'albums') { if (!t.album) continue; k = t.album + '\u0000' + (t.albumArtist || t.artist); }
    else if (view.type === 'genres') k = t.genre || '—';
    else k = String(t.year || '—');
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(t);
  }
  const title = { artists: 'artistas', albums: 'álbumes', genres: 'géneros', years: 'años' }[view.type];
  head.innerHTML = `<div class="ttlbar"><div><h2>${title}</h2><div class="sub">${groups.size} ${title}</div></div></div>`;
  if (!groups.size) { body.innerHTML = `<div class="empty">${view.type === 'albums' ? 'tus archivos no tienen etiqueta de álbum. podés agregarla con clic derecho → editar etiquetas.' : 'nada por acá todavía'}</div>`; return; }
  if (view.type === 'genres' || view.type === 'years') {
    const keys = [...groups.keys()].sort((a, b) => (view.type === 'years' ? b.localeCompare(a) : groups.get(b).length - groups.get(a).length));
    body.innerHTML = `<div class="tlist">${keys.map((k) => `<button data-g="${esc(k)}">${esc(k)}<span>${groups.get(k).length} canciones</span></button>`).join('')}</div>`;
    body.querySelectorAll('[data-g]').forEach((b) => (b.onclick = () => go({ type: view.type === 'genres' ? 'genre' : 'year', key: b.dataset.g })));
    return;
  }
  const keys = [...groups.keys()].sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
  body.innerHTML = `<div class="grid">${keys.map((k, i) => {
    const l = groups.get(k);
    const c = (l.find((t) => t.hasCover || t.video) || l[0]).id;
    const [name, artist] = k.split('\u0000');
    return `<div class="card ${view.type === 'artists' ? 'round' : ''}" data-k="${i}"><div class="cimg">♪<img loading="lazy" src="${coverUrl(c)}" onerror="this.classList.add('x')"><button class="cplay" data-cp="${i}">${icon('play')}</button></div>
      <div class="cn">${esc(name)}</div><div class="cs">${view.type === 'albums' ? esc(artist) + ' · ' : ''}${l.length} canciones</div></div>`;
  }).join('')}</div>`;
  const keyFor = (i) => { const k = keys[i]; if (view.type === 'artists') return { type: 'artist', key: k }; const [album, artist] = k.split('\u0000'); return { type: 'album', key: { album, artist } }; };
  body.querySelectorAll('[data-k]').forEach((c) => (c.onclick = (e) => {
    const i = +c.dataset.k;
    if (e.target.closest('[data-cp]')) { const prevView = view; view = keyFor(i); const l = viewTracks().map((t) => t.id); view = prevView; return playList(l, 0); }
    go(keyFor(i));
  }));
}

// ---------- duplicados ----------
async function renderDupes(head, body) {
  ids = [];
  head.innerHTML = `<div class="ttlbar"><div><h2>duplicados</h2><div class="sub">misma canción (artista + título) con duración parecida</div></div></div>`;
  body.innerHTML = '<div class="empty">buscando…</div>';
  try { dupes = (await api.get('/api/library/duplicates')).groups; } catch { dupes = []; }
  $('#cDupes').textContent = dupes.length || '';
  if (!dupes.length) { body.innerHTML = '<div class="empty">no hay duplicados ✓</div>'; return; }
  body.innerHTML = dupes.map((g, gi) => {
    const ts = g.map(T).filter(Boolean);
    return `<div class="dgroup"><div class="dh">${esc(trackLabel(ts[0]))} · ${ts.length} copias</div>${ts.map((t) => `
      <div class="drow"><div style="min-width:0"><div>${esc(t.name)}</div><div class="p">${esc(t.folder)}</div></div>
      <span class="m">${t.ext} · ${t.bitrate || '?'}k · ${fmtSize(t.size)} · ${fmtTime(t.duration)}</span>
      <button class="cb sm" data-dplay="${t.id}">${icon('play')}</button>
      <button class="cb sm danger" data-dtrash="${t.id}">papelera</button></div>`).join('')}</div>`;
  }).join('');
  body.querySelectorAll('[data-dplay]').forEach((b) => (b.onclick = () => playList([b.dataset.dplay], 0)));
  body.querySelectorAll('[data-dtrash]').forEach((b) => (b.onclick = async () => { await trash([b.dataset.dtrash]); }));
}

// ---------- arrastrar canciones: a playlists, a la cola, o reordenar una playlist ----------
let dragIds = null, dragFrom = -1;
function onDragStart(e) {
  const i = rowIndex(e.target); if (i < 0) return;
  if (!sel.has(ids[i])) { sel = new Set([ids[i]]); anchor = i; repaint(); }
  dragIds = ids.filter((id) => sel.has(id));
  dragFrom = i;
  e.dataTransfer.effectAllowed = 'copyMove';
  e.dataTransfer.setData('text/x-pw-tracks', JSON.stringify(dragIds));
  const g = document.createElement('div'); g.className = 'toast'; g.style.position = 'fixed'; g.style.top = '-100px'; g.textContent = dragIds.length > 1 ? `${dragIds.length} canciones` : T(dragIds[0]).title;
  document.body.appendChild(g); e.dataTransfer.setDragImage(g, 10, 10); setTimeout(() => g.remove(), 0);
}
export const getDragIds = () => dragIds;
function bindDrag() {
  const body = $('#lbody');
  body.addEventListener('dragstart', onDragStart);
  body.addEventListener('dragend', () => { dragIds = null; $$('.row.dragover').forEach((r) => r.classList.remove('dragover')); });
  body.addEventListener('dragover', (e) => {
    if (!dragIds || view.type !== 'pl') return;
    const r = e.target.closest('.row'); if (!r) return;
    e.preventDefault(); $$('.row.dragover').forEach((x) => x.classList.remove('dragover')); r.classList.add('dragover');
  });
  body.addEventListener('drop', async (e) => {
    if (!dragIds || view.type !== 'pl') return;
    e.preventDefault();
    const to = rowIndex(e.target); if (to < 0) return;
    const p = D.playlists.find((x) => x.id === view.key);
    const moving = new Set(dragIds);
    const rest = p.tracks.filter((id) => !moving.has(id));
    const targetId = ids[to];
    let at = rest.indexOf(targetId); if (at < 0) at = rest.length;
    rest.splice(at, 0, ...dragIds);
    await plOp({ id: p.id, set: rest });
    render();
  });
  // soltar sobre una playlist de la barra lateral
  const nav = $('#lnav');
  nav.addEventListener('dragover', (e) => { const b = e.target.closest('[data-pl]'); if (b && dragIds) { e.preventDefault(); $$('#lnav .drop').forEach((x) => x.classList.remove('drop')); b.classList.add('drop'); } });
  nav.addEventListener('dragleave', (e) => { const b = e.target.closest('[data-pl]'); if (b) b.classList.remove('drop'); });
  nav.addEventListener('drop', (e) => { const b = e.target.closest('[data-pl]'); if (b && dragIds) { e.preventDefault(); b.classList.remove('drop'); addToPl(b.dataset.pl, dragIds); } });
}

// ---------- inicio ----------
// columnas según el ancho real de la lista: si es angosta (panel ancho, ventana chica) se ocultan álbum, ▶ y formato
const COLS_NARROW = '36px minmax(0,1fr) 52px 32px';
function fitCols() {
  const m = $('.lmain'); if (!m) return;
  const nar = m.clientWidth > 0 && m.clientWidth < 620;
  m.classList.toggle('nar', nar);
  m.style.setProperty('--cols', nar ? COLS_NARROW : COLS);
}
export function initLibrary() {
  fitCols();
  if (window.ResizeObserver && $('.lmain')) new ResizeObserver(fitCols).observe($('.lmain'));
  const body = $('#lbody');
  body.addEventListener('click', onRowClick);
  body.addEventListener('dblclick', onRowDbl);
  body.addEventListener('contextmenu', onRowCtx);
  bindDrag();
  $('#lnav').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.id === 'bNewPl') return newPlaylist();
    if (b.dataset.view) go({ type: b.dataset.view });
    if (b.dataset.pl) go({ type: 'pl', key: b.dataset.pl });
    if (b.dataset.auto) go({ type: 'auto', key: b.dataset.auto });
    if (b.dataset.ytm) go({ type: 'ytm', key: b.dataset.ytm });
    if (b.id === 'bYtmRefresh') {
      if (!ytm.status || !ytm.status.auth) return toast('iniciá sesión en YouTube Music (workspace 3)', { kind: 'warn' });
      loadYtmPlaylists(); if (view.type === 'ytm') loadYtmList(view.key, true);
      toast('sincronizando con tu cuenta ⟳', { ms: 1400 });
    }
  });
  $('#lnav').addEventListener('click', (e) => { if (e.target.closest('[data-goytm]')) bus.emit('ws', 'sync'); });
  // secciones colapsables (se recuerda cuáles cerraste)
  const closed = new Set(P.get('navClosed') || []);
  $$('#lnav .lgrp').forEach((g) => g.classList.toggle('closed', closed.has(g.dataset.grp)));
  $('#lnav').addEventListener('click', (e) => {
    const h = e.target.closest('[data-toggle]'); if (!h || e.target.closest('button')) return;
    const g = h.closest('.lgrp'); g.classList.toggle('closed');
    g.classList.contains('closed') ? closed.add(g.dataset.grp) : closed.delete(g.dataset.grp);
    P.set('navClosed', [...closed]);
  });
  // buscador de playlists (YouTube Music + locales + mixes)
  $('#navFlt').addEventListener('input', applyNavFilter);
  $('#navFlt').addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.target.value = ''; applyNavFilter(); e.target.blur(); } });
  bus.on('ytm:status', (st) => { ytm.status = st; if (st && st.auth) loadYtmPlaylists(); renderNav(); });
  bus.on('ytm:nav', renderNav);
  bus.on('ytm:list', (key) => { renderNav(); if (view.type === 'ytm' && view.key === key) render(); });
  $('#lnav').addEventListener('contextmenu', (e) => {
    const b = e.target.closest('[data-pl],[data-auto]'); if (!b) return;
    e.preventDefault();
    const list = b.dataset.pl ? (D.playlists.find((p) => p.id === b.dataset.pl) || {}).tracks : (D.auto.find((a) => a.id === b.dataset.auto) || {}).tracks;
    ctxMenu(e.clientX, e.clientY, [
      { label: 'reproducir', icon: 'play', fn: () => playList(list || [], 0, { shuffle: false }) },
      { label: 'aleatorio', icon: 'shuf', fn: () => playList(list || [], 0, { shuffle: true }) },
      { label: 'agregar a la cola', icon: 'queue', fn: () => addQueue(list || []) },
      b.dataset.pl && { sep: true },
      b.dataset.pl && { label: 'borrar playlist', icon: 'x', danger: true, fn: async () => { if (await confirm2('Borrar playlist', '¿Seguro? Las canciones no se borran.', 'borrar', true)) { await plOp({ id: b.dataset.pl, delete: true }); if (view.key === b.dataset.pl) go({ type: 'songs' }); } } },
    ]);
  });
  const rerender = debounce(render, 60);
  $('#q').addEventListener('input', rerender);
  $('#fExt').onchange = render; $('#fKind').onchange = render;
  $('#bRescan').onclick = () => { api.post('/api/library/rescan'); toast('reescaneando carpetas…', { ms: 1500 }); };
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && document.activeElement === document.body && sel.size && $('#modal').hidden && !$('[data-ws="music"]').hidden) {
      const first = ids.findIndex((id) => sel.has(id)); if (first >= 0) playList(ids, first);
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a' && !/INPUT|TEXTAREA/.test(document.activeElement.tagName) && !$('[data-ws="music"]').hidden) {
      e.preventDefault(); sel = new Set(ids); repaint();
    }
  });
  bus.on('lib:loaded', () => {
    const exts = [...new Set(D.tracks.map((t) => t.ext))].sort();
    const cur = $('#fExt').value;
    $('#fExt').innerHTML = '<option value="">todos los formatos</option>' + exts.map((x) => `<option value="${x}">${x}</option>`).join('');
    $('#fExt').value = exts.includes(cur) ? cur : '';
    renderNav(); render();
  });
  bus.on('pl:loaded', () => { renderNav(); if (view.type === 'pl') render(); });
  bus.on('auto:loaded', renderNav);
  bus.on('np', repaint);
  view = { type: P.get('libView') || 'songs' };
  $$('#lnav [data-view]').forEach((b) => b.classList.toggle('on', b.dataset.view === view.type));
}
