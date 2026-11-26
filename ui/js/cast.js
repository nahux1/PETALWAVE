// radios en vivo y podcasts (biblioteca → radios / podcasts)
// - radios: Radio Browser (base abierta, de todo el mundo). La cola son las radios de la lista: ⏭ cambia de radio.
//   Arriba se ve el tema que está pasando la radio (si la radio lo manda).
// - podcasts: buscador y populares de Apple Podcasts, feeds RSS de cualquier podcast. Seguís los que te gustan:
//   los capítulos nuevos se bajan solos (con WiFi en el celular) y suenan sin internet. Recuerda dónde quedaste.
// El audio pasa por el servidor local (/cast/<clave>): así suenan con el ecualizador y el visualizador.
import { $, $$, api, bus, P, esc, toast, fmtTime, fmtSize, icon, ctxMenu, confirm2, local } from './core.js';
import { D, T, keepRemote } from './data.js';
import * as player from './player.js';
import { isOffline } from './offline.js';
import { netType } from './smartdl.js';

// ---------- claves y registro en el servidor ----------
export function ckey(s) {
  let a = 0x811c9dc5, b = 0x9747b28c;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); a = Math.imul(a ^ c, 16777619); b = Math.imul(b ^ c, 2246822519) ^ (b >>> 13); }
  return ((a >>> 0).toString(36) + (b >>> 0).toString(36)).padEnd(10, '0').slice(0, 16);
}
const keyOf = (id) => String(id).slice(3);
async function reg(tracks) {
  const items = [];
  for (const t of tracks) { items.push({ key: keyOf(t.id), url: t.url }); if (t.img) items.push({ key: keyOf(t.id) + 'i', url: t.img }); }
  for (let i = 0; i < items.length; i += 400) await api.post('/api/cast/reg', { items: items.slice(i, i + 400) });
}
// con datos móviles lentos el primer pedido a veces no llega a tiempo: se reintenta una vez
async function getText(u, retry = 1) {
  const r = await fetch('/api/cast/fetch?u=' + encodeURIComponent(u));
  if (!r.ok) {
    let m = 'HTTP ' + r.status; try { m = (await r.json()).error || m; } catch {}
    if (retry > 0 && !isOffline()) return getText(u, retry - 1);
    throw new Error(m);
  }
  return r.text();
}
const getJson = async (u) => JSON.parse(await getText(u));
const country = () => {
  const c = P.get('castCountry'); if (c) return c;
  const m = /-([A-Za-z]{2})$/.exec(navigator.language || ''); return (m ? m[1] : 'AR').toUpperCase();
};
let regionName = (cc) => cc;
try { const dn = new Intl.DisplayNames(['es'], { type: 'region' }); regionName = (cc) => { try { return dn.of(cc); } catch { return cc; } }; } catch {}

// ---------- capítulos guardados ----------
const st = { saved: new Set(), saving: 0, bytes: 0, current: null };
export const castSaved = (t) => !!t && t.cast === 'pod' && st.saved.has(keyOf(t.id));
async function refreshSaved() {
  try { const j = await api.get('/api/cast/saved'); st.saved = new Set(j.keys || []); st.saving = j.saving || 0; st.bytes = j.bytes || 0; st.current = j.current; } catch {}
  repaint();
}

// ---------- radios ----------
const RB = ['de1', 'fi1', 'de2', 'nl1'].map((h) => `https://${h}.api.radio-browser.info`);
async function rb(pathQs) {
  let last;
  for (const b of RB) { try { return await getJson(b + pathQs); } catch (e) { last = e; } }
  throw last || new Error('no se pudo conectar con Radio Browser');
}
const goodStation = (s) => s && (s.url_resolved || s.url) && !/hls/i.test(s.codec || '') && !/\.m3u8(\?|$)/i.test(s.url_resolved || s.url);
const slim = (s) => ({ stationuuid: s.stationuuid, name: s.name, url_resolved: s.url_resolved || s.url, favicon: s.favicon || '', tags: s.tags || '', countrycode: s.countrycode || '', bitrate: s.bitrate || 0, codec: s.codec || '' });
function radioTrack(s) {
  const url = s.url_resolved || s.url;
  const old = D.remote.get('rd_' + ckey('r' + url));
  if (old) { old.fav = favs().some((f) => f.stationuuid === (s.stationuuid || old.uuid)); return old; }   // la misma (la que suena conserva el tema que está pasando)
  const tags = String(s.tags || '').split(',').map((x) => x.trim()).filter(Boolean).slice(0, 2);
  return keepRemote({
    id: 'rd_' + ckey('r' + url), remote: true, cast: 'radio', live: true, title: String(s.name || 'radio').trim(), artist: [s.countrycode ? regionName(s.countrycode) : '', ...tags].filter(Boolean).join(' · ') || 'radio',
    album: 'radio en vivo', duration: 0, ext: 'radio', bitrate: s.bitrate || 0, video: false, hasCover: !!s.favicon, added: 0, name: s.name || '', genre: tags[0] || '', year: null, trackNo: null, available: true,
    url, img: s.favicon || '', uuid: s.stationuuid, fav: favs().some((f) => f.stationuuid === s.stationuuid),
  });
}
const favs = () => P.get('radioFav') || [];
function toggleFav(s) {
  const l = favs(), on = !l.some((f) => f.stationuuid === s.stationuuid);
  P.set('radioFav', on ? [slim(s), ...l].slice(0, 200) : l.filter((f) => f.stationuuid !== s.stationuuid));
  const t = T('rd_' + ckey('r' + (s.url_resolved || s.url))); if (t) t.fav = on;
  toast(on ? `«${s.name}» en tus radios ♥` : 'quitada de tus radios', { ms: 1400 });
  bus.emit('like');
}
const TAGS = ['rock', 'pop', 'cumbia', 'reggaeton', 'electronic', 'lofi', 'jazz', 'classical', 'news', 'sports', 'folk', 'tango'];
const TAG_ES = { electronic: 'electrónica', classical: 'clásica', news: 'noticias', sports: 'deportes' };
const R = { mode: favs().length ? 'fav' : 'country', q: '', list: [], loading: false, err: '' };

async function loadRadios() {
  R.loading = true; R.err = ''; paintRadios();
  const base = '&hidebroken=true&order=clickcount&reverse=true&limit=80';
  try {
    if (R.mode === 'fav') R.list = favs();
    else if (R.mode === 'country') R.list = await rb(`/json/stations/search?countrycode=${country()}${base}`);
    else if (R.mode === 'top') R.list = await rb('/json/stations/topclick/80?hidebroken=true');
    else if (R.mode === 'search') R.list = await rb(`/json/stations/search?name=${encodeURIComponent(R.q)}${base}`);
    else if (R.mode.startsWith('tag:')) R.list = await rb(`/json/stations/search?tag=${encodeURIComponent(R.mode.slice(4))}${base}`);
    R.list = R.list.filter(goodStation);
    // la misma radio aparece varias veces (distintas calidades): queda la primera
    const seen = new Set(); R.list = R.list.filter((s) => { const k = String(s.name).toLowerCase().trim(); if (seen.has(k)) return false; seen.add(k); return true; });
    await reg(R.list.map(radioTrack));
  } catch (e) { R.err = e.message; R.list = []; }
  R.loading = false; paintRadios();
}
let box = null;   // { head, body, view }
function radioHead() {
  const chip = (k, l) => `<button class="cb sm ${R.mode === k ? 'on' : ''}" data-rk="${esc(k)}">${l}</button>`;
  return `<div class="ttlbar"><div style="min-width:0;flex:1"><div class="sub">en vivo · de todo el mundo · ⏭ cambia de radio</div><h2>📻 radios</h2>
    <form class="cast-bar" id="rdForm"><input class="inp" id="rdQ" placeholder="buscar una radio…" value="${esc(R.q)}" autocomplete="off" spellcheck="false"><button class="go sm">buscar</button></form>
    <div class="cast-chips">${chip('fav', '♥ mis radios')}${chip('country', '📍 ' + esc(regionName(country())))}${chip('top', '🌎 más escuchadas')}${TAGS.map((g) => chip('tag:' + g, esc(TAG_ES[g] || g))).join('')}</div></div></div>`;
}
function paintRadios() {
  if (!box || box.view.type !== 'radio') return;
  const { body } = box;
  if (R.loading) { body.innerHTML = '<div class="empty">buscando radios…</div>'; return; }
  if (isOffline() && R.mode !== 'fav') { body.innerHTML = '<div class="empty">✈ sin internet: las radios necesitan conexión</div>'; return; }
  if (R.err) { body.innerHTML = `<div class="empty">no se pudo cargar la lista de radios<br><span class="m">${esc(R.err)}</span><br><button class="cb sm" id="rdRetry">reintentar</button></div>`; body.querySelector('#rdRetry').onclick = (e) => { e.stopPropagation(); loadRadios(); }; return; }
  if (!R.list.length) { body.innerHTML = `<div class="empty">${R.mode === 'fav' ? 'todavía no guardaste radios: tocá ♡ en una para tenerla acá' : 'no encontré radios'}</div>`; return; }
  const cur = player.current();
  body.innerHTML = `<div class="cast-grid">${R.list.map((s, i) => {
    const t = radioTrack(s), on = cur && cur.id === t.id, fav = favs().some((f) => f.stationuuid === s.stationuuid);
    return `<div class="ccard ${on ? 'cur' : ''}" data-ri="${i}"><img loading="lazy" src="/cast/${keyOf(t.id)}i" onerror="this.style.visibility='hidden'"><div class="ct"><b>${on ? '♪ ' : ''}${esc(t.title)}</b><span class="m">${esc(t.artist)}${s.bitrate ? ' · ' + s.bitrate + ' kbps' : ''}</span></div><button class="ico cfav ${fav ? 'on' : ''}" data-rf="${i}" title="${fav ? 'quitar de mis radios' : 'guardar en mis radios'}">${fav ? '♥' : '♡'}</button></div>`;
  }).join('')}</div><div class="src m" style="padding:10px 4px">fuente: Radio Browser (radio-browser.info)</div>`;
}
function bindRadio(head, body) {
  head.querySelector('#rdForm').onsubmit = (e) => { e.preventDefault(); const q = head.querySelector('#rdQ').value.trim(); if (!q) return; R.q = q; R.mode = 'search'; head.innerHTML = radioHead(); bindRadio(head, body); loadRadios(); };
  head.querySelectorAll('[data-rk]').forEach((b) => (b.onclick = () => { R.mode = b.dataset.rk; head.innerHTML = radioHead(); bindRadio(head, body); loadRadios(); }));
  body.onclick = async (e) => {
    const f = e.target.closest('[data-rf]');
    if (f) { e.stopPropagation(); toggleFav(R.list[+f.dataset.rf]); if (R.mode === 'fav') R.list = favs(); return paintRadios(); }
    const c = e.target.closest('[data-ri]'); if (!c) return;
    if (isOffline()) return toast('✈ sin internet: las radios necesitan conexión', { kind: 'warn' });
    const tracks = R.list.map(radioTrack);
    await reg(tracks);
    player.playList(tracks.map((t) => t.id), +c.dataset.ri, { shuffle: false });
  };
}

// el tema que está pasando la radio (cada 20 s mientras suena)
let metaT = 0;
function watchRadio(t) {
  clearInterval(metaT);
  if (!t || t.cast !== 'radio') return;
  const tick = async () => {
    const c = player.current(); if (!c || c.id !== t.id) return clearInterval(metaT);
    try {
      const j = await api.get('/api/cast/meta/' + keyOf(t.id));
      const now = j && j.title ? '♪ ' + j.title : 'radio en vivo';
      if (now !== t.album) { t.album = now; player.renderNP(); }
    } catch {}
  };
  setTimeout(tick, 3000);
  metaT = setInterval(tick, 20000);
}

// ---------- podcasts ----------
const pods = () => P.get('pods') || [];
const savePods = (l) => P.set('pods', l);
const feeds = new Map();   // feed → { pod, eps, at }
const POS = 'pw-podpos';
const pos = local.get(POS, {}) || {};
const savePos = () => { const k = Object.keys(pos); if (k.length > 2000) for (const x of k.slice(0, k.length - 2000)) delete pos[x]; local.set(POS, pos); };
const strip = (h) => String(h || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
function parseDur(s) {
  s = String(s || '').trim(); if (!s) return 0;
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(+s);
  const p = s.split(':').map(Number); if (p.some(isNaN)) return 0;
  return p.reduce((a, x) => a * 60 + x, 0);
}
function child(el, name) { for (const c of el ? el.children : []) if (c.tagName === name) return c; return null; }
const ctext = (el, name) => { const c = child(el, name); return c ? c.textContent.trim() : ''; };
function parseFeed(xml, feed) {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const ch = doc.getElementsByTagName('channel')[0];
  if (!ch || doc.getElementsByTagName('parsererror').length) throw new Error('ese feed no se pudo leer');
  const img = (el) => { const i = child(el, 'itunes:image'); if (i && i.getAttribute('href')) return i.getAttribute('href'); const im = child(el, 'image'); return im ? ctext(im, 'url') || im.getAttribute('href') || '' : ''; };
  const pod = { feed, title: ctext(ch, 'title') || 'podcast', author: ctext(ch, 'itunes:author') || ctext(ch, 'author') || '', img: img(ch), desc: strip(ctext(ch, 'description') || ctext(ch, 'itunes:summary')).slice(0, 400) };
  const eps = [];
  for (const it of ch.getElementsByTagName('item')) {
    const enc = child(it, 'enclosure'); const url = enc && enc.getAttribute('url'); if (!url) continue;
    const type = enc.getAttribute('type') || '';
    if (/^video\//.test(type) && !/mp4/.test(type)) continue;
    eps.push({ title: ctext(it, 'title') || 'capítulo', url: url.trim(), pub: Date.parse(ctext(it, 'pubDate')) || 0, dur: parseDur(ctext(it, 'itunes:duration')), img: img(it) || pod.img, desc: strip(ctext(it, 'description') || ctext(it, 'itunes:summary')).slice(0, 280) });
    if (eps.length >= 300) break;
  }
  eps.sort((a, b) => b.pub - a.pub);
  return { pod, eps, at: Date.now() };
}
async function loadFeed(feed, force) {
  const have = feeds.get(feed);
  if (have && !force && Date.now() - have.at < 30 * 60e3) return have;
  const f = parseFeed(await getText(feed), feed);
  feeds.set(feed, f);
  return f;
}
const epId = (e) => 'pc_' + ckey('p' + e.url);
function epTrack(pod, e) {
  const old = D.remote.get(epId(e));
  if (old && old.title === e.title) return old;
  return keepRemote({
    id: epId(e), remote: true, cast: 'pod', title: e.title, artist: pod.title, album: pod.title, duration: e.dur, ext: 'podcast', bitrate: 0, video: false, hasCover: !!e.img,
    added: 0, name: e.title, genre: 'podcast', year: null, trackNo: null, available: true, url: e.url, img: e.img, feed: pod.feed, pub: e.pub,
  });
}
const done = (id) => { const p = pos[id]; return p === -1; };
async function playEp(f, i) {
  const e = f.eps[i];
  const t = epTrack(f.pod, e);
  if (isOffline() && !castSaved(t)) return toast('✈ sin internet: este capítulo no está guardado', { kind: 'warn' });
  // después del que elegiste siguen los más nuevos, en orden (como quien se pone al día)
  const after = f.eps.slice(Math.max(0, i - 30), i).reverse().map((x) => epTrack(f.pod, x)).filter((x) => !isOffline() || castSaved(x));
  const list = [t, ...after];
  await reg(list);
  const at = pos[t.id] > 0 && (!t.duration || pos[t.id] < t.duration - 20) ? pos[t.id] : 0;
  player.playList(list.map((x) => x.id), 0, { shuffle: false, startAt: at });
  if (at) toast(`sigue donde quedaste: ${fmtTime(at)}`, { ms: 1800 });
}
async function saveEps(f, list) {
  const tracks = list.map((e) => epTrack(f.pod, e)).filter((t) => !castSaved(t));
  if (!tracks.length) return toast('ya están guardados ✓', { ms: 1400 });
  await reg(tracks);
  const r = await api.post('/api/cast/save', { keys: tracks.map((t) => keyOf(t.id)) });
  toast(r.queued > 1 ? `guardando ${r.queued} capítulos ✈` : 'guardando el capítulo ✈', { sub: 'se bajan en segundo plano · después suenan sin internet', ms: 2200 });
  refreshSaved();
}
const isSub = (feed) => pods().some((p) => p.feed === feed);
function toggleSub(f) {
  const l = pods();
  if (isSub(f.pod.feed)) { savePods(l.filter((p) => p.feed !== f.pod.feed)); toast('ya no seguís «' + f.pod.title + '»', { ms: 1500 }); }
  else { savePods([{ feed: f.pod.feed, title: f.pod.title, img: f.pod.img, author: f.pod.author, last: f.eps[0] ? f.eps[0].pub : 0, seen: Date.now(), at: Date.now() }, ...l].slice(0, 60)); toast('seguís «' + f.pod.title + '» ✓', { sub: P.get('podAuto') !== false ? 'los capítulos nuevos se guardan solos para escuchar sin internet' : '', ms: 2200 }); }
}

// búsqueda y populares (Apple Podcasts)
const PD = { q: '', results: null, top: null, topAt: 0, err: '', loading: false };
async function loadTop() {
  if (PD.top && (PD.top.length || Date.now() - PD.topAt < 60e3)) return;
  PD.topAt = Date.now();
  try {
    const j = await getJson(`https://rss.applemarketingtools.com/api/v2/${country().toLowerCase()}/podcasts/top/30/podcasts.json`);
    PD.top = ((j.feed && j.feed.results) || []).map((x) => ({ id: x.id, title: x.name, author: x.artistName, img: (x.artworkUrl100 || '').replace('100x100', '300x300') }));
  } catch (e) { PD.top = []; PD.err = e.message; }
}
async function search(q) {
  PD.loading = true; paintPods();
  try {
    const j = await getJson(`https://itunes.apple.com/search?media=podcast&limit=30&country=${country()}&term=${encodeURIComponent(q)}`);
    PD.results = (j.results || []).filter((x) => x.feedUrl).map((x) => ({ feed: x.feedUrl, title: x.collectionName, author: x.artistName, img: x.artworkUrl600 || x.artworkUrl100 }));
    PD.err = '';
  } catch (e) { PD.results = []; PD.err = e.message; }
  PD.loading = false; paintPods();
}
async function openPod(it) {
  let feed = it.feed;
  if (!feed && it.id) {
    try { const j = await getJson('https://itunes.apple.com/lookup?id=' + it.id); feed = j.results && j.results[0] && j.results[0].feedUrl; } catch {}
    if (!feed) return toast('no encontré el feed de ese podcast', { kind: 'warn' });
  }
  (await import('./library.js')).go({ type: 'pod', key: feed });
}
// las imágenes de podcasts se piden por el servidor (también las http y sin CORS)
const imgKeys = new Map();
function imgSrc(url) {
  if (!url) return '';
  let k = imgKeys.get(url);
  if (!k) { k = ckey('i' + url) + 'i'; imgKeys.set(url, k); pendingImg.push({ key: k, url }); }
  return '/cast/' + k;
}
let pendingImg = [];
async function flushImgs() { if (!pendingImg.length) return; const items = pendingImg; pendingImg = []; try { await api.post('/api/cast/reg', { items }); } catch {} }
const card = (it, attrs, badge = '') => `<div class="ccard pod" ${attrs}><img loading="lazy" data-src="${esc(imgSrc(it.img))}" onerror="this.style.visibility='hidden'"><div class="ct"><b>${esc(it.title)}</b><span class="m">${esc(it.author || '')}</span></div>${badge}</div>`;
async function showImgs(root) { await flushImgs(); root.querySelectorAll('img[data-src]').forEach((im) => { if (im.dataset.src) im.src = im.dataset.src; im.removeAttribute('data-src'); }); }

function podsHead() {
  return `<div class="ttlbar"><div style="min-width:0;flex:1"><div class="sub">seguí los que te gustan: los capítulos nuevos se guardan solos</div><h2>🎙 podcasts</h2>
    <form class="cast-bar" id="pdForm"><input class="inp" id="pdQ" placeholder="buscar un podcast…" value="${esc(PD.q)}" autocomplete="off" spellcheck="false"><button class="go sm">buscar</button><button type="button" class="cb sm" id="pdRss" title="agregar un podcast por su dirección RSS">+ RSS</button></form></div></div>`;
}
async function paintPods() {
  if (!box || box.view.type !== 'pods') return;
  const { body } = box;
  const subs = pods();
  let html = '';
  if (subs.length) html += `<h3 class="cast-h">tus podcasts</h3><div class="cast-grid">${subs.map((p, i) => card(p, `data-ps="${i}"`, p.n ? `<span class="cbadge">${p.n > 9 ? '9+' : p.n} nuevo${p.n > 1 ? 's' : ''}</span>` : '')).join('')}</div>`;
  const saved = [...D.remote.values()].filter((t) => t.cast === 'pod' && castSaved(t)).sort((a, b) => (b.pub || 0) - (a.pub || 0));
  if (saved.length || st.saving) html += `<h3 class="cast-h">✈ guardados para escuchar sin internet <span class="m">${saved.length} · ${fmtSize(st.bytes)}${st.saving ? ` · bajando ${st.saving}…` : ''}</span></h3><div class="eplist">${saved.slice(0, 40).map((t) => epRowSaved(t)).join('')}</div>`;
  if (PD.loading) html += '<div class="empty">buscando…</div>';
  else if (PD.results) html += `<h3 class="cast-h">resultados <button class="cb sm" id="pdClr">✕</button></h3>${PD.results.length ? `<div class="cast-grid">${PD.results.map((p, i) => card(p, `data-pr="${i}"`)).join('')}</div>` : `<div class="empty">no encontré podcasts${PD.err ? '<br><span class="m">' + esc(PD.err) + '</span>' : ''}</div>`}`;
  else if (isOffline()) html += subs.length || saved.length ? '' : '<div class="empty">✈ sin internet: guardá capítulos con internet para escucharlos acá</div>';
  else {
    if (!PD.top) { body.innerHTML = html + '<div class="empty">cargando populares…</div>'; await loadTop(); if (!box || box.view.type !== 'pods') return; return paintPods(); }
    if (PD.top.length) html += `<h3 class="cast-h">populares en ${esc(regionName(country()))}</h3><div class="cast-grid">${PD.top.map((p, i) => card(p, `data-pt="${i}"`)).join('')}</div>`;
    else html += `<div class="empty">no se pudieron cargar los populares${PD.err ? '<br><span class="m">' + esc(PD.err) + '</span>' : ''}<br><button class="cb sm" id="pdRetry">reintentar</button></div>`;
  }
  body.innerHTML = html + '<div class="src m" style="padding:10px 4px">búsqueda y populares: Apple Podcasts · los capítulos vienen del feed de cada podcast</div>';
  showImgs(body);
  const rt = body.querySelector('#pdRetry'); if (rt) rt.onclick = () => { PD.top = null; PD.err = ''; paintPods(); };
  const c = body.querySelector('#pdClr'); if (c) c.onclick = () => { PD.results = null; PD.q = ''; const q = $('#pdQ'); if (q) q.value = ''; paintPods(); };
}
function epRowSaved(t) {
  const p = pos[t.id];
  return `<div class="eprow" data-sv="${esc(t.id)}"><button class="ib sm" data-sp="${esc(t.id)}">${icon('play')}</button><div class="et"><b>${esc(t.title)}</b><span class="m">${esc(t.artist)}${t.pub ? ' · ' + new Date(t.pub).toLocaleDateString() : ''}${t.duration ? ' · ' + fmtTime(t.duration) : ''}${p === -1 ? ' · ✓ escuchado' : p > 0 ? ' · quedaste en ' + fmtTime(p) : ''}</span></div><button class="cb sm" data-sx="${esc(t.id)}" title="borrar del celular / PC">🗑</button></div>`;
}
function bindPods(head, body) {
  head.querySelector('#pdForm').onsubmit = (e) => { e.preventDefault(); const q = head.querySelector('#pdQ').value.trim(); if (!q) return; if (/^https?:\/\//i.test(q)) return openPod({ feed: q }); PD.q = q; search(q); };
  head.querySelector('#pdRss').onclick = () => { const q = head.querySelector('#pdQ'); q.value = 'https://'; q.focus(); toast('pegá la dirección RSS del podcast y tocá buscar', { ms: 2400 }); };
  body.onclick = async (e) => {
    const sp = e.target.closest('[data-sp]');
    if (sp) { const t = T(sp.dataset.sp); if (t) { await reg([t]); const at = pos[t.id] > 0 ? pos[t.id] : 0; player.playList([t.id], 0, { shuffle: false, startAt: at }); } return; }
    const sx = e.target.closest('[data-sx]');
    if (sx) { await api.post('/api/cast/remove', { keys: [keyOf(sx.dataset.sx)] }); return refreshSaved(); }
    const s = e.target.closest('[data-ps]'); if (s) return openPod(pods()[+s.dataset.ps]);
    const r = e.target.closest('[data-pr]'); if (r) return openPod(PD.results[+r.dataset.pr]);
    const tp = e.target.closest('[data-pt]'); if (tp) return openPod(PD.top[+tp.dataset.pt]);
  };
}

// un podcast: sus capítulos
async function renderPod(feed, head, body) {
  head.innerHTML = '<div class="ttlbar"><div><h2>🎙 podcast</h2></div></div>';
  body.innerHTML = '<div class="empty">cargando capítulos…</div>';
  let f;
  try { f = await loadFeed(feed); }
  catch (e) {
    // sin internet: lo que esté guardado de este podcast
    const saved = [...D.remote.values()].filter((t) => t.cast === 'pod' && t.feed === feed && castSaved(t));
    if (saved.length) f = { pod: { feed, title: saved[0].artist, img: saved[0].img, author: '' }, eps: saved.map((t) => ({ title: t.title, url: t.url, pub: t.pub, dur: t.duration, img: t.img, desc: '' })), at: Date.now() };
    else { body.innerHTML = `<div class="empty">${isOffline() ? '✈ sin internet: no hay capítulos guardados de este podcast' : 'no se pudo leer el podcast'}<br><span class="m">${esc(e.message)}</span></div>`; return; }
  }
  if (!box || box.view.type !== 'pod' || box.view.key !== feed) return;
  const subs = pods(), si = subs.findIndex((p) => p.feed === feed);
  if (si >= 0) { subs[si] = { ...subs[si], n: 0, seen: Date.now(), last: Math.max(subs[si].last || 0, f.eps[0] ? f.eps[0].pub : 0), title: f.pod.title, img: f.pod.img || subs[si].img }; savePods(subs); }
  const paint = () => {
    const sub = isSub(feed);
    head.innerHTML = `<div class="ttlbar"><img class="hcover" data-src="${esc(imgSrc(f.pod.img))}" onerror="this.style.visibility='hidden'"><div style="min-width:0"><div class="sub">podcast${f.pod.author ? ' · ' + esc(f.pod.author) : ''} · ${f.eps.length} capítulos</div><h2 data-raw>${esc(f.pod.title)}</h2>${f.pod.desc ? `<div class="sub pdesc">${esc(f.pod.desc)}</div>` : ''}
      <div class="acts"><button class="go" data-pa="last">${icon('play')} el último</button><button class="cb ${sub ? 'on' : ''}" data-pa="sub">${sub ? '✓ siguiendo' : '+ seguir'}</button><button class="cb" data-pa="save3" title="bajar los 3 más nuevos para escuchar sin internet">✈ guardar los 3 últimos</button><button class="cb" data-pa="back">◂ podcasts</button></div></div></div>`;
    const cur = player.current();
    body.innerHTML = `<div class="eplist">${f.eps.map((e, i) => {
      const id = epId(e), p = pos[id], sv = st.saved.has(keyOf(id)), on = cur && cur.id === id;
      return `<div class="eprow ${on ? 'cur' : ''} ${p === -1 ? 'heard' : ''}"><button class="ib sm" data-ep="${i}" title="escuchar">${icon('play')}</button><div class="et" data-ep="${i}"><b>${on ? '♪ ' : ''}${esc(e.title)}</b><span class="m">${e.pub ? new Date(e.pub).toLocaleDateString() : ''}${e.dur ? ' · ' + fmtTime(e.dur) : ''}${p === -1 ? ' · ✓ escuchado' : p > 0 ? ' · quedaste en ' + fmtTime(p) : ''}${st.current === keyOf(id) ? ' · bajando…' : ''}</span>${e.desc ? `<span class="ed">${esc(e.desc)}</span>` : ''}</div><button class="cb sm ${sv ? 'on' : ''}" data-es="${i}" title="${sv ? 'guardado: tocá para borrarlo' : 'guardar para escuchar sin internet'}">${sv ? '✈ ✓' : '✈'}</button></div>`;
    }).join('') || '<div class="empty">este podcast no tiene capítulos con audio</div>'}</div>`;
    showImgs(head);
  };
  paint();
  box.repaintPod = paint;
  head.onclick = async (e) => {
    const a = e.target.closest('[data-pa]'); if (!a) return;
    if (a.dataset.pa === 'last' && f.eps.length) playEp(f, 0);
    if (a.dataset.pa === 'sub') { toggleSub(f); paint(); }
    if (a.dataset.pa === 'save3') saveEps(f, f.eps.slice(0, 3));
    if (a.dataset.pa === 'back') (await import('./library.js')).go({ type: 'pods' });
  };
  body.onclick = async (e) => {
    const s = e.target.closest('[data-es]');
    if (s) { const ep = f.eps[+s.dataset.es], id = epId(ep); if (st.saved.has(keyOf(id))) { await api.post('/api/cast/remove', { keys: [keyOf(id)] }); refreshSaved(); } else saveEps(f, [ep]); return; }
    const p = e.target.closest('[data-ep]'); if (p) playEp(f, +p.dataset.ep);
  };
}

// ---------- dibujar (lo llama library.js) ----------
export function renderCast(view, head, body) {
  box = { head, body, view };
  body.oncontextmenu = null;
  if (view.type === 'radio') { head.innerHTML = radioHead(); bindRadio(head, body); if (!R.list.length && !R.loading) loadRadios(); else paintRadios(); return; }
  if (view.type === 'pods') { head.innerHTML = podsHead(); bindPods(head, body); paintPods(); return; }
  if (view.type === 'pod') return renderPod(view.key, head, body);
}
function repaint() {
  if (!box || !document.body.contains(box.body)) return;
  if (box.view.type === 'radio') paintRadios();
  else if (box.view.type === 'pods') paintPods();
  else if (box.view.type === 'pod' && box.repaintPod) box.repaintPod();
}

// menú de una radio o capítulo (desde la cola o el reproductor)
export function castMenu(x, y, ids) {
  const list = ids.map(T).filter(Boolean), one = list.length === 1 ? list[0] : null;
  const eps = list.filter((t) => t.cast === 'pod');
  ctxMenu(x, y, [
    { header: one ? one.title.slice(0, 40) : `${list.length} elementos` },
    { label: 'reproducir', icon: 'play', fn: () => player.playList(ids, 0) },
    { label: 'reproducir después', icon: 'next', fn: () => player.playNext(ids) },
    { label: 'agregar a la cola', icon: 'queue', fn: () => player.addQueue(ids) },
    one && one.cast === 'radio' && { label: one.fav ? 'quitar de mis radios' : 'guardar en mis radios', icon: 'heart', fn: () => toggleFav({ stationuuid: one.uuid, name: one.title, url_resolved: one.url, favicon: one.img, tags: one.genre, countrycode: '' }) },
    eps.length && { label: eps.every(castSaved) ? 'borrar lo guardado' : 'guardar para escuchar sin internet', icon: 'dl', fn: async () => {
      if (eps.every(castSaved)) { await api.post('/api/cast/remove', { keys: eps.map((t) => keyOf(t.id)) }); return refreshSaved(); }
      await reg(eps); await api.post('/api/cast/save', { keys: eps.map((t) => keyOf(t.id)) }); toast('guardando ✈'); refreshSaved();
    } },
    one && one.feed && { label: 'ir al podcast', icon: 'radio', fn: async () => (await import('./library.js')).go({ type: 'pod', key: one.feed }) },
    one && one.cast === 'radio' && { label: 'ir a radios', icon: 'radio', fn: async () => (await import('./library.js')).go({ type: 'radio' }) },
  ]);
}

// ---------- capítulos nuevos de lo que seguís ----------
async function checkNew() {
  if (isOffline()) return;
  const l = pods(); if (!l.length) return;
  const auto = P.get('podAuto') !== false && !(netType() === 'datos' && P.get('offlineWifi') !== false);
  let changed = false, fresh = [];
  for (const p of l.slice(0, 40)) {
    try {
      const f = await loadFeed(p.feed, true);
      const newest = f.eps[0]; if (!newest) continue;
      const n = f.eps.filter((e) => e.pub > (p.seen || 0)).length;
      if (n !== (p.n || 0)) { p.n = n; changed = true; }
      if (newest.pub > (p.last || 0)) {
        if (p.last) { fresh.push(f.pod.title); if (auto) await saveEps(f, [newest]).catch(() => {}); }
        p.last = newest.pub; changed = true;
      }
    } catch {}
  }
  if (changed) savePods(l);
  if (fresh.length) toast(fresh.length > 1 ? `🎙 ${fresh.length} capítulos nuevos` : `🎙 capítulo nuevo de «${fresh[0]}»`, { sub: auto ? 'se están guardando para escuchar sin internet' : 'en biblioteca → podcasts', ms: 3500 });
  repaint();
}

export function initCast() {
  refreshSaved();
  bus.on('sse:cast', (j) => {
    st.saved = new Set(j.keys || []); st.saving = j.saving || 0; st.bytes = j.bytes || 0; st.current = j.current;
    if (j.error) toast('no se pudo guardar el capítulo', { kind: 'err', sub: j.error });
    repaint();
  });
  bus.on('np', (t) => { watchRadio(t); repaint(); });
  bus.on('offline', () => repaint());
  // dónde quedaste en cada capítulo (cada 10 s) y cuáles terminaste
  let lastSave = 0;
  bus.on('time', (sec) => {
    const t = player.current(); if (!t || t.cast !== 'pod' || !(sec > 5)) return;
    if (Date.now() - lastSave < 10000) return; lastSave = Date.now();
    const d = t.duration || 0;
    pos[t.id] = d && sec > d - 30 ? -1 : Math.round(sec); savePos();
  });
  bus.on('eng:ended', (id) => { const t = T(id); if (t && t.cast === 'pod') { pos[t.id] = -1; savePos(); } });
  bus.on('cast:fav', (t) => { if (t.cast === 'radio') toggleFav({ stationuuid: t.uuid, name: t.title, url_resolved: t.url, favicon: t.img, tags: t.genre, countrycode: '' }); });
  setTimeout(checkNew, 25000);
  setInterval(checkNew, 3 * 3600e3);
}
