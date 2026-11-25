// ❀ Explorar: música para empezar aunque no tengas nada (sin cuenta): lo más escuchado en tu país, artistas populares,
// géneros y estados de ánimo. Todo se ordena según tus gustos: lo que más te gusta aparece primero.
import { $, api, bus, esc, icon, toast, P, local, norm } from './core.js';
import { D, T, ytm, loadYtmList, remoteTrack } from './data.js';
import { playList } from './player.js';
import { go } from './library.js';
import { profile, score } from './taste.js';

const COUNTRIES = { AR: 'Argentina', MX: 'México', ES: 'España', CL: 'Chile', CO: 'Colombia', PE: 'Perú', UY: 'Uruguay', US: 'Estados Unidos', BR: 'Brasil', ZZ: 'el mundo' };
export const country = () => {
  const c = P.get('country');
  if (c && COUNTRIES[c]) return c;
  const g = (navigator.language || '').split('-')[1];
  return g && COUNTRIES[g.toUpperCase()] ? g.toUpperCase() : 'AR';
};

let data = null, loading = false, picks = null, moodOpen = null;

export async function loadExplore(force) {
  const c = country();
  if (data && data.country === c && !force) return data;
  const key = 'pw-explore-' + c;
  const cached = local.get(key, null);
  if (cached && !force && Date.now() - cached.at < 6 * 3600e3) { data = cached; return data; }
  loading = true;
  try { data = { ...(await api.get('/api/ytm/explore?country=' + c)), at: Date.now() }; local.set(key, data); }
  catch (e) { data = { error: e.message, trending: [], artists: [], cats: {} }; }
  finally { loading = false; }
  return data;
}

// estilos de Petalwave → categorías de YouTube Music que les corresponden (YouTube no tiene "phonk" ni "trap")
const RELATED = {
  trap: ['urbano', 'hip-hop', 'hiphop en espanol'], phonk: ['energia', 'ejercicio', 'hip-hop', 'gaming'], rkt: ['urbano', 'fiesta', 'cumbia'],
  reggaeton: ['urbano', 'fiesta', 'pop latino'], rap: ['hip-hop', 'hiphop en espanol'], hip: ['hip-hop', 'hiphop en espanol'],
  slowed: ['calma', 'triste'], reverb: ['calma', 'triste'], lofi: ['calma', 'concentracion', 'dormir'], chill: ['calma', 'sentirse bien'],
  edm: ['dance y electronica', 'fiesta'], house: ['dance y electronica', 'fiesta'], techno: ['dance y electronica'], hardtekk: ['dance y electronica', 'energia'],
  rock: ['rock', 'rock argentino', 'rock en espanol'], metal: ['metal'], indie: ['indie y alternativa'], pop: ['pop', 'pop latino'],
  kpop: ['k-pop'], anime: ['pop japones', 'musicales y bandas sonoras'], opening: ['pop japones'], ost: ['musicales y bandas sonoras'],
  baladas: ['romance'], romantica: ['romance'], clasica: ['clasica'], orchestral: ['clasica', 'musicales y bandas sonoras'], piano: ['clasica', 'calma'],
  jazz: ['jazz'], cumbia: ['cumbia', 'tropical'], cuarteto: ['tropical', 'fiesta'], salsa: ['tropical'], bachata: ['bachata', 'tropical'],
  corrido: ['musica mexicana'], folklore: ['folk y tradicional'], tango: ['folk y tradicional'], sad: ['triste'], workout: ['ejercicio', 'energia'], gym: ['ejercicio'],
};
// cuánto te gusta algo por su nombre (género, estado de ánimo, artista), según tu perfil
function affinity(name) {
  const p = profile(), n = norm(name);
  let s = 0;
  for (const [k, v] of p.A) {
    if (v <= 0) continue;
    const w = k.slice(2);
    if (w.length > 2 && (n.includes(w) || w.includes(n))) s = Math.max(s, v);
    for (const part of w.split(/[\s+/]+/)) if ((RELATED[part] || []).includes(n)) s = Math.max(s, v * 0.85);
  }
  return s;
}

// "para vos, de lo más escuchado": las canciones del ranking que más van con tus gustos
async function popularForYou() {
  const top = (data.trending || [])[0];
  if (!top) return [];
  const l = await loadYtmList(top.playlistId);
  if (!l) return [];
  const p = profile();
  const ids = l.ids.filter((id) => T(id));
  if (p.positives < 3) return ids.slice(0, 20);   // todavía no te conozco: el ranking tal cual
  return ids.map((id, i) => ({ id, s: score(T(id), p).s - i * 0.01 })).sort((a, b) => b.s - a.s).slice(0, 20).map((x) => x.id);
}

const card = (k, img, title, sub, round) => `<div class="card ${round ? 'round' : ''}" data-x="${esc(k)}"><div class="cimg">❀${img ? `<img loading="lazy" src="${esc(img)}" referrerpolicy="no-referrer" onerror="this.classList.add('x')">` : ''}<button class="cplay" data-xp="${esc(k)}">${icon('play')}</button></div><div class="cn">${esc(title)}</div><div class="cs">${esc(sub || '')}</div></div>`;
const songRow = (id, i) => { const t = T(id); return t ? `<div class="xrow" data-xs="${i}"><span class="ix">${i + 1}</span><img src="/ytcover/${esc(t.ytId || '')}?s=t" onerror="this.style.visibility='hidden'"><div><b>${esc(t.title)}</b><span>${esc(t.artist || '')}</span></div></div>` : ''; };

export async function renderExplore() {
  const box = $('#exploreBody'); if (!box) return;
  if (!data) box.innerHTML = `<div class="empty">buscando lo más escuchado…</div>`;
  await loadExplore();
  const c = country();
  if (data.error) { box.innerHTML = `<div class="empty">No se pudo cargar Explorar: ${esc(data.error)}<br><br><button class="cb" data-xr>probar de nuevo</button></div>`; box.querySelector('[data-xr]').onclick = () => { loadExplore(true).then(renderExplore); }; return; }
  const p = profile();
  const newbie = p.positives < 3;
  picks = await popularForYou();
  // artistas y categorías: primero lo que va con tus gustos
  const artists = [...data.artists].sort((a, b) => affinity(b.title) - affinity(a.title) || a.rank - b.rank).slice(0, 16);
  const groups = Object.entries(data.cats || {}).map(([name, items]) => [name, [...items].sort((a, b) => affinity(b.title) - affinity(a.title))]);
  box.innerHTML = `
    <div class="xhead"><div><h2>Explorar</h2><div class="m">música para escuchar ya, sin cuenta${newbie ? ' · se va ordenando según lo que te gusta' : ' · ordenado según tus gustos'}</div></div>
      <select id="xCountry">${Object.entries(COUNTRIES).map(([k, v]) => `<option value="${k}" ${k === c ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></div>
    ${newbie ? `<button class="go rc-home" data-xtaste>❀ Contame qué te gusta <span>elegí géneros y artistas y te recomiendo desde ya</span></button>` : ''}
    ${picks.length ? `<section class="hsec"><div class="hsec-h"><h3>${newbie ? 'Lo más escuchado en ' + esc(COUNTRIES[data.country] || 'el mundo') : 'Para vos, de lo más escuchado'}</h3><button class="cb sm" data-xplayall>${icon('play')} reproducir</button></div>
      <div class="xlist">${picks.slice(0, 10).map(songRow).join('')}</div></section>` : ''}
    <section class="hsec"><div class="hsec-h"><h3>Rankings</h3></div><div class="home-row">${data.trending.map((t) => card('pl:' + t.playlistId, t.thumb, t.title, 'YouTube Music')).join('')}</div></section>
    <section class="hsec"><div class="hsec-h"><h3>Artistas populares</h3></div><div class="home-row">${artists.map((a) => card('ar:' + a.title, a.thumb, a.title, (affinity(a.title) > 0.2 ? '♥ te gusta · ' : '#' + a.rank + ' · ') + (a.subs || ''), true)).join('')}</div></section>
    ${groups.map(([name, items]) => `<section class="hsec"><div class="hsec-h"><h3>${esc(name)}</h3></div><div class="xchips">${items.map((m) => `<button class="xchip ${affinity(m.title) > 0.2 ? 'fav' : ''}" data-xm="${esc(m.params)}" data-xt="${esc(m.title)}">${esc(m.title)}</button>`).join('')}</div></section>`).join('')}
    <div id="xMood"></div>
    <div class="m" style="margin:18px 6px">¿Tenés cuenta de YouTube Music? <a href="#" data-xytm>mirá tus me gusta y playlists</a></div>`;
  if (moodOpen) openMood(moodOpen.params, moodOpen.title, true);
}

async function openMood(params, title, keep) {
  moodOpen = { params, title };
  const el = $('#xMood'); if (!el) return;
  el.innerHTML = `<section class="hsec"><div class="hsec-h"><h3>${esc(title)}</h3></div><div class="empty">buscando playlists…</div></section>`;
  if (!keep) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  try {
    const r = await api.get(`/api/ytm/mood?country=${country()}&params=${encodeURIComponent(params)}`);
    el.innerHTML = `<section class="hsec"><div class="hsec-h"><h3>${esc(title)}</h3><button class="cb sm" data-xclose>✕</button></div><div class="home-row">${(r.playlists || []).map((p) => card('pl:' + p.playlistId, p.thumb, p.title, p.sub)).join('') || '<div class="m">no hay playlists</div>'}</div></section>`;
  } catch (e) { el.innerHTML = `<div class="m">${esc(e.message)}</div>`; }
}

async function playArtist(name) {
  try {
    const r = await api.get('/api/ytm/search?filter=songs&q=' + encodeURIComponent(name));
    const ids = (r.items || []).filter((x) => x.videoId && !x.isVideo).map((x) => (T('yt_' + x.videoId) || remoteTrack(x)).id);
    if (!ids.length) return toast('No encontré canciones de ' + name, { kind: 'warn' });
    playList(ids, 0);
  } catch (e) { toast(e.message, { kind: 'err' }); }
}

export function initExplore() {
  const box = $('#exploreBody'); if (!box) return;
  box.addEventListener('click', async (e) => {
    const t = e.target;
    if (t.closest('[data-xtaste]')) return import('./welcome.js').then((m) => m.askTaste().then(() => renderExplore()));
    if (t.closest('[data-xytm]')) { e.preventDefault(); return bus.emit('ws', 'sync'); }
    if (t.closest('[data-xclose]')) { moodOpen = null; $('#xMood').innerHTML = ''; return; }
    if (t.closest('[data-xplayall]')) return playList(picks, 0);
    const s = t.closest('[data-xs]'); if (s) return playList(picks, +s.dataset.xs);
    const m = t.closest('[data-xm]'); if (m) return openMood(m.dataset.xm, m.dataset.xt);
    const c = t.closest('[data-x]'); if (!c) return;
    const k = c.dataset.x, play = !!t.closest('[data-xp]');
    if (k.startsWith('ar:')) return playArtist(k.slice(3));
    if (k.startsWith('pl:')) {
      const pid = k.slice(3);
      if (play) { const l = await loadYtmList(pid); if (l && l.ids.length) playList(l.ids, 0); return; }
      bus.emit('ws', 'music'); go({ type: 'ytm', key: pid });
    }
  });
  box.addEventListener('change', (e) => { if (e.target.id === 'xCountry') { P.set('country', e.target.value); data = null; renderExplore(); } });
  bus.on('taste', () => { /* los gustos cambian el orden la próxima vez que abras Explorar */ });
}
