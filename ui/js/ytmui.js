// workspace YouTube Music (ytmusicapi): cuenta, búsqueda, me gusta, playlists, historial, radio, descargar lo que falta
import { $, $$, bus, P, api, esc, toast, fmtTime, icon, ctxMenu, debounce, host, confirm2, thumbUrl } from './core.js';
import { D, T, plOp, remoteTrack } from './data.js';
import { playList, current } from './player.js';
import { cookieHelp } from './downloads.js';
import { go } from './library.js';
import { renderSpotify } from './spotui.js';

let tab = 'search', status = null;
let view = null;          // { kind, title, sub, thumb, items, back }
let filter = 'songs', lastQ = '';
const downloading = new Set();

// ---------- cuenta ----------
export async function loadStatus() {
  try { status = await api.get('/api/ytm/status'); } catch (e) { status = { auth: false, error: e.message }; }
  bus.emit('ytm:status', status);   // el workspace 1 muestra tus listas de YouTube Music si hay sesión
  renderAcc();
  updateLike();
  return status;
}
function renderAcc() {
  const el = $('#ytmAcc');
  if (!status) { el.textContent = 'conectando con YouTube Music…'; return; }
  if (status.unavailable) { el.innerHTML = '<span class="bad">⚠ ytmusicapi no está instalado</span>'; return; }
  if (status.auth && status.account) {
    el.innerHTML = `${status.account.photo ? `<img src="${esc(status.account.photo)}" referrerpolicy="no-referrer">` : ''}<span>conectado como <b>${esc(status.account.name || '')}</b> ${esc(status.account.handle || '')}</span><span class="m">· ytmusicapi ${esc(status.version)} (no oficial)</span><span class="sp"></span><button class="cb sm" id="ytmLogout">cerrar sesión</button>`;
    $('#ytmLogout').onclick = logout;
  } else {
    el.innerHTML = `<span class="bad">◌ sin sesión</span>${host.native ? '<button class="go" id="ytmLogin">iniciar sesión con Google</button>' : ''}<span class="m">${esc(status.missing && status.missing.length && !/no hay cookies/.test(status.error || '') ? 'la sesión guardada está incompleta o vencida.' : 'iniciá sesión para ver tus me gusta, playlists e historial y bajar con calidad Premium.')}</span><button class="cb sm" id="ytmHelp">${host.native ? 'o cargar cookies.txt' : 'cómo exportar cookies'}</button><span class="m">· búsqueda, radio y letras funcionan sin sesión</span>`;
    const li = $('#ytmLogin'); if (li) li.onclick = login;
    $('#ytmHelp').onclick = () => { cookieHelp('Cómo exportar cookies con la sesión completa:'); bus.emit('ws', 'dl'); };
  }
}
// ventana de Google dentro de petalwave: el usuario escribe su contraseña ahí (petalwave no la ve ni la guarda)
export function login() {
  if (!host.native) return toast('el inicio de sesión necesita la ventana de petalwave (petalwave.exe)', { kind: 'warn' });
  host.send('login');
  $('#ytmAcc').innerHTML = '<span class="m">⟳ se abrió la ventana de Google: iniciá sesión con tu cuenta de Google (sirve para YouTube y YouTube Music)…</span>';
}
export async function logout() {
  if (!(await confirm2('Cerrar sesión', 'Se borra la sesión guardada en petalwave (cookies.txt). Tu cuenta de Google no se ve afectada y podés volver a iniciar sesión cuando quieras.', 'cerrar sesión'))) return;
  await api.del('/api/cookies');
  toast('sesión cerrada');
  loadStatus();
}

// ---------- marcar lo que ya está en la biblioteca (también después de descargar) ----------
function localMatch(it) {
  if (!it.videoId) return null;
  if (it.local && T(it.local)) return it.local;
  const t = D.tracks.find((x) => x.ytId === it.videoId);
  return t ? t.id : null;
}
function refreshLocal() { if (view && view.items) { for (const it of view.items) if (it.videoId) it.local = localMatch(it); render(); } }

// ---------- render ----------
const tracksOf = () => (view && view.items ? view.items.filter((x) => x.videoId) : []);
function rowHtml(it, i) {
  if (!it.videoId) {   // álbum / playlist
    return `<div class="yrow" data-open="${i}" style="cursor:pointer"><span class="ix">${i + 1}</span><img loading="lazy" src="${esc(thumbUrl(it.thumb))}" referrerpolicy="no-referrer" onerror="this.style.visibility='hidden'">
      <div style="min-width:0"><div class="t">${esc(it.title)}</div><div class="a">${esc(it.type === 'album' ? 'álbum · ' + (it.artists || []).join(', ') + (it.year ? ' · ' + it.year : '') : 'playlist · ' + (it.author || '') + (it.count ? ' · ' + it.count : ''))}</div></div>
      <span class="al"></span><span class="d"></span><span></span><span class="acts"><button class="cb sm">abrir ▸</button></span></div>`;
  }
  const local = it.local = localMatch(it);
  const dl = downloading.has(it.videoId);
  const badge = local ? `<span class="ybadge have" data-playlocal="${i}" title="reproducir tu copia local">✓ la tenés</span>` : dl ? '<span class="ybadge dl">⇣ en cola</span>' : '<span class="ybadge miss">no la tenés</span>';
  return `<div class="yrow ${it.available === false ? 'na' : ''}" data-i="${i}"><span class="ix">${i + 1}</span><img loading="lazy" src="${esc(thumbUrl(it.thumb))}" referrerpolicy="no-referrer" onerror="this.style.visibility='hidden'">
    <div style="min-width:0"><div class="t">${esc(it.title)}</div><div class="a">${esc((it.artists || []).join(', ') || '—')}${it.type === 'MUSIC_VIDEO_TYPE_UGC' || it.type === 'video' ? ' · video' : ''}</div></div>
    <span class="al">${esc(it.album || '')}</span><span class="d">${it.duration ? fmtTime(it.duration) : ''}</span>${badge}
    <span class="acts">${local ? '' : `<button class="cb sm" data-pon="${i}" title="escuchar online, sin descargar">${icon('play')}</button><button class="cb sm" data-dl="${i}" title="descargar" ${dl ? 'disabled' : ''}>${icon('dl')}</button>`}<button class="cb sm" data-more="${i}" title="más">${icon('more')}</button></span></div>`;
}
// al redibujar, la caja de búsqueda se reemplaza: se conserva lo escrito, el foco y el cursor
// (antes el foco quedaba en la ventana y las letras siguientes disparaban atajos: v, k, b…)
function render() {
  const old = $('#ytQ');
  const keep = old ? { v: old.value, focus: document.activeElement === old, a: old.selectionStart, b: old.selectionEnd } : null;
  renderBody(keep ? keep.v : lastQ);
  const q = $('#ytQ');
  if (q && keep && keep.focus) { q.focus(); try { q.setSelectionRange(keep.a, keep.b); } catch {} }
}
function renderBody(qv) {
  const box = $('#ytmBody');
  $('#ytmSync').hidden = tab !== 'sync';
  box.hidden = tab === 'sync';
  $$('#ytmTabs [data-yt]').forEach((b) => b.classList.toggle('on', b.dataset.yt === tab));
  if (tab === 'sync') return;
  if (tab === 'spotify') return renderSpotify(box);
  let top = '';
  if (tab === 'search') {
    top = `<div class="ytm-search"><div class="search">${icon('search')}<input type="text" id="ytQ" placeholder="buscar en YouTube Music…" value="${esc(qv)}" spellcheck="false" autocomplete="off"></div>
      <div class="seg">${[['songs', 'canciones'], ['videos', 'videos'], ['albums', 'álbumes'], ['playlists', 'playlists']].map(([k, l]) => `<button data-f="${k}" class="${filter === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>`;
  }
  if (!view) { box.innerHTML = top + `<div class="empty">${tab === 'search' ? 'buscá cualquier canción, artista o álbum de YouTube Music' : tab === 'radio' ? 'abrí la radio de una canción: clic derecho → "radio de YouTube Music", o el botón ◉ de abajo' : 'cargando…'}</div>`; bindTop(); return; }
  if (view.loading) { box.innerHTML = top + '<div class="empty">cargando desde YouTube Music…</div>'; bindTop(); return; }
  if (view.error) {
    box.innerHTML = top + `<div class="warn">${esc(view.error)}</div>` + (view.auth ? '<div class="m">esto necesita tu sesión: cargá un cookies.txt completo (workspace 2 → 🍪).</div>' : '');
    bindTop(); return;
  }
  const tr = tracksOf();
  const have = tr.filter((x) => x.local).length, miss = tr.filter((x) => !x.local && x.available !== false).length;
  const head = view.title ? `<div class="yhead">${view.thumb ? `<img src="${esc(view.thumb)}" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}<div>${view.back ? '<button class="cb sm" id="yBack">← volver</button>' : ''}<div class="m">${esc(view.sub || '')}</div><h2>${esc(view.title)}</h2>
    <div class="m">${tr.length} canciones · <span style="color:var(--ok)">${have} ya las tenés</span> · <span style="color:var(--warn)">${miss} faltan</span></div></div></div>` : '';
  const bar = tr.length ? `<div class="ybar"><button class="go" id="yPlayAll">${icon('play')} reproducir todo</button><button class="cb" id="yPlayLocal" ${have ? '' : 'disabled'}>solo las que tengo (${have})</button>
      <button class="cb" id="yDlAll" ${miss ? '' : 'disabled'}>${icon('dl')} bajar las ${miss} que faltan</button>
      <button class="cb" id="yMkPl" ${have ? '' : 'disabled'}>crear playlist local</button>
      ${view.syncUrl ? '<button class="cb" id="ySync">⟳ agregar a la sync</button>' : ''}</div>` : '';
  box.innerHTML = top + head + bar + `<div class="ylist">${view.items.length ? view.items.map(rowHtml).join('') : '<div class="empty">no hay resultados</div>'}</div>`;
  bindTop(); bindList();
}
function bindTop() {
  const q = $('#ytQ');
  if (q) {
    q.onkeydown = (e) => { if (e.key === 'Enter') search(q.value); };
    q.oninput = debounce(() => { if (q.value.trim().length >= 3) search(q.value, true); }, 600);
    if (document.activeElement !== q && tab === 'search' && !view) setTimeout(() => q.focus(), 30);
  }
  $$('#ytmBody [data-f]').forEach((b) => (b.onclick = () => { filter = b.dataset.f; if (lastQ) search(lastQ); else render(); }));
  const back = $('#yBack'); if (back) back.onclick = () => { view = view.back; render(); };
}
function bindList() {
  const tr = tracksOf();
  const p = $('#yPlayLocal'); if (p) p.onclick = () => playList(tr.filter((x) => x.local).map((x) => x.local), 0);
  // todo: lo que tenés suena desde el archivo, lo demás online
  const idsAll = () => tr.filter((x) => x.local || x.available !== false).map((x) => x.local || remoteTrack(x).id);
  const pa = $('#yPlayAll'); if (pa) pa.onclick = () => playList(idsAll(), 0);
  const d = $('#yDlAll'); if (d) d.onclick = () => download(tr.filter((x) => !x.local && x.available !== false));
  const mk = $('#yMkPl'); if (mk) mk.onclick = async () => {
    const pl = await plOp({ create: { name: view.title || 'YouTube Music', tracks: tr.filter((x) => x.local).map((x) => x.local) } });
    toast(`playlist «${pl.name}» creada con ${pl.tracks.length}`); go({ type: 'pl', key: pl.id }); bus.emit('ws', 'music');
  };
  const sy = $('#ySync'); if (sy) sy.onclick = () => api.post('/api/sync', { add: { url: view.syncUrl, name: view.title } }).then(() => toast('agregada a la sync ⟳')).catch((e) => toast(e.message, { kind: 'err' }));
  const list = $('#ytmBody .ylist');
  list.onclick = (e) => {
    const o = e.target.closest('[data-open]'); if (o) return openItem(view.items[+o.dataset.open]);
    const pl = e.target.closest('[data-playlocal]'); if (pl) { const ids = tr.filter((x) => x.local).map((x) => x.local); const it = view.items[+pl.dataset.playlocal]; return playList(ids, ids.indexOf(it.local)); }
    const dl = e.target.closest('[data-dl]'); if (dl) return download([view.items[+dl.dataset.dl]]);
    const pon = e.target.closest('[data-pon]'); if (pon) { const all = idsAll(); const it = view.items[+pon.dataset.pon]; return playList(all, Math.max(0, all.indexOf(remoteTrack(it).id))); }
    const m = e.target.closest('[data-more]'); if (m) return itemMenu(view.items[+m.dataset.more], e.clientX, e.clientY);
  };
  list.oncontextmenu = (e) => { const r = e.target.closest('[data-i]'); if (r) { e.preventDefault(); itemMenu(view.items[+r.dataset.i], e.clientX, e.clientY); } };
}
function itemMenu(it, x, y) {
  ctxMenu(x, y, [
    { header: it.title.slice(0, 40) },
    it.local && { label: 'reproducir (copia local)', icon: 'play', fn: () => playList([it.local], 0) },
    !it.local && { label: 'descargar', icon: 'dl', fn: () => download([it]) },
    { label: 'radio de YouTube Music', icon: 'radio', fn: () => openRadio(it.videoId, it.title) },
    it.albumId && { label: 'ver el álbum', icon: 'folder', fn: () => openItem({ type: 'album', browseId: it.albumId, title: it.album }) },
    status && status.auth && { sep: true },
    status && status.auth && { label: 'me gusta en YouTube Music', icon: 'heart', fn: () => rate(it.videoId, 'LIKE') },
    status && status.auth && { label: 'quitar me gusta', icon: 'x', fn: () => rate(it.videoId, 'INDIFFERENT') },
    { sep: true },
    { label: 'copiar link', icon: 'plus', fn: () => navigator.clipboard.writeText(`https://music.youtube.com/watch?v=${it.videoId}`).then(() => toast('link copiado')) },
  ]);
}

// ---------- acciones ----------
async function load(kind, fn, meta = {}) {
  view = { kind, loading: true, ...meta };
  render();
  try {
    const r = await fn();
    const items = Array.isArray(r) ? r : r.items || r.tracks || [];
    view = { kind, ...meta, title: meta.title || r.title, thumb: meta.thumb || r.thumb, items };
  } catch (e) { view = { kind, error: e.message, auth: /sesión|cookies|401/i.test(e.message), ...meta }; }
  render();
}
async function search(q, soft) {
  q = q.trim(); if (!q) return;
  if (soft && q === lastQ) return;
  lastQ = q;
  await load('search', () => api.get(`/api/ytm/search?q=${encodeURIComponent(q)}&filter=${filter}`));
}
async function openItem(it) {
  const back = view;
  if (it.type === 'album') return load('album', () => api.get('/api/ytm/album/' + it.browseId), { sub: 'álbum · ' + (it.artists || []).join(', '), back, title: it.title, thumb: it.thumb, syncUrl: null });
  const id = String(it.browseId || it.playlistId || '').replace(/^VL/, '');
  return load('playlist', () => api.get('/api/ytm/playlist/' + id), { sub: 'playlist', back, title: it.title, thumb: it.thumb, syncUrl: `https://music.youtube.com/playlist?list=${id}` });
}
export function openRadio(videoId, title) {
  if (!videoId) return toast('esa canción no tiene ID de YouTube (no viene de YouTube)', { kind: 'warn' });
  tab = 'radio';
  bus.emit('ws', 'sync');
  load('radio', () => api.get('/api/ytm/radio/' + videoId), { title: 'radio · ' + (title || ''), sub: 'canciones relacionadas en YouTube Music' });
}
async function download(items) {
  items = items.filter((x) => x.videoId && !downloading.has(x.videoId));
  if (!items.length) return;
  const d = P.get('dl');
  const format = d.format === 'mp4' ? 'mp3' : d.format;
  try {
    const r = await api.post('/api/downloads', { urls: items.map((x) => `https://music.youtube.com/watch?v=${x.videoId}`), format, quality: format === 'mp3' ? d.quality || '320' : 'best', cookies: d.cookies || '' });
    items.forEach((x) => downloading.add(x.videoId));
    toast(items.length > 1 ? `${r.ids.length} descargas en cola ⇣` : 'descargando ⇣', { sub: items.length > 1 ? 'se bajan de a poco (workspace 2)' : items[0].title });
    render();
  } catch (e) { toast(e.message, { kind: 'err' }); }
}
async function rate(videoId, rating) {
  try { await api.post('/api/ytm/rate', { videoId, rating }); toast(rating === 'LIKE' ? 'me gusta en YouTube Music ♥' : 'me gusta quitado'); }
  catch (e) { toast(e.message, { kind: 'err' }); }
}

function setTab(t) {
  tab = t;
  if (t === 'search') { view = lastQ && view && view.kind === 'search' ? view : null; if (lastQ) return search(lastQ); return render(); }
  if (t === 'liked') return load('liked', () => api.get('/api/ytm/liked'), { title: 'Me gusta', sub: 'tu lista de YouTube Music', syncUrl: 'https://music.youtube.com/playlist?list=LM' });
  if (t === 'playlists') return load('playlists', async () => ({ items: (await api.get('/api/ytm/playlists')).items.map((p) => ({ type: 'playlist', playlistId: p.playlistId, title: p.title, count: p.count, thumb: p.thumb })) }), { title: 'mis playlists' });
  if (t === 'history') return load('history', () => api.get('/api/ytm/history'), { title: 'historial de YouTube Music', sub: 'lo último que escuchaste en tu cuenta' });
  if (t === 'radio') { if (!view || view.kind !== 'radio') { const c = current(); if (c && c.ytId) return openRadio(c.ytId, c.title); view = null; } return render(); }
  render();
}

// ---------- "me gusta" de la canción que suena ----------
function updateLike() {
  const b = $('#bLike'); if (!b) return;
  const t = current();
  b.hidden = !(status && status.auth && t && t.ytId);
}
export async function likeCurrent() {
  const t = current();
  if (!t || !t.ytId) return toast('esta canción no viene de YouTube', { kind: 'warn' });
  if (!status || !status.auth) return toast('necesitás la sesión de YouTube (cookies.txt)', { kind: 'warn' });
  await rate(t.ytId, 'LIKE');
  $('#bLike').classList.add('on');
}

export function initYtm() {
  $('#ytmTabs').onclick = (e) => { const b = e.target.closest('[data-yt]'); if (b) setTab(b.dataset.yt); };
  bus.on('lib:loaded', refreshLocal);
  bus.on('np', () => { updateLike(); $('#bLike') && $('#bLike').classList.remove('on'); });
  bus.on('sse:cookies', () => setTimeout(loadStatus, 800));
  bus.on('host:login', async (r) => {
    if (r.startsWith('ok')) {
      const s = await loadStatus();
      // con sesión, las descargas usan tu cuenta (calidad Premium si la tenés), salvo que lo hayas apagado
      if (s.auth && P.get('dlSession') !== false) { const d = P.get('dl'); d.cookies = 'txt'; P.save(); bus.emit('dl:prefs'); }
      if (s.auth) {
        toast('sesión iniciada ✓', { sub: s.account ? s.account.name : 'YouTube Music' });
        // la lista actual (me gusta, playlists…) se recarga con la sesión nueva
        if (['liked', 'playlists', 'history'].includes(tab)) setTab(tab);
      } else toast('YouTube no aceptó la sesión', { kind: 'warn', sub: s.error });
    } else if (r.startsWith('err')) { toast('no se pudo iniciar sesión', { kind: 'err', sub: r.slice(4) }); loadStatus(); }
    else { toast('inicio de sesión cancelado', { ms: 1500 }); renderAcc(); }
  });
  bus.on('sse:dl', (j) => { if (j.status === 'completado' || j.status === 'error' || j.status === 'cancelado') { const m = /[?&]v=([\w-]{11})/.exec(j.url); if (m && downloading.delete(m[1])) render(); } });
  render();
  loadStatus();
}
