// workspace de descargas (terminal estilo nvim): cola real, progreso, historial, cookies, carpeta de destino
import { $, $$, bus, P, api, esc, toast, host, ago, icon } from './core.js';
import { D } from './data.js';
import { playList } from './player.js';
import { spotifyLinksToDownloads } from './spotui.js';

const Q = { mp3: ['320', '256', '192', '128'], m4a: ['best'], opus: ['best'], mp4: ['2160', '1440', '1080', '720', '480', '360'] };
const QL = (f, q) => (f === 'mp4' ? q + 'p' : q === 'best' ? 'la mejor disponible' : q + ' kbps');
const jobs = new Map();
let hist = [];
let hasCookies = false, cookieExpired = false;
const shown = new Set();
const hints = new Map();   // id de descarga → último aviso (bot / cookies vencidas)

// ---------- log + numeración de líneas ----------
export function log(txt, cls = '') {
  const el = $('#log');
  el.insertAdjacentHTML('beforeend', `<div class="${cls}">${esc(txt)}</div>`);
  while (el.children.length > 400) el.firstChild.remove();
  const buf = $('#buf');
  if (buf.scrollHeight - buf.scrollTop - buf.clientHeight < 200) buf.scrollTop = buf.scrollHeight;
  gutter();
}
function gutter() {
  const buf = $('#buf');
  const lines = Math.max(30, Math.ceil(buf.scrollHeight / 19));
  if ($('#gut').dataset.n !== String(lines)) { $('#gut').dataset.n = lines; $('#gut').textContent = Array.from({ length: lines }, (_, i) => i + 1).join('\n'); }
  $('#gut').scrollTop = buf.scrollTop;
}

// ---------- detectar YouTube / YouTube Music ----------
export function analyzeUrl(raw) {
  let u; try { u = new URL(raw.trim()); } catch { return null; }
  const h = u.hostname.replace(/^www\.|^m\./, ''), list = u.searchParams.get('list') || '';
  const music = h === 'music.youtube.com', yt = music || /(^|\.)youtube\.com$|^youtu\.be$/.test(h);
  if (!yt) return { kind: 'other' };
  const isMix = /^RD/.test(list), isAlbum = /^OLAK5uy_/.test(list) || u.pathname.startsWith('/browse/MPREb');
  return { kind: music ? 'ytm' : 'yt', music, isMix, isAlbum, isList: !isMix && (u.pathname === '/playlist' || isAlbum || (!!list && !u.searchParams.get('v'))), hasVideo: !!u.searchParams.get('v') || h === 'youtu.be' };
}
let lastUrl = '';
function onUrlInput() {
  const ta = $('#dlUrl');
  ta.style.height = 'auto'; ta.style.height = Math.min(140, ta.scrollHeight) + 'px';
  const urls = ta.value.split(/\s+/).filter(Boolean);
  const src = $('#dlSrc'); src.className = 'src'; src.textContent = '';
  if (!urls.length) return;
  if (urls.length > 1) { src.className = 'src yt'; src.textContent = `${urls.length} links`; return; }
  if (/open\.spotify\.com\//i.test(urls[0])) { src.className = 'src sp'; src.textContent = '● Spotify → se baja desde YouTube Music'; return; }
  const a = analyzeUrl(urls[0]);
  if (!a || a.kind === 'other') return;
  src.className = 'src ' + a.kind;
  src.textContent = a.music ? (a.isAlbum ? '♫ YT Music · álbum' : a.isList ? '♫ YT Music · playlist' : '♫ YouTube Music') : a.isList ? '▶ YouTube · playlist' : '▶ YouTube';
  if (urls[0] === lastUrl) return;
  lastUrl = urls[0];
  if (a.music && $('#dlFmt').value === 'mp4') { $('#dlFmt').value = 'mp3'; onFmt(); toast('YouTube Music → audio ♫', { ms: 1400 }); }
  if (a.isList && !$('#dlPl').checked) { $('#dlPl').checked = true; toast(a.isAlbum ? 'álbum detectado: se baja completo' : 'playlist detectada: se baja completa', { ms: 1800 }); }
  if (a.isMix && $('#dlPl').checked && a.hasVideo) { $('#dlPl').checked = false; toast('es un mix infinito: bajo solo esta canción', { ms: 1800 }); }
  savePrefs();
}
function onFmt() {
  const f = $('#dlFmt').value, saved = P.get('dl').quality;
  $('#dlQ').innerHTML = Q[f].map((q) => `<option value="${q}">${QL(f, q)}</option>`).join('');
  $('#dlQ').value = Q[f].includes(saved) ? saved : Q[f][0];
  $('#dlQ').hidden = Q[f].length < 2;
  savePrefs();
}
function savePrefs() {
  const d = P.get('dl');
  Object.assign(d, { format: $('#dlFmt').value, quality: $('#dlQ').value, cookies: $('#dlCk').value, playlist: $('#dlPl').checked });
  P.save();
  $('#slInfo').textContent = `${d.format} · ${QL(d.format, d.quality)}${d.cookies ? ' · 🍪 ' + d.cookies : ''}`;
  $('#dlInfo').textContent = {
    mp3: 'mp3: compatible con todo. Se recodifica desde el audio original de YouTube.',
    m4a: 'm4a (AAC): YouTube ya lo tiene así, por eso se guarda sin recodificar y sin perder calidad.',
    opus: 'opus: la mejor calidad que ofrece YouTube (~160 kbps opus ≈ 256 kbps mp3), sin recodificar.',
    mp4: 'mp4: video H.264 + audio AAC, hasta la resolución elegida.',
  }[d.format];
}

async function submit(e) {
  e && e.preventDefault();
  const urls = $('#dlUrl').value.split(/\s+/).map((s) => s.trim()).filter((s) => /^https?:\/\//i.test(s));
  if (!urls.length) return toast('pegá al menos una URL válida', { kind: 'warn' });
  const a = analyzeUrl(urls[0]);
  if (a && a.isMix && $('#dlPl').checked && !a.hasVideo) return log('Los mix/radio de YouTube son infinitos: abrí una canción del mix y pegá esa URL.', 'wa');
  const fmt = $('#dlFmt').value === 'mp4' ? 'mp4' : $('#dlFmt').value;
  const b = { urls, format: fmt, quality: $('#dlQ').value, playlist: $('#dlPl').checked, cookies: $('#dlCk').value };
  log(`❯ petal --${b.format} ${b.quality}${b.playlist ? ' --playlist' : ''}${b.cookies ? ' --cookies ' + b.cookies : ''} ${urls.length > 1 ? `(${urls.length} links)` : urls[0]}`, 'pk');
  // links de Spotify: se leen las canciones y se bajan desde YouTube Music (el audio de Spotify tiene DRM)
  const spot = urls.filter((x) => /open\.spotify\.com\//i.test(x)), rest = urls.filter((x) => !/open\.spotify\.com\//i.test(x));
  $('#dlUrl').value = ''; onUrlInput(); lastUrl = '';
  if (spot.length) {
    const n = await spotifyLinksToDownloads(spot, { format: fmt === 'mp4' ? 'mp3' : fmt, quality: fmt === 'mp4' ? '320' : b.quality, cookies: b.cookies }, log);
    if (n) toast(`${n} canciones de Spotify en cola ⇣`, { sub: 'buscadas y bajadas desde YouTube Music' });
  }
  if (!rest.length) return;
  try {
    const r = await api.post('/api/downloads', { ...b, urls: rest });
    toast(r.ids.length > 1 ? `${r.ids.length} descargas en cola` : 'descarga en cola ⇣', { ms: 1500 });
  } catch (err) { log('error: ' + err.message, 'er'); toast(err.message, { kind: 'err' }); }
}

// ---------- cola en vivo ----------
const ACTIVE = new Set(['en cola', 'iniciando', 'descargando', 'procesando']);
function renderJobs() {
  const list = [...jobs.values()].filter((j) => ACTIVE.has(j.status)).sort((a, b) => a.created - b.created);
  const running = list.filter((j) => j.status !== 'en cola').length;
  $('#qInfo').textContent = list.length ? `${running} descargando · ${list.length - running} esperando` : '';
  const badge = $('#dlBadge'); badge.hidden = !list.length; badge.textContent = list.length;
  const box = $('#jobs');
  if (!list.length) { box.innerHTML = '<div class="cm">&gt; vacía — pegá un link arriba</div>'; $('#slPct').textContent = '0%'; return; }
  box.innerHTML = list.map((j) => {
    const q = j.status === 'en cola';
    const right = q ? 'en cola…' : j.status === 'procesando' ? 'procesando con ffmpeg…' : j.status === 'iniciando' ? 'conectando…' :
      [`${(j.percent || 0).toFixed(1)}%`, j.downloaded && j.size ? `${j.downloaded} / ${j.size}` : j.size, j.speed, j.eta ? 'eta ' + j.eta : ''].filter(Boolean).join(' · ');
    const item = j.items ? `[${j.item}/${j.items}] ` : '';
    return `<div class="job ${q ? 'queued' : ''}"><div class="nm"><span class="cm">[${j.id.slice(-4)}]</span><span class="t">${esc(j.sync ? j.title + (j.current ? ' · ' + j.current : '') : j.playlist && j.current ? j.title.replace(/^playlist · .*/, 'playlist') + ' · ' + j.current : j.title)}</span>
      <button class="cb sm danger" data-cancel="${j.id}" title="cancelar">${icon('x')}</button></div>
      <div class="pr"><div class="bar"><i style="width:${j.status === 'procesando' ? 100 : j.percent || 0}%"></i></div><span>${esc(item + right)}</span></div>
      <div class="meta">${esc([j.format + ' ' + QL(j.format, j.quality), j.fmtInfo].filter(Boolean).join(' · '))}</div></div>`;
  }).join('');
  const prog = list.find((j) => j.status === 'descargando');
  $('#slPct').textContent = prog ? Math.round(prog.percent || 0) + '%' : '…';
}
function renderHist() {
  const box = $('#hist');
  if (!hist.length) { box.innerHTML = '<div class="cm">&gt; sin descargas todavía</div>'; return; }
  box.innerHTML = hist.slice(0, 120).map((h) => {
    const cls = h.status === 'completado' ? 'ok' : h.status === 'cancelado' ? 'can' : 'err';
    const sym = cls === 'ok' ? '✔' : cls === 'can' ? '■' : '✖';
    const info = [h.format, h.files && h.files.length > 1 ? h.files.length + ' archivos' : '', h.size, ago(h.ended)].filter(Boolean).join(' · ');
    return `<div class="hrow ${cls}" title="${esc(h.error || h.url)}"><span class="dot">${sym}</span><div style="min-width:0"><div class="t">${esc(h.title)}</div><div class="s">${esc(h.status !== 'completado' && h.error ? h.error : info)}</div></div>
      ${h.status === 'completado' && h.files && h.files.length ? `<button class="cb sm" data-hplay="${h.id}" title="reproducir">${icon('play')}</button>` : `<button class="cb sm" data-retry="${h.id}" title="reintentar">↻</button>`}
      <button class="cb sm" data-hdel="${h.id}" title="quitar del historial">${icon('x')}</button></div>`;
  }).join('');
}
async function loadAll() {
  const j = await api.get('/api/downloads');
  for (const a of j.active) jobs.set(a.id, a);
  hist = j.history;
  renderJobs(); renderHist();
}

// ---------- cookies ----------
export function cookieHelp(why) {
  for (const l of ['┌─ ' + why, '│  Para que no se venzan, exportalas así:', '│  1. Brave → extensiones → "Get cookies.txt LOCALLY" → Detalles → "Permitir en modo privado".',
    '│  2. Ventana privada (Ctrl+Shift+N) → iniciá sesión en youtube.com.', '│  3. En esa pestaña andá a youtube.com/robots.txt', '│  4. Extensión → Export, y cerrá la ventana privada sin usarla más.', '└─ 5. Arrastrá el .txt a petalwave y reintentá.']) log(l, 'wa');
}
export function setCookies(has, expired) {
  hasCookies = has; cookieExpired = !!expired;
  $('#ckTxtOpt').textContent = 'cookies: archivo .txt ' + (has ? (expired ? '⚠ vencido' : '✓') : '(falta)');
  $('#bCk').classList.toggle('on', has && !expired);
  $('#bCk').textContent = has ? (expired ? '🍪 cookies vencidas ⚠ cargar nuevas' : '🍪 cookies.txt ✓') : '🍪 cargar cookies.txt';
  if (!has && $('#dlCk').value === 'txt') { $('#dlCk').value = ''; savePrefs(); }
  bus.emit('cookies', { has, expired });
}
export async function uploadCookies(file) {
  try {
    const j = await api.raw('/api/cookies', file, { 'Content-Type': 'text/plain' });
    setCookies(true, false);
    log(`🍪 cookies.txt cargado (${j.count} cookies).`, 'ok');
    toast('cookies.txt cargado ❀');
  } catch (e) { log('cookies: ' + e.message, 'er'); toast('cookies.txt no válido', { kind: 'err', sub: e.message }); }
}

export function initDownloads() {
  $('#dlForm').onsubmit = submit;
  $('#dlUrl').addEventListener('input', onUrlInput);
  $('#dlUrl').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } });
  $('#dlUrl').addEventListener('focus', () => { $('#mode').textContent = 'INSERT'; $('#mode').classList.add('ins'); });
  $('#dlUrl').addEventListener('blur', () => { $('#mode').textContent = 'NORMAL'; $('#mode').classList.remove('ins'); });
  $('#buf').addEventListener('scroll', () => ($('#gut').scrollTop = $('#buf').scrollTop));
  const d = P.get('dl');
  // 2.2: las cookies dejan de ser obligatorias (antes se elegían solas al cargar cookies.txt)
  if (!P.get('dlV2')) { if (d.cookies === 'txt') d.cookies = ''; P.all().dlV2 = true; P.save(); }
  $('#dlFmt').value = Q[d.format] ? d.format : 'mp3';
  $('#dlCk').value = d.cookies || '';
  $('#dlPl').checked = !!d.playlist;
  onFmt();
  $('#dlFmt').onchange = onFmt;
  for (const id of ['#dlQ', '#dlCk', '#dlPl']) $(id).onchange = savePrefs;
  $('#bCk').onclick = (e) => {
    if (e.shiftKey && hasCookies) return api.del('/api/cookies').then(() => { setCookies(false); toast('cookies.txt borrado'); });
    const f = $('#filePick'); f.accept = '.txt,text/plain'; f.onchange = () => { if (f.files[0]) uploadCookies(f.files[0]); f.value = ''; }; f.click();
  };
  $('#bDest').onclick = async () => {
    const p = await host.pickFolder('Carpeta donde guardar las descargas');
    if (!p) return;
    try { const s = await api.post('/api/settings', { downloadDir: p }); setDest(s.downloadDir); toast('las descargas van a ' + s.downloadDir); }
    catch (e) { toast(e.message, { kind: 'err' }); }
  };
  $('#bClearHist').onclick = async () => { const j = await api.del('/api/downloads/history'); hist = j.history; renderHist(); };
  $('#jobs').addEventListener('click', (e) => { const b = e.target.closest('[data-cancel]'); if (b) { b.disabled = true; api.post(`/api/downloads/${b.dataset.cancel}/cancel`); } });
  $('#hist').addEventListener('click', async (e) => {
    const r = e.target.closest('[data-retry]'), x = e.target.closest('[data-hdel]'), pl = e.target.closest('[data-hplay]');
    if (r) { try { await api.post(`/api/downloads/${r.dataset.retry}/retry`); toast('reintentando ↻', { ms: 1400 }); } catch (err) { toast(err.message, { kind: 'err' }); } }
    if (x) { const j = await api.del('/api/downloads/history?id=' + x.dataset.hdel); hist = j.history; renderHist(); }
    if (pl) {
      const h = hist.find((y) => y.id === pl.dataset.hplay);
      const ids = (h.files || []).map((f) => (D.tracks.find((t) => t.name === f) || {}).id).filter(Boolean);
      if (ids.length) playList(ids, 0); else toast('no encuentro ese archivo en la biblioteca', { kind: 'warn' });
    }
  });
  bus.on('sse:dl', (j) => {
    const prev = jobs.get(j.id);
    jobs.set(j.id, j);
    if (!ACTIVE.has(j.status) && prev && ACTIVE.has(prev.status)) {
      if (!j.sync) {
        hist = [{ ...j }, ...hist.filter((h) => h.id !== j.id)];
        log(j.status === 'completado' ? `[${j.id.slice(-4)}] listo ❀ ${j.files.length > 1 ? j.files.length + ' archivos' : ''}` : `[${j.id.slice(-4)}] ${j.status}${j.error ? ': ' + j.error : ''}`, j.status === 'completado' ? 'ok' : 'er');
        if (j.status === 'completado') toast('descarga completa ❀', { sub: j.title });
        else if (j.status === 'error') toast('falló una descarga', { kind: 'err', sub: j.error || j.title });
        // la ayuda de cookies solo aparece si fallaron todos los intentos automáticos (sin cookies primero)
        const h = hints.get(j.id); hints.delete(j.id);
        if (j.status === 'error' && h && !shown.has(h)) {
          shown.add(h);
          if (h === 'bot') cookieHelp('YouTube bloqueó tu conexión un rato (anti-bots), aun probando sin cookies y con otros clientes. Esperá unos minutos o iniciá sesión (workspace 3 → iniciar sesión).');
          else if (h === 'expired') { cookieHelp('Tus cookies vencieron: Brave las renovó porque seguiste usando YouTube.'); setCookies(hasCookies, true); }
        }
      }
      renderHist();
    }
    renderJobs();
  });
  bus.on('sse:dllog', (m) => {
    const l = m.line;
    log(l, /^petalwave:/.test(l) ? 'wa' : /ERROR/.test(l) ? 'er' : /WARNING/.test(l) ? 'wa' : /^\[(ExtractAudio|Merger|EmbedThumbnail|Metadata)\]/.test(l) ? 'ok' : 'dm');
    if (m.hint === 'cookies' && !shown.has('cookies')) { shown.add('cookies'); log('[!] No se pudieron leer las cookies del navegador (en Windows están cifradas). No hacen falta: dejá "cookies" en "no".', 'wa'); }
    else if (m.hint) hints.set(m.id, m.hint);
  });
  bus.on('sse:dlfile', (m) => log('✔ guardado: ' + m.file, 'ok'));
  bus.on('sse:cookies', (c) => setCookies(c.has, c.expired));
  bus.on('sse:open', loadAll);
  log('descargá solo contenido propio, libre o con permiso del autor.', 'dm');
  loadAll();
}
export function setDest(p) {
  const short = p.split(/[\\/]/).filter(Boolean).slice(-2).join('\\');
  $('#dlDest').textContent = short; $('#bDest').title = 'carpeta de destino: ' + p;
}
export function setDeps(s) {
  const t = (ok, n) => `<span style="color:${ok ? 'var(--ok)' : 'var(--err)'}">●</span> ${n}`;
  $('#tDeps').innerHTML = t(s.ytdlp, 'yt-dlp') + ' ' + t(s.ffmpeg, 'ffmpeg');
  if (!s.ytdlp) log('[!] yt-dlp no encontrado. Ejecutá instalar.bat', 'er');
  if (!s.ffmpeg) log('[!] ffmpeg no encontrado: no se puede convertir audio ni leer metadatos.', 'wa');
  setCookies(!!s.cookiesTxt, !!s.cookieExpired);
  setDest(s.out);
}
