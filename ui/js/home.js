// pantalla de Inicio: lo que más usás, a un toque (seguir escuchando, mixes, descubrí, playlists, recién agregadas)
import { $, bus, esc, icon, coverUrl } from './core.js';
import { D, T } from './data.js';
import { playList, S as PS } from './player.js';
import { go } from './library.js';
import { recsLocal, recsOnline, cachedDiscover, recsMood, recsTime, MOODS, SLOTS, slotNow, profile } from './taste.js';

const greet = () => { const h = new Date().getHours(); return h < 6 ? 'Buenas noches' : h < 13 ? 'Buen día' : h < 20 ? 'Buenas tardes' : 'Buenas noches'; };
const cover = (id) => (id ? `<img loading="lazy" src="${coverUrl(id, 'm')}" onerror="this.classList.add('x')">` : '');
const card = (o) => `<div class="card hcard" data-k="${esc(o.k)}">
  <div class="cimg">${o.glyph || '❀'}${cover(o.cover)}<button class="cplay" data-play="${esc(o.k)}" title="reproducir">${icon('play')}</button></div>
  <div class="cn">${esc(o.title)}</div><div class="cs">${esc(o.sub || '')}</div></div>`;
const row = (title, items, more) => items.length ? `<section class="hsec"><div class="hsec-h"><h3>${title}</h3>${more ? `<button class="cb sm" data-more="${more}">ver todo</button>` : ''}</div><div class="home-row">${items.map(card).join('')}</div></section>` : '';

let actions = new Map();   // clave de tarjeta → { open, play }

export async function renderHome() {
  const box = $('#homeBody'); if (!box) return;
  actions = new Map();
  const add = (k, o) => { actions.set(k, o); return k; };
  const firstCover = (ids) => (ids.map(T).find((t) => t && (t.hasCover || t.remote)) || {}).id;

  // seguir escuchando: lo último que sonó
  const recent = [...new Set(PS.history || [])].map(T).filter(Boolean).slice(0, 10)
    .map((t) => ({ k: add('h:' + t.id, { play: () => playList([t.id, ...recsLocal(20).map((r) => r.id).filter((x) => x !== t.id)], 0) }), title: t.title, sub: t.artist, cover: t.id }));

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
  const discItems = (disc ? disc.items : []).slice(0, 10).map((it) => ({ k: add('d:' + it.videoId, { play: () => playList(disc.items.map((x) => 'yt_' + x.videoId).filter(T), disc.items.indexOf(it)) }), title: it.title, sub: it.why || (it.artists || []).join(', '), cover: 'yt_' + it.videoId }));
  if (!disc) recsOnline().then(() => { if (!$('#homeBody').closest('.ws').hidden) renderHome(); }).catch(() => {});

  // playlists
  const pls = [...D.playlists].sort((a, b) => (b.id === 'liked') - (a.id === 'liked')).filter((p) => p.tracks.length).slice(0, 12)
    .map((p) => ({ k: add('p:' + p.id, { open: () => go({ type: 'pl', key: p.id }), play: () => playList(p.tracks, 0) }), title: p.name, sub: p.tracks.length + ' canciones', cover: firstCover(p.tracks), glyph: p.id === 'liked' ? '♥' : '♫' }));

  // recién agregadas
  const added = [...D.tracks].filter((t) => !t.video).sort((a, b) => b.added - a.added).slice(0, 10)
    .map((t) => ({ k: add('a:' + t.id, { play: () => playList([...D.tracks].sort((a, b) => b.added - a.added).map((x) => x.id), [...D.tracks].sort((a, b) => b.added - a.added).findIndex((x) => x.id === t.id)) }), title: t.title, sub: t.artist, cover: t.id }));

  const p = profile();
  const empty = !D.tracks.length && !recent.length;
  box.innerHTML = `
    <div class="hhero"><h2>${greet()} <span class="petal">❀</span></h2>
      <div class="hquick"><button class="cb sm" data-goto="gsearch">${icon('search')} buscar</button><button class="cb sm" data-more="pl:liked">${icon('heart')} me gusta</button><button class="cb sm" data-goto="stats">${icon('stats')} estadísticas</button><button class="cb sm" data-year>❀ tu ${new Date().getFullYear()}</button></div>
      <div class="m">${p.topArtists.length ? 'hoy te puede gustar algo de ' + esc(p.topArtists.slice(0, 2).map((a) => a.name).join(' o ')) : 'escuchá, tocá ♥ y saltá lo que no te guste: Petalwave aprende tus gustos'}</div></div>
    ${empty ? `<div class="hempty"><div class="big">❀</div><h3>Tu música va a aparecer acá</h3><div class="m">Pegá un link de YouTube en <b>descargas</b>, agregá una carpeta con música en <b>ajustes</b> o buscá algo para escuchar online.</div>
      <div class="acts"><button class="go" data-goto="dl">${icon('dl')} descargar música</button><button class="cb" data-goto="search">${icon('search')} buscar</button></div></div>` : ''}
    ${row('Seguir escuchando', recent)}
    ${row('Tus mixes', mixes)}
    ${row('Descubrí · canciones nuevas', discItems, 'disc')}
    ${row('Tus playlists', pls)}
    ${row('Recién agregadas', added, 'recent')}`;
}

export function initHome() {
  const box = $('#homeBody'); if (!box) return;
  box.addEventListener('click', (e) => {
    const goto = e.target.closest('[data-goto]');
    if (goto) { const g = goto.dataset.goto; return g === 'search' || g === 'gsearch' ? bus.emit('gsearch') : bus.emit('ws', g); }
    if (e.target.closest('[data-year]')) return import('./wrapped.js').then((m) => m.showYear());
    const more = e.target.closest('[data-more]');
    if (more) { bus.emit('ws', 'music'); const [type, key] = more.dataset.more.split(':'); return go(key ? { type, key } : { type }); }
    const pb = e.target.closest('[data-play]');
    const c = e.target.closest('[data-k]');
    if (!c) return;
    const a = actions.get(c.dataset.k); if (!a) return;
    if (pb || !a.open) return a.play();
    bus.emit('ws', 'music'); a.open();
  });
  bus.on('pl:loaded', () => { if (!box.closest('.ws').hidden) renderHome(); });
}
