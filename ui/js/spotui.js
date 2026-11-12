// Spotify en petalwave: sesión oficial (OAuth), tus playlists y guardadas, links públicos.
// El audio nunca sale de Spotify (DRM): cada canción se busca en YouTube Music y se escucha/descarga desde ahí.
import { $, $$, bus, P, api, esc, toast, fmtTime, icon, host } from './core.js';
import { D, T, plOp, remoteTrack } from './data.js';
import { playList } from './player.js';
import { go } from './library.js';

let st = null, view = null, lists = null, box = null;
const GREEN = '#1db954';

export async function spotStatus() {
  try { st = await api.get('/api/spotify/status'); } catch { st = null; }
  return st;
}

export async function renderSpotify(target) {
  box = target || box;
  if (!box) return;
  if (!st) await spotStatus();
  if (st && st.connected && !lists) loadLists();
  paint();
}

function setupHtml() {
  return `<div class="sp-card"><div class="sp-h"><span class="sp-logo">●</span><b>Conectar Spotify</b><span class="m">(una sola vez, unos 2 minutos)</span></div>
    <ol class="sp-steps">
      <li>Entrá a <a href="https://developer.spotify.com/dashboard" target="_blank">developer.spotify.com/dashboard</a> con tu cuenta <b>Premium</b> y tocá <b>Create app</b>.</li>
      <li>Nombre: <code>petalwave</code> · en <b>Redirect URI</b> pegá:<div class="sp-copy"><code id="spRedir">${esc(st.redirectUri.replace(':3738', ':3737'))}</code><button class="cb sm" id="spCopy">copiar</button></div>Marcá <b>Web API</b> y guardá.</li>
      <li>Copiá el <b>Client ID</b> de la app y pegalo acá:<div class="sp-copy"><input type="text" id="spCid" placeholder="Client ID (32 caracteres)" spellcheck="false" value="${esc(st.clientId)}"><button class="go" id="spSave">guardar</button></div></li>
    </ol>
    <div class="m">Spotify exige esto desde 2026 para apps personales ("modo desarrollo"): solo para tu cuenta y con Premium. petalwave usa el inicio de sesión oficial: tu contraseña la escribís en la página de Spotify.</div></div>`;
}

function paint() {
  if (!box) return;
  let html = '';
  if (!st) html += '<div class="warn">no pude hablar con el servidor de petalwave</div>';
  else if (!st.configured) html += setupHtml();
  else if (!st.connected) {
    html += `<div class="sp-card"><div class="sp-h"><span class="sp-logo">●</span><b>Spotify</b><span class="m">app configurada</span></div>
      <div class="ybar"><button class="go sp-go" id="spLogin">iniciar sesión con Spotify</button><button class="cb sm" id="spChange">cambiar Client ID</button></div>
      <div class="m">se abre Spotify en tu navegador: iniciá sesión y aceptá. Después volvé acá.</div></div>`;
  } else {
    html += `<div class="sp-card row"><span class="sp-logo">●</span><span>conectado como <b>${esc(st.user ? st.user.name : '')}</b>${st.user && st.user.product ? ` <span class="m">(${esc(st.user.product)})</span>` : ''}</span><span class="sp"></span><button class="cb sm" id="spLogout">cerrar sesión</button></div>`;
  }
  html += `<div class="sp-link"><div class="search"><svg class="i"><use href="#i-search"/></svg><input type="text" id="spUrl" placeholder="pegá un link de Spotify (canción, álbum o playlist) · funciona sin iniciar sesión" spellcheck="false" autocomplete="off"></div><button class="go sp-go" id="spOpen">abrir</button></div>`;
  if (view) html += listHtml();
  else if (st && st.connected) {
    html += !lists ? '<div class="empty">cargando tus playlists de Spotify…</div>' : lists.error ? `<div class="warn">${esc(lists.error)}</div>`
      : `<div class="ycards">${[{ id: '__liked', name: '♥ Canciones que te gustan', count: '', thumb: '' }, ...lists.items].map((p, i) => `
        <div class="card" data-spl="${i}"><div class="cimg sp-cimg">${p.id === '__liked' ? '♥' : '♫'}${p.thumb ? `<img loading="lazy" src="${esc(p.thumb)}" referrerpolicy="no-referrer" onerror="this.classList.add('x')">` : ''}</div>
        <div class="cn">${esc(p.name)}</div><div class="cs">${p.id === '__liked' ? 'tu biblioteca' : `${esc(p.owner || '')}${p.count ? ' · ' + p.count : ''}`}</div></div>`).join('')}</div>`;
  }
  box.innerHTML = html;
  bind();
}

function listHtml() {
  const v = view, done = v.matches.filter((m) => m !== undefined).length;
  const found = v.matches.filter(Boolean), local = found.filter((m) => m.local), miss = v.matches.filter((m) => m === null).length;
  const prog = v.tracks.length ? Math.round((done / v.tracks.length) * 100) : 100;
  const status = (i) => {
    const m = v.matches[i];
    if (m === undefined) return '<span class="ybadge dl">buscando…</span>';
    if (m === null) return '<span class="ybadge miss" title="no se encontró en YouTube Music">✗ no está</span>';
    if (m.local) return `<span class="ybadge have" data-sp-play="${i}" title="reproducir tu copia">✓ la tenés</span>`;
    return `<span class="ybadge sp-on" data-sp-play="${i}" title="${esc((m.title || '') + ' — ' + (m.artists || []).join(', '))}">☁ online</span>`;
  };
  return `<div class="yhead">${v.thumb ? `<img src="${esc(v.thumb)}" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}<div><button class="cb sm" id="spBack">← volver</button><div class="m">spotify → youtube music</div><h2>${esc(v.title)}</h2>
    <div class="m">${v.tracks.length} canciones · <span style="color:var(--ok)">${local.length} en tu PC</span> · <span style="color:var(--cy)">${found.length - local.length} online</span>${miss ? ` · <span style="color:var(--warn)">${miss} no encontradas</span>` : ''}${v.partial ? ' · (el link público muestra las primeras 100: iniciá sesión para la lista completa)' : ''}</div></div></div>
    ${done < v.tracks.length ? `<div class="sp-prog"><i style="width:${prog}%"></i></div><div class="m">buscando cada canción en YouTube Music… ${done}/${v.tracks.length}</div>` : ''}
    <div class="ybar"><button class="go" id="spPlay" ${found.length ? '' : 'disabled'}>${icon('play')} reproducir (${found.length})</button>
      <button class="cb" id="spDl" ${found.length - local.length ? '' : 'disabled'}>${icon('dl')} bajar las ${found.length - local.length} que faltan</button>
      <button class="cb" id="spMk" ${found.length ? '' : 'disabled'}>crear playlist en petalwave</button></div>
    <div class="ylist">${v.tracks.map((t, i) => `<div class="yrow" data-spi="${i}"><span class="ix">${i + 1}</span><img loading="lazy" src="${esc(t.thumb || '')}" referrerpolicy="no-referrer" onerror="this.style.visibility='hidden'">
      <div style="min-width:0"><div class="t">${esc(t.name)}</div><div class="a">${esc((t.artists || []).join(', '))}</div></div><span class="al">${esc(t.album || '')}</span><span class="d">${t.duration ? fmtTime(t.duration) : ''}</span>${status(i)}<span></span></div>`).join('')}</div>`;
}

function idsOf() { return view.matches.map((m) => (m ? m.local || remoteTrack(m).id : null)).filter(Boolean); }

function bind() {
  const q = (s) => box.querySelector(s);
  const on = (s, fn) => { const el = q(s); if (el) el.onclick = fn; };
  on('#spCopy', () => navigator.clipboard.writeText(q('#spRedir').textContent).then(() => toast('copiado ✓', { ms: 1200 })));
  on('#spSave', async () => { try { st = await api.post('/api/spotify/config', { clientId: q('#spCid').value }); toast('Client ID guardado ✓'); paint(); } catch (e) { toast(e.message, { kind: 'err', ms: 5000 }); } });
  on('#spChange', () => { st = { ...st, configured: false }; paint(); });
  on('#spLogin', async () => {
    try {
      const { url } = await api.get('/api/spotify/login');
      window.open(url, '_blank');   // en la ventana nativa se abre en tu navegador
      toast('se abrió Spotify en tu navegador ❀', { sub: 'iniciá sesión, aceptá y volvé a petalwave', ms: 5000 });
      waitLogin();
    } catch (e) { toast(e.message, { kind: 'err' }); }
  });
  on('#spLogout', async () => { st = await api.post('/api/spotify/logout'); lists = null; view = null; paint(); });
  on('#spOpen', () => openUrl(q('#spUrl').value));
  const u = q('#spUrl'); if (u) u.onkeydown = (e) => { if (e.key === 'Enter') openUrl(u.value); };
  on('#spBack', () => { view = null; paint(); });
  box.querySelectorAll('[data-spl]').forEach((c) => (c.onclick = () => {
    const p = [{ id: '__liked', name: 'Canciones que te gustan' }, ...lists.items][+c.dataset.spl];
    openList(p.id === '__liked' ? { kind: 'liked' } : { kind: 'playlist', id: p.id, name: p.name, thumb: p.thumb });
  }));
  on('#spPlay', () => playList(idsOf(), 0));
  on('#spDl', () => downloadMissing());
  on('#spMk', async () => { const pl = await plOp({ create: { name: view.title, tracks: idsOf() } }); toast(`playlist «${pl.name}» creada con ${pl.tracks.length}`); go({ type: 'pl', key: pl.id }); bus.emit('ws', 'music'); });
  const list = q('.ylist');
  if (list) list.onclick = (e) => {
    const b = e.target.closest('[data-sp-play]'); if (!b) return;
    const ids = idsOf(), m = view.matches[+b.dataset.spPlay];
    playList(ids, Math.max(0, ids.indexOf(m.local || 'yt_' + m.videoId)));
  };
}

let waitT = null;
function waitLogin() {
  clearInterval(waitT);
  let n = 0;
  waitT = setInterval(async () => {
    if (++n > 150) return clearInterval(waitT);
    await spotStatus();
    if (st && st.connected) { clearInterval(waitT); toast('Spotify conectado ✓', { sub: st.user ? st.user.name : '' }); lists = null; renderSpotify(); }
  }, 2000);
}
async function loadLists() {
  lists = null;
  try { lists = await api.get('/api/spotify/playlists'); } catch (e) { lists = { error: e.message, items: [] }; }
  if (!view) paint();
}
async function openList(o) {
  view = { title: o.name || '…', thumb: o.thumb || '', tracks: [], matches: [] };
  box.innerHTML = '<div class="empty">leyendo la lista de Spotify…</div>';
  try {
    const r = await api.get(`/api/spotify/list?kind=${o.kind}${o.id ? '&id=' + o.id : ''}`);
    view = { title: r.title, thumb: r.thumb || o.thumb || '', tracks: r.tracks, matches: new Array(r.tracks.length).fill(undefined) };
    paint(); matchAll(view);
  } catch (e) { view = null; paint(); toast(e.message, { kind: 'err', ms: 6000 }); }
}
async function openUrl(url) {
  url = String(url || '').trim(); if (!url) return;
  box.querySelector('#spOpen').disabled = true;
  try {
    const r = await api.post('/api/spotify/url', { url });
    view = { title: r.title, thumb: r.thumb, tracks: r.tracks, matches: new Array(r.tracks.length).fill(undefined), partial: r.partial };
    paint(); matchAll(view);
  } catch (e) { toast(e.message, { kind: 'err', ms: 6000 }); paint(); }
}
// busca de a tandas para ir mostrando el avance
async function matchAll(v) {
  for (let i = 0; i < v.tracks.length; i += 15) {
    if (view !== v) return;   // el usuario cambió de lista
    try {
      const r = await api.post('/api/spotify/match', { tracks: v.tracks.slice(i, i + 15) });
      r.matches.forEach((m, k) => (v.matches[i + k] = m || null));
    } catch (e) { for (let k = i; k < Math.min(i + 15, v.tracks.length); k++) v.matches[k] = null; toast(e.message, { kind: 'err' }); }
    if (view === v) paint();
  }
}
async function downloadMissing() {
  const ms = view.matches.filter((m) => m && !m.local);
  const d = P.get('dl'), format = d.format === 'mp4' ? 'mp3' : d.format;
  try {
    const r = await api.post('/api/downloads', { urls: ms.map((m) => `https://music.youtube.com/watch?v=${m.videoId}`), format, quality: format === 'mp3' ? d.quality || '320' : 'best', cookies: d.cookies || '' });
    toast(`${r.ids.length} descargas en cola ⇣`, { sub: 'el audio viene de YouTube Music' });
  } catch (e) { toast(e.message, { kind: 'err' }); }
}

// para el workspace de descargas: links de Spotify → buscar en YouTube Music → descargar
export async function spotifyLinksToDownloads(urls, opts, log) {
  let total = 0;
  for (const url of urls) {
    log('♫ leyendo link de Spotify: ' + url, 'dm');
    let r;
    try { r = await api.post('/api/spotify/url', { url }); } catch (e) { log('spotify: ' + e.message, 'er'); continue; }
    log(`♫ «${r.title}»: ${r.tracks.length} canciones, buscándolas en YouTube Music…`, 'pk');
    const vids = [];
    for (let i = 0; i < r.tracks.length; i += 15) {
      const m = await api.post('/api/spotify/match', { tracks: r.tracks.slice(i, i + 15) }).catch(() => ({ matches: [] }));
      m.matches.forEach((x, k) => { if (x) vids.push(x.videoId); else log(`  ✗ no encontrada: ${r.tracks[i + k].artists.join(', ')} — ${r.tracks[i + k].name}`, 'wa'); });
    }
    if (!vids.length) continue;
    const j = await api.post('/api/downloads', { ...opts, playlist: false, urls: vids.map((v) => `https://music.youtube.com/watch?v=${v}`) });
    total += j.ids.length;
    log(`♫ ${j.ids.length} descargas en cola desde «${r.title}»`, 'ok');
  }
  return total;
}
bus.on('sse:spotify', (s) => { st = s; if (s.connected) lists = null; renderSpotify(); });
