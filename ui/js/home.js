// pantalla de Inicio: lo que más usás, a un toque (seguir escuchando, mixes, descubrí, playlists, recién agregadas)
import { $, bus, esc, icon, coverUrl, P } from './core.js';
import { D, T } from './data.js';
import { playList, S as PS } from './player.js';
import { go } from './library.js';
import { recsLocal, recsOnline, cachedDiscover, recsMood, recsTime, MOODS, SLOTS, slotNow, profile } from './taste.js';
import { pendingLook, applyLook, dismissLook, topNav } from './adapt.js';
import { sceneUrl, GALLERY } from './wallgallery.js';

const greet = () => { const h = new Date().getHours(); return h < 6 ? 'Buenas noches' : h < 13 ? 'Buen día' : h < 20 ? 'Buenas tardes' : 'Buenas noches'; };
const cover = (id) => (id ? `<img loading="lazy" src="${coverUrl(id, 'm')}" onerror="this.classList.add('x')">` : '');
const card = (o) => `<div class="card hcard" data-k="${esc(o.k)}"${o.warm ? ` data-warm="${esc(o.warm)}"` : ''}>
  <div class="cimg">${o.glyph || '❀'}${cover(o.cover)}<button class="cplay" data-play="${esc(o.k)}" title="reproducir">${icon('play')}</button></div>
  <div class="cn">${esc(o.title)}</div><div class="cs">${esc(o.sub || '')}</div></div>`;
const row = (title, items, more, key = '') => items.length ? `<section class="hsec" data-sec="${key}"><div class="hsec-h"><h3>${title}</h3>${more ? `<button class="cb sm" data-more="${more}">ver todo</button>` : ''}</div><div class="home-row">${items.map(card).join('')}</div></section>` : '';

let actions = new Map();   // clave de tarjeta → { open, play }
let navUse = [];

export async function renderHome() {
  const box = $('#homeBody'); if (!box) return;
  actions = new Map();
  const add = (k, o) => { actions.set(k, o); return k; };
  const firstCover = (ids) => (ids.map(T).find((t) => t && (t.hasCover || t.remote)) || {}).id;

  // seguir escuchando: lo último que sonó
  const recent = [...new Set(PS.history || [])].map(T).filter(Boolean).slice(0, 10)
    .map((t) => ({ k: add('h:' + t.id, { play: () => playList([t.id, ...recsLocal(20).map((r) => r.id).filter((x) => x !== t.id)], 0) }), title: t.title, sub: t.artist, cover: t.id, warm: t.remote ? t.ytId : '' }));

  // mixes
  const slot = slotNow();
  const mixes = [
    { key: 'recs', title: 'Recomendadas', sub: 'de tu biblioteca, según tus gustos', ids: () => recsLocal(60).map((r) => r.id), glyph: '❀', open: () => go({ type: 'recs' }) },
    { key: 'time', title: 'Mix ' + SLOTS[slot].name, sub: 'lo que escuchás a esta hora', ids: () => recsTime().map((r) => r.id), glyph: SLOTS[slot].icon, open: () => go({ type: 'mix', key: 'time' }) },
    ...Object.entries(MOODS).map(([k, m]) => ({ key: k, title: 'Mix ' + m.name, sub: m.desc, ids: () => recsMood(k).map((r) => r.id), glyph: m.icon, open: () => go({ type: 'mix', key: k }) })),
  ].map((m) => { const ids = m.ids(); return { ...m, ids, cover: firstCover(ids) }; }).filter((m) => m.ids.length)
    .map((m) => ({ k: add('m:' + m.key, { open: m.open, play: () => playList(m.ids, 0) }), title: m.title, sub: m.sub, cover: m.cover, glyph: m.glyph }));

  // descubrí (lo que ya está calculado; si no, se busca en segundo plano)
  const disc = cachedDiscover();
  const discItems = (disc ? disc.items : []).slice(0, 10).map((it) => ({ k: add('d:' + it.videoId, { play: () => playList(disc.items.map((x) => 'yt_' + x.videoId).filter(T), disc.items.indexOf(it)) }), title: it.title, sub: it.why || (it.artists || []).join(', '), cover: 'yt_' + it.videoId, warm: it.videoId }));
  if (!disc) recsOnline().then(() => { if (!$('#homeBody').closest('.ws').hidden) renderHome(); }).catch(() => {});

  // playlists
  const pls = [...D.playlists].sort((a, b) => (b.id === 'liked') - (a.id === 'liked')).filter((p) => p.tracks.length).slice(0, 12)
    .map((p) => ({ k: add('p:' + p.id, { open: () => go({ type: 'pl', key: p.id }), play: () => playList(p.tracks, 0) }), title: p.name, sub: p.tracks.length + ' canciones', cover: firstCover(p.tracks), glyph: p.id === 'liked' ? '♥' : '♫' }));

  // recién agregadas
  const added = [...D.tracks].filter((t) => !t.video).sort((a, b) => b.added - a.added).slice(0, 10)
    .map((t) => ({ k: add('a:' + t.id, { play: () => playList([...D.tracks].sort((a, b) => b.added - a.added).map((x) => x.id), [...D.tracks].sort((a, b) => b.added - a.added).findIndex((x) => x.id === t.id)) }), title: t.title, sub: t.artist, cover: t.id }));

  // explorar: lo más escuchado del país (sirve aunque no tengas nada)
  let exItems = [];
  try {
    const ex = await import('./explore.js'); const d = await ex.loadExplore();
    exItems = (d.trending || []).map((t) => ({ k: add('x:' + t.playlistId, { open: () => { bus.emit('ws', 'music'); go({ type: 'ytm', key: t.playlistId }); }, play: async () => { const { loadYtmList } = await import('./data.js'); const l = await loadYtmList(t.playlistId); if (l && l.ids.length) playList(l.ids, 0); } }), title: t.title, sub: 'lo más escuchado', glyph: '★' }));
  } catch {}
  // las secciones que más tocás suben solas (sin historial, lo más útil para empezar va primero)
  const use = P.get('homeUse') || {};
  const fresh = !D.tracks.length && !recent.length;
  const base = fresh ? ['explore', 'mixes', 'disc', 'recent', 'pls', 'added'] : ['recent', 'mixes', 'disc', 'explore', 'pls', 'added'];
  const sections = [
    { key: 'recent', html: row('Seguir escuchando', recent, '', 'recent') },
    { key: 'mixes', html: row('Tus mixes', mixes, '', 'mixes') },
    { key: 'disc', html: row('Descubrí · canciones nuevas', discItems, 'disc', 'disc') },
    { key: 'explore', html: row('Lo más escuchado', exItems, 'explore', 'explore') },
    { key: 'pls', html: row('Tus playlists', pls, '', 'pls') },
    { key: 'added', html: row('Recién agregadas', added, 'recent', 'added') },
  ].sort((a, b) => (use[b.key] || 0) - (use[a.key] || 0) || base.indexOf(a.key) - base.indexOf(b.key));
  const p = profile();
  const empty = !D.tracks.length && !recent.length;
  // el look que le queda a lo que escuchás (si cambió tu estilo)
  const lk = pendingLook();
  const lkG = lk && GALLERY.find((g) => g.id === lk.wp);
  const lookCard = lk ? `<div class="hlook">${lkG ? `<i style="background-image:url(&quot;${sceneUrl(lkG)}&quot;)"></i>` : ''}<div><b>Últimamente escuchás mucho ${esc(lk.name)} ✺</b>
      <span>¿Probás el look "${esc(lk.look)}"? Cambia el tema y el fondo; lo deshacés con un toque.</span>
      <div class="acts"><button class="go" data-adapt="yes">probar</button><button class="cb" data-adapt="no">no, gracias</button></div></div></div>` : '';
  // tus accesos: lo que más abrís
  const nav = topNav(6);
  navUse = nav;
  const navRow = nav.length ? `<div class="hnav"><span class="m">lo que más abrís</span>${nav.map((x, i) => `<button class="cb sm" data-nav="${i}">${esc(x.name)}</button>`).join('')}</div>` : '';
  box.innerHTML = `
    <div class="hhero"><h2>${greet()} <span class="petal">❀</span></h2>
      <button class="go rc-home" data-recog>❀ ¿qué suena? <span>reconocé una canción con el micrófono</span></button>
      <div class="hquick"><button class="cb sm" data-goto="gsearch">${icon('search')} buscar</button><button class="cb sm" data-more="pl:liked">${icon('heart')} me gusta</button><button class="cb sm" data-goto="stats">${icon('stats')} estadísticas</button><button class="cb sm" data-more="hist">${icon('hist')} historial</button><button class="cb sm" data-year>❀ tu ${new Date().getFullYear()}</button></div>
      ${navRow}
      <div class="m">${p.topArtists.length ? 'hoy te puede gustar algo de ' + esc(p.topArtists.slice(0, 2).map((a) => a.name).join(' o ')) : 'escuchá, tocá ♥ y saltá lo que no te guste: Petalwave aprende tus gustos'}</div></div>
    ${empty ? `<div class="hempty"><div class="big">❀</div><h3>Tu música va a aparecer acá</h3><div class="m">Pegá un link de YouTube en <b>descargas</b>, agregá una carpeta con música en <b>ajustes</b> o buscá algo para escuchar online.</div>
      <div class="acts"><button class="go" data-goto="dl">${icon('dl')} descargar música</button><button class="cb" data-goto="search">${icon('search')} buscar</button></div></div>` : ''}
    ${lookCard}
    ${sections.map((x) => x.html).join('')}`;
}

export function initHome() {
  const box = $('#homeBody'); if (!box) return;
  box.addEventListener('click', (e) => {
    const goto = e.target.closest('[data-goto]');
    if (goto) { const g = goto.dataset.goto; return g === 'search' || g === 'gsearch' ? bus.emit('gsearch') : bus.emit('ws', g); }
    if (e.target.closest('[data-recog]')) return bus.emit('recognize');
    if (e.target.closest('[data-year]')) return import('./wrapped.js').then((m) => m.showYear());
    const ad = e.target.closest('[data-adapt]');
    if (ad) { const l = pendingLook(); if (ad.dataset.adapt === 'yes' && l) applyLook(l); else dismissLook(); return; }
    const nv = e.target.closest('[data-nav]');
    if (nv) { const x = navUse[+nv.dataset.nav]; if (x) { bus.emit('ws', 'music'); go(x.v); } return; }
    // contar qué secciones usás (para ordenarlas)
    const sec = e.target.closest('[data-sec]');
    if (sec && sec.dataset.sec) { const u = { ...(P.get('homeUse') || {}) }; u[sec.dataset.sec] = (u[sec.dataset.sec] || 0) * 0.95 + 1; P.set('homeUse', u); }
    const more = e.target.closest('[data-more]');
    if (more && more.dataset.more === 'explore') return bus.emit('ws', 'explore');
    if (more) { bus.emit('ws', 'music'); const [type, key] = more.dataset.more.split(':'); return go(key ? { type, key } : { type }); }
    const pb = e.target.closest('[data-play]');
    const c = e.target.closest('[data-k]');
    if (!c) return;
    const a = actions.get(c.dataset.k); if (!a) return;
    if (pb || !a.open) return a.play();
    bus.emit('ws', 'music'); a.open();
  });
  bus.on('pl:loaded', () => { if (!box.closest('.ws').hidden) renderHome(); });
  bus.on('adapt', () => { if (!box.closest('.ws').hidden) renderHome(); });
}
