// petalwave — servidor local (127.0.0.1): biblioteca musical, reproducción, descargas con yt-dlp,
// sincronización con YouTube Music, estadísticas, letras y playlists. Sin dependencias npm.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const U = require('./src/util');
const { Library } = require('./src/library');
const { Downloads, AUDIO_FORMATS, VIDEO_QUALITIES } = require('./src/downloads');
const { Sync } = require('./src/sync');
const { Stats } = require('./src/stats');
const { Lyrics } = require('./src/lyrics');
const { Updater } = require('./src/update');
const { YTM } = require('./src/ytm');
const { Streamer } = require('./src/stream');
const { Spotify } = require('./src/spotify');

const PORT = +process.env.PORT || 3737;
const ROOT = __dirname;
const DATA = path.join(ROOT, 'data');
const OUT = path.join(ROOT, 'descargas');
const UI = path.join(ROOT, 'ui');
fs.mkdirSync(DATA, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });

const YTDLP = U.findBin('yt-dlp', ROOT);
const FFMPEG = U.findBin('ffmpeg', ROOT);
const FFPROBE = U.findBin('ffprobe', ROOT) || (FFMPEG && fs.existsSync(path.join(path.dirname(FFMPEG), U.IS_WIN ? 'ffprobe.exe' : 'ffprobe')) ? path.join(path.dirname(FFMPEG), U.IS_WIN ? 'ffprobe.exe' : 'ffprobe') : null);
const COOKIES_TXT = path.join(ROOT, 'cookies.txt');
const SYNC_ARCHIVE = path.join(ROOT, 'sync-archive.txt');

// ---------- eventos en vivo (una sola conexión SSE para toda la interfaz) ----------
const clients = new Set();
function broadcast(type, data) {
  const s = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of clients) c.write(s);
}
setInterval(() => { for (const c of clients) c.write(': ping\n\n'); }, 25000);

// ---------- ajustes ----------
const settings = new U.JsonStore(path.join(DATA, 'settings.json'), () => ({}));
const S = settings.data;
if (!Array.isArray(S.folders) || !S.folders.length) S.folders = [OUT];
if (!S.downloadDir) S.downloadDir = OUT;
if (!S.concurrency) S.concurrency = 2;
// letras online activadas por defecto (2.2): así funcionan sin archivos .lrc
if (typeof S.lyricsOnline !== 'boolean' || !S.lyricsV2) { S.lyricsOnline = true; S.lyricsV2 = true; }
if (!S.ui || typeof S.ui !== 'object') S.ui = {};
settings.save(true);
const getSettings = () => S;

let cookieExpired = false;

// ---------- módulos ----------
const library = new Library({ dataDir: DATA, getFolders: () => S.folders.filter((f) => fs.existsSync(f)), ffprobe: FFPROBE, ffmpeg: FFMPEG, broadcast });
const downloads = new Downloads({
  ytdlp: YTDLP, ffmpeg: FFMPEG, dataDir: DATA, cookiesTxt: COOKIES_TXT, archive: SYNC_ARCHIVE, settings: getSettings, broadcast,
  onFile: (f) => {
    // si la carpeta de descargas no está en la biblioteca, igual se agrega el archivo puntual
    library.addFile(f);
  },
  onCookieExpired: () => { cookieExpired = true; broadcast('cookies', { has: fs.existsSync(COOKIES_TXT), expired: true }); },
});
const sync = new Sync({ root: ROOT, ytdlp: YTDLP, cookiesTxt: COOKIES_TXT, downloads, library, broadcast });
const stats = new Stats({ dataDir: DATA, library });
const ytm = new YTM({ root: ROOT, cookiesTxt: COOKIES_TXT });
const streamer = new Streamer({ ytdlp: YTDLP, cookiesTxt: COOKIES_TXT, dataDir: DATA });
const spotify = new Spotify({ dataDir: DATA, port: PORT, ytm, broadcast });
const callbackPage = (ok, msg) => `<!doctype html><meta charset="utf-8"><title>petalwave · Spotify</title>
<body style="margin:0;height:100vh;display:grid;place-items:center;background:#0b0708;color:#ece6e6;font:15px 'JetBrains Mono',Consolas,monospace">
<div style="text-align:center;max-width:520px;padding:30px;border:1.5px solid ${ok ? '#1db954' : '#d23a43'};border-radius:10px">
<div style="font-size:42px">${ok ? '❀' : '✖'}</div><h2 style="color:${ok ? '#1db954' : '#f08a8f'}">${ok ? 'Spotify conectado' : 'no se pudo conectar'}</h2>
<p>${msg}</p><p style="color:#9a8a8b">ya podés cerrar esta pestaña y volver a petalwave.</p></div></body>`;
const lyrics = new Lyrics({ dataDir: DATA, library, ffprobe: FFPROBE, settings: getSettings, ytm });
const updater = new Updater({ root: ROOT, dataDir: DATA, broadcast });

// marca cada resultado de YouTube Music con la canción local si ya la tenés (por ID de YouTube o por artista + título)
function annotate(list) {
  const byYt = new Map(), byKey = new Map();
  for (const t of library.list()) {
    if (t.ytId) byYt.set(t.ytId, t.id);
    byKey.set(U.normalize(t.title), byKey.get(U.normalize(t.title)) || []).get(U.normalize(t.title)).push(t);
  }
  for (const it of list || []) {
    if (!it || !it.videoId) continue;
    if (it.thumb) streamer.thumbs.set(it.videoId, it.thumb);
    let local = byYt.get(it.videoId) || null;
    if (!local) {
      const cands = byKey.get(U.normalize(it.title)) || [];
      const ar = U.normalize((it.artists || [])[0] || '');
      const m = cands.find((t) => !ar || U.normalize(t.artist).includes(ar) || U.normalize(t.name).includes(ar));
      if (m) local = m.id;
    }
    it.local = local;
  }
  return list;
}
const annotateList = (o) => { if (o && o.tracks) annotate(o.tracks); return o; };
const ytmErr = (res, e) => U.json(res, e.auth ? 401 : 502, { error: e.message, auth: !!e.auth });
const playlists = new U.JsonStore(path.join(DATA, 'playlists.json'), () => ({ items: [] }));

// ---------- CPU / RAM ----------
function cpuSnap() { let idle = 0, total = 0; for (const c of os.cpus()) { for (const k in c.times) total += c.times[k]; idle += c.times.idle; } return { idle, total }; }
let lastCpu = cpuSnap();
function sysStats() {
  const s = cpuSnap(), di = s.idle - lastCpu.idle, dt = s.total - lastCpu.total; lastCpu = s;
  const mem = process.memoryUsage();
  return {
    cpu: dt > 0 ? Math.round(100 * (1 - di / dt)) : 0, ram: Math.round(100 * (1 - os.freemem() / os.totalmem())),
    ramUsed: Math.round((os.totalmem() - os.freemem()) / 1048576), ramTotal: Math.round(os.totalmem() / 1048576),
    host: os.hostname(), appMem: Math.round(mem.rss / 1048576),
  };
}

// ---------- wallpaper ----------
// fondos: imágenes (gif animado incluido) y videos en loop (mp4 / webm)
const WP_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'video/mp4': 'mp4', 'video/webm': 'webm' };
const WP_VIDEO = new Set(['mp4', 'webm']);
const findWallpaper = () => Object.values(WP_EXT).map((e) => path.join(ROOT, 'wallpaper.' + e)).find((f) => fs.existsSync(f));

// ---------- playlists ----------
// ids válidos: canciones locales o canciones online de YouTube Music (yt_<videoId>)
const okId = (id) => !!library.get(id) || /^yt_[\w-]{11}$/.test(String(id));
function playlistOp(b) {
  const items = playlists.data.items;
  const find = (id) => { const p = items.find((x) => x.id === id); if (!p) throw new Error('No existe esa playlist'); return p; };
  const now = Date.now();
  if (b.create) {
    const p = { id: 'p' + now.toString(36), name: String(b.create.name || 'nueva playlist').slice(0, 80), tracks: (b.create.tracks || []).filter(okId), created: now, updated: now };
    items.push(p);
    playlists.save();
    return p;
  }
  const p = find(b.id);
  if (b.rename) p.name = String(b.rename).slice(0, 80);
  if (b.add) for (const id of [].concat(b.add)) if (okId(id) && !p.tracks.includes(id)) p.tracks.push(id);
  if (b.remove) { const r = new Set([].concat(b.remove)); p.tracks = p.tracks.filter((id) => !r.has(id)); }
  if (Array.isArray(b.set)) p.tracks = b.set.filter(okId);
  if (b.delete) playlists.data.items = items.filter((x) => x !== p);
  p.updated = now;
  playlists.save();
  return b.delete ? { deleted: true } : p;
}

// ---------- importar archivos arrastrados a la ventana ----------
function importUpload(req, res) {
  const raw = decodeURIComponent(String(req.headers['x-filename'] || 'archivo'));
  const name = path.basename(raw).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 180);
  const ext = path.extname(name).toLowerCase();
  if (!U.AUDIO_EXT.has(ext) && !U.VIDEO_EXT.has(ext)) return U.json(res, 400, { error: 'Formato no soportado: ' + (ext || 'sin extensión') });
  const dir = path.join(S.downloadDir, 'importados');
  fs.mkdirSync(dir, { recursive: true });
  let dst = path.join(dir, name), i = 1;
  while (fs.existsSync(dst)) dst = path.join(dir, `${path.basename(name, ext)} (${i++})${ext}`);
  const tmp = dst + '.part';
  const ws = fs.createWriteStream(tmp);
  let size = 0, aborted = false;
  req.on('data', (c) => { size += c.length; if (size > 2e9 && !aborted) { aborted = true; req.unpipe(ws); ws.destroy(); fs.rm(tmp, () => {}); U.json(res, 413, { error: 'Archivo muy grande (máx 2 GB)' }); } });
  req.pipe(ws);
  ws.on('finish', async () => {
    if (aborted) return;
    fs.renameSync(tmp, dst);
    const t = await library.addFile(dst);
    U.json(res, 200, { ok: true, track: t });
  });
  ws.on('error', (e) => { if (!aborted) U.json(res, 500, { error: e.message }); });
}

// ---------- archivos estáticos de la interfaz ----------
function serveStatic(res, rel) {
  const file = path.resolve(UI, rel);
  if (!file.startsWith(UI + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': U.MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}
function serveImg(res, file) {
  res.writeHead(200, { 'Content-Type': U.MIME[path.extname(file).toLowerCase()] || 'image/jpeg', 'Cache-Control': 'max-age=86400' });
  fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
}

// ---------- rutas ----------
async function route(req, res) {
  const u = new URL(req.url, 'http://localhost');
  const p = u.pathname;
  const M = req.method;
  const body = () => U.readBody(req);
  const m = (re) => re.exec(p);
  let mm;

  if (p === '/' || p === '/index.html') {
    res.writeHead(200, { 'Content-Type': U.MIME['.html'], 'Cache-Control': 'no-cache' });
    return fs.createReadStream(path.join(ROOT, 'index.html')).pipe(res);
  }
  if (p.startsWith('/ui/')) return serveStatic(res, decodeURIComponent(p.slice(4)));
  if (p === '/icon.png' || p === '/favicon.ico') {
    const ic = path.join(ROOT, 'build', 'icon.png');
    return fs.existsSync(ic) ? serveImg(res, ic) : (res.writeHead(404), res.end());
  }

  // estado general
  if (p === '/api/status') return U.json(res, 200, {
    ytdlp: !!YTDLP, ffmpeg: !!FFMPEG, ffprobe: !!FFPROBE, out: S.downloadDir, platform: process.platform,
    cookiesTxt: fs.existsSync(COOKIES_TXT), cookieExpired, version: updater.current,
    formats: { audio: AUDIO_FORMATS, video: VIDEO_QUALITIES },
  });
  if (p === '/api/sys') return U.json(res, 200, sysStats());
  // el programa de escritorio pide un cierre ordenado (guarda todo antes de salir)
  // ---------- actualizaciones (GitHub Releases) ----------
  if (p === '/api/update' && M === 'GET') {
    try { return U.json(res, 200, await updater.check(u.searchParams.get('force') === '1')); }
    catch (e) { return U.json(res, 200, { current: updater.current, error: 'no se pudo consultar GitHub: ' + e.message }); }
  }
  if (p === '/api/update/apply' && M === 'POST') {
    try { return U.json(res, 200, await updater.apply()); } catch (e) { return U.json(res, 400, { error: e.message }); }
  }
  if (p === '/api/quit' && M === 'POST') { U.json(res, 200, { ok: true }); setTimeout(shutdown, 50); return; }
  if (p === '/api/stream') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write('retry: 2000\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }

  // ajustes (los de la interfaz también se guardan acá para no perderlos nunca)
  if (p === '/api/settings' && M === 'GET') return U.json(res, 200, S);
  if (p === '/api/settings' && M === 'POST') {
    const b = await body();
    if (b.__tooBig) return U.json(res, 413, { error: 'muy grande' });
    if (b.ui && typeof b.ui === 'object') S.ui = { ...S.ui, ...b.ui };
    if (typeof b.lyricsOnline === 'boolean') S.lyricsOnline = b.lyricsOnline;
    if (typeof b.lyricsYtm === 'boolean') S.lyricsYtm = b.lyricsYtm;
    if (b.concurrency) { S.concurrency = Math.max(1, Math.min(4, b.concurrency | 0)); downloads.pump(); }
    if (b.downloadDir) {
      const d = path.resolve(String(b.downloadDir));
      try { fs.mkdirSync(d, { recursive: true }); } catch { return U.json(res, 400, { error: 'No puedo usar esa carpeta' }); }
      S.downloadDir = d;
    }
    settings.save();
    return U.json(res, 200, S);
  }

  // ---------- biblioteca ----------
  if (p === '/api/library' && M === 'GET') {
    return U.json(res, 200, { tracks: library.list(), plays: stats.playCounts(), scan: library.progress, folders: S.folders });
  }
  if (p === '/api/library/rescan' && M === 'POST') { library.scan(); return U.json(res, 200, { ok: true }); }
  if (p === '/api/library/folders' && M === 'POST') {
    const b = await body();
    if (b.add) {
      const d = path.resolve(String(b.add));
      if (!fs.existsSync(d) || !fs.statSync(d).isDirectory()) return U.json(res, 400, { error: 'Esa carpeta no existe' });
      if (!S.folders.some((f) => path.resolve(f).toLowerCase() === d.toLowerCase())) S.folders.push(d);
    }
    if (b.remove) S.folders = S.folders.filter((f) => f !== b.remove);
    if (!S.folders.length) S.folders = [OUT];
    settings.save();
    library.watch();
    library.scan();
    return U.json(res, 200, { folders: S.folders });
  }
  if (p === '/api/library/duplicates') return U.json(res, 200, { groups: library.duplicates() });
  if (p === '/api/import' && M === 'POST') return importUpload(req, res);
  if ((mm = m(/^\/media\/([0-9a-f]{16})$/))) {
    const t = library.get(mm[1]);
    if (!t) { res.writeHead(404); return res.end(); }
    return U.serveRange(req, res, t.path, U.MIME['.' + t.ext] || 'application/octet-stream');
  }
  // YouTube Music online (sin descargar)
  if ((mm = m(/^\/stream\/([\w-]{11})$/))) {
    if (u.searchParams.get('prefetch')) {   // precargar la URL de la siguiente canción
      try { await streamer.resolve(mm[1]); return U.json(res, 200, { ok: true }); } catch (e) { return U.json(res, 502, { error: e.message }); }
    }
    return streamer.proxy(req, res, mm[1]);
  }
  if ((mm = m(/^\/ytcover\/([\w-]{11})$/))) return streamer.cover(req, res, mm[1]);
  if ((mm = m(/^\/cover\/([0-9a-f]{16})$/))) {
    const f = await library.cover(mm[1]);
    if (!f) { res.writeHead(404, { 'Cache-Control': 'max-age=300' }); return res.end(); }
    return serveImg(res, f);
  }
  if ((mm = m(/^\/api\/track\/([0-9a-f]{16})$/))) {
    const t = library.get(mm[1]);
    return t ? U.json(res, 200, { ...t, plays: stats.plays(t.id) }) : U.json(res, 404, { error: 'no existe' });
  }
  if ((mm = m(/^\/api\/track\/([0-9a-f]{16})\/meta$/)) && M === 'POST') {
    try { return U.json(res, 200, await library.editMeta(mm[1], await body())); }
    catch (e) { return U.json(res, 400, { error: e.message }); }
  }
  if ((mm = m(/^\/api\/track\/([0-9a-f]{16})\/trash$/)) && M === 'POST') {
    try { await library.trash(mm[1]); return U.json(res, 200, { ok: true }); }
    catch (e) { return U.json(res, 400, { error: e.message }); }
  }
  if ((mm = m(/^\/api\/track\/([0-9a-f]{16})\/reveal$/)) && M === 'POST') {
    const t = library.get(mm[1]); if (t) U.openInExplorer(t.path, true);
    return U.json(res, 200, { ok: !!t });
  }
  if ((mm = m(/^\/api\/lyrics\/(yt_[\w-]{11})$/))) {
    const q = u.searchParams, cut = (k) => String(q.get(k) || '').slice(0, 300);
    return U.json(res, 200, await lyrics.get(mm[1], { title: cut('title'), artist: cut('artist'), album: cut('album'), duration: +q.get('duration') || 0 }));
  }
  if ((mm = m(/^\/api\/lyrics\/([0-9a-f]{16})$/))) {
    if (M === 'POST') {
      const buf = await U.readRaw(req, 1e6);
      if (!buf) return U.json(res, 413, { error: 'muy grande' });
      try { return U.json(res, 200, lyrics.saveSidecar(mm[1], buf.toString('utf8'))); } catch (e) { return U.json(res, 400, { error: e.message }); }
    }
    return U.json(res, 200, await lyrics.get(mm[1]));
  }
  if (p === '/api/open' && M === 'POST') {
    const b = await body();
    U.openInExplorer(b.path && S.folders.concat(S.downloadDir).includes(b.path) ? b.path : S.downloadDir);
    return U.json(res, 200, { ok: true });
  }

  // ---------- playlists ----------
  if (p === '/api/playlists' && M === 'GET') return U.json(res, 200, { items: playlists.data.items });
  if (p === '/api/playlists' && M === 'POST') {
    try { return U.json(res, 200, playlistOp(await body())); } catch (e) { return U.json(res, 400, { error: e.message }); }
  }
  if (p === '/api/autoplaylists') return U.json(res, 200, { items: stats.autoPlaylists() });
  if ((mm = m(/^\/api\/similar\/([0-9a-f]{16})$/))) return U.json(res, 200, { ids: stats.similar(mm[1], +u.searchParams.get('n') || 25) });

  // ---------- estadísticas ----------
  if (p === '/api/stats/play' && M === 'POST') { stats.record(await body()); return U.json(res, 200, { ok: true }); }
  if (p === '/api/stats') return U.json(res, 200, stats.summary(u.searchParams.get('range') || 'month'));

  // ---------- descargas ----------
  if (p === '/api/downloads' && M === 'GET') return U.json(res, 200, downloads.list());
  if (p === '/api/downloads' && M === 'POST') {
    if (!YTDLP) return U.json(res, 500, { error: 'yt-dlp no encontrado. Ejecutá instalar.bat' });
    const b = await body();
    const urls = [].concat(b.urls || b.url || []).map((x) => String(x).trim()).filter((x) => /^https?:\/\//i.test(x));
    if (!urls.length) return U.json(res, 400, { error: 'URL inválida' });
    const format = ['mp3', 'm4a', 'opus', 'mp4'].includes(b.format) ? b.format : 'mp3';
    if (!FFMPEG) return U.json(res, 500, { error: 'ffmpeg no encontrado (necesario para convertir)' });
    if (b.cookies === 'txt' && !fs.existsSync(COOKIES_TXT)) return U.json(res, 400, { error: 'Elegiste cookies .txt pero no hay ninguno cargado (botón 🍪).' });
    const ids = urls.slice(0, 200).map((url) => downloads.add({ url, format, quality: String(b.quality || ''), playlist: !!b.playlist, cookies: String(b.cookies || ''), dest: b.dest || S.downloadDir }).id);
    return U.json(res, 200, { ids });
  }
  if ((mm = m(/^\/api\/downloads\/(\d+)\/cancel$/)) && M === 'POST') {
    const j = downloads.jobs.get(mm[1]);
    if (j && j.sync) sync.stop();
    return U.json(res, 200, { ok: downloads.cancel(mm[1]) });
  }
  if ((mm = m(/^\/api\/downloads\/(\d+)\/retry$/)) && M === 'POST') {
    const j = downloads.retry(mm[1]);
    return j ? U.json(res, 200, { id: j.id }) : U.json(res, 404, { error: 'no existe' });
  }
  if ((mm = m(/^\/api\/downloads\/(\d+)\/log$/))) {
    const j = downloads.jobs.get(mm[1]);
    return U.json(res, 200, { log: j ? j.log : [] });
  }
  if (p === '/api/downloads/history' && M === 'DELETE') { downloads.removeHistory(u.searchParams.get('id')); return U.json(res, 200, downloads.list()); }

  // ---------- YouTube Music (ytmusicapi) ----------
  if (p.startsWith('/api/ytm/')) {
    const q = u.searchParams;
    try {
      if (p === '/api/ytm/status') return U.json(res, 200, ytm.available() ? await ytm.call('status', {}, { timeout: 30000 }) : { auth: false, unavailable: true, error: 'ytmusicapi no está instalado' });
      if (p === '/api/ytm/search') {
        const filter = ['songs', 'videos', 'albums', 'playlists'].includes(q.get('filter')) ? q.get('filter') : 'songs';
        return U.json(res, 200, { items: annotate(await ytm.call('search', { q: String(q.get('q') || '').slice(0, 200), filter, limit: 30 }, { cacheMs: 10 * 60e3 })) });
      }
      if (p === '/api/ytm/liked') return U.json(res, 200, annotateList(await ytm.call('liked', { limit: +q.get('limit') || 1000 }, { timeout: 120000, cacheMs: 60e3 })));
      if (p === '/api/ytm/playlists') return U.json(res, 200, { items: await ytm.call('playlists', {}, { cacheMs: 60e3 }) });
      if (p === '/api/ytm/history') return U.json(res, 200, { items: annotate(await ytm.call('history', {}, { cacheMs: 30e3 })) });
      if ((mm = m(/^\/api\/ytm\/playlist\/([\w-]+)$/))) return U.json(res, 200, annotateList(await ytm.call('playlist', { id: mm[1], limit: 1000 }, { timeout: 120000, cacheMs: 60e3 })));
      if ((mm = m(/^\/api\/ytm\/album\/([\w-]+)$/))) return U.json(res, 200, annotateList(await ytm.call('album', { browseId: mm[1] }, { cacheMs: 30 * 60e3 })));
      if ((mm = m(/^\/api\/ytm\/radio\/([\w-]{11})$/))) return U.json(res, 200, annotateList(await ytm.call('radio', { videoId: mm[1], limit: 50 }, { cacheMs: 10 * 60e3 })));
      if (p === '/api/ytm/rate' && M === 'POST') {
        const b = await body();
        if (!/^[\w-]{11}$/.test(b.videoId || '')) return U.json(res, 400, { error: 'videoId inválido' });
        const r = await ytm.call('rate', { videoId: b.videoId, rating: b.rating === 'INDIFFERENT' ? 'INDIFFERENT' : 'LIKE' });
        ytm.clearCache();
        return U.json(res, 200, r);
      }
    } catch (e) { return ytmErr(res, e); }
    return U.json(res, 404, { error: 'no existe' });
  }

  // ---------- Spotify (sesión oficial; el audio sale de YouTube Music, nunca de Spotify) ----------
  if (p === '/spotify/callback') {
    let ok = true, msg = '';
    const escH = (x) => String(x).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
    try { await spotify.callback(u.searchParams); const s = spotify.status(); msg = `sesión iniciada${s.user ? ' como <b>' + escH(s.user.name) + '</b>' : ''}.`; }
    catch (e) { ok = false; msg = String(e.message).replace(/[<>&]/g, ''); }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(callbackPage(ok, msg));
  }
  if (p.startsWith('/api/spotify/')) {
    try {
      if (p === '/api/spotify/status') return U.json(res, 200, spotify.status());
      if (p === '/api/spotify/config' && M === 'POST') { spotify.setClientId((await body()).clientId); return U.json(res, 200, spotify.status()); }
      if (p === '/api/spotify/login') return U.json(res, 200, { url: spotify.loginUrl() });
      if (p === '/api/spotify/logout' && M === 'POST') { spotify.logout(); return U.json(res, 200, spotify.status()); }
      if (p === '/api/spotify/playlists') return U.json(res, 200, { items: await spotify.playlists() });
      if (p === '/api/spotify/list') return U.json(res, 200, await spotify.list(u.searchParams.get('kind'), u.searchParams.get('id')));
      if (p === '/api/spotify/url' && M === 'POST') return U.json(res, 200, await spotify.fromUrl((await body()).url));
      if (p === '/api/spotify/match' && M === 'POST') {
        const b = await body();
        // copias: la marca "local" no se guarda en la caché de coincidencias
        const found = (await spotify.match(b.tracks)).map((m) => (m ? { ...m } : null));
        annotate(found.filter(Boolean));
        return U.json(res, 200, { matches: found });
      }
    } catch (e) { return U.json(res, e.auth ? 401 : 502, { error: e.message, auth: !!e.auth }); }
    return U.json(res, 404, { error: 'no existe' });
  }

  // ---------- sincronización / YouTube Music ----------
  if (p === '/api/sync' && M === 'GET') return U.json(res, 200, sync.view({ cookieExpired }));
  if (p === '/api/sync' && M === 'POST') {
    try { sync.update(await body()); return U.json(res, 200, sync.view({ cookieExpired })); } catch (e) { return U.json(res, 400, { error: e.message }); }
  }
  if (p === '/api/sync/run' && M === 'POST') {
    const b = await body();
    if (!fs.existsSync(COOKIES_TXT)) return U.json(res, 400, { error: 'Para sincronizar con tu cuenta necesitás cargar cookies.txt (botón 🍪).' });
    if (sync.state.running) return U.json(res, 409, { error: 'Ya hay una sincronización en curso.' });
    sync.run(b.id);
    return U.json(res, 200, { state: sync.state });
  }
  if (p === '/api/sync/stop' && M === 'POST') { sync.stop(); return U.json(res, 200, { state: sync.state }); }
  if (p === '/api/sync/discover') return U.json(res, 200, await sync.discover());
  if (p === '/api/yt/inspect' && M === 'POST') { const b = await body(); return U.json(res, 200, await sync.inspect(String(b.url || ''))); }

  // ---------- cookies.txt ----------
  if (p === '/api/cookies' && M === 'POST') {
    const buf = await U.readRaw(req, 5e6);
    if (!buf) return U.json(res, 413, { error: 'Archivo muy grande' });
    const txt = buf.toString('utf8');
    // las líneas "#HttpOnly_" son cookies de verdad (las de sesión), no comentarios
    const valid = txt.split(/\r?\n/).map((l) => l.replace(/^#HttpOnly_/, '')).filter((l) => l && !l.startsWith('#') && l.split('\t').length >= 7);
    if (!valid.length) return U.json(res, 400, { error: 'No parece un cookies.txt (formato Netscape). Exportalo con una extensión tipo "Get cookies.txt LOCALLY".' });
    if (!valid.some((l) => /youtube\.com/i.test(l.split('\t')[0]))) return U.json(res, 400, { error: 'El archivo no tiene cookies de youtube.com. Exportalo estando en youtube.com con la sesión iniciada.' });
    fs.writeFileSync(COOKIES_TXT, txt.startsWith('# Netscape') ? txt : '# Netscape HTTP Cookie File\n' + txt);
    cookieExpired = false;
    broadcast('cookies', { has: true, expired: false });
    return U.json(res, 200, { ok: true, count: valid.length });
  }
  if (p === '/api/cookies' && M === 'DELETE') {
    if (fs.existsSync(COOKIES_TXT)) fs.unlinkSync(COOKIES_TXT);
    broadcast('cookies', { has: false, expired: false });
    return U.json(res, 200, { ok: true });
  }

  // ---------- wallpaper ----------
  if (p === '/wallpaper') {
    const wp = findWallpaper();
    if (!wp) { res.writeHead(404); return res.end(); }
    const ext = path.extname(wp).slice(1);
    if (WP_VIDEO.has(ext)) return U.serveRange(req, res, wp, ext === 'webm' ? 'video/webm' : 'video/mp4');
    res.writeHead(200, { 'Content-Type': U.MIME[path.extname(wp)] || 'image/jpeg', 'Cache-Control': 'no-cache' });
    return fs.createReadStream(wp).pipe(res);
  }
  if (p === '/api/wallpaper' && M === 'GET') {
    const wp = findWallpaper();
    const ext = wp ? path.extname(wp).slice(1) : null;
    return U.json(res, 200, { has: !!wp, ext, kind: !wp ? null : WP_VIDEO.has(ext) ? 'video' : ext === 'gif' ? 'gif' : 'image', size: wp ? fs.statSync(wp).size : 0 });
  }
  if (p === '/api/wallpaper' && M === 'POST') {
    const ext = WP_EXT[(req.headers['content-type'] || '').split(';')[0]];
    if (!ext) return U.json(res, 400, { error: 'Formato no soportado (jpg, png, webp, gif, mp4, webm)' });
    const max = WP_VIDEO.has(ext) ? 300e6 : 30e6;
    const buf = await U.readRaw(req, max);
    if (!buf) return U.json(res, 413, { error: `Archivo muy grande (máx ${max / 1e6} MB)` });
    for (const e of Object.values(WP_EXT)) { const f = path.join(ROOT, 'wallpaper.' + e); if (fs.existsSync(f)) fs.unlinkSync(f); }
    fs.writeFileSync(path.join(ROOT, 'wallpaper.' + ext), buf);
    return U.json(res, 200, { ok: true });
  }
  if (p === '/api/wallpaper' && M === 'DELETE') { const wp = findWallpaper(); if (wp) fs.unlinkSync(wp); return U.json(res, 200, { ok: true }); }

  res.writeHead(404); res.end('404');
}

const server = http.createServer((req, res) => {
  route(req, res).catch((e) => {
    console.error('error en', req.url, e);
    U.json(res, 500, { error: e.message });
  });
});

server.listen(PORT, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${PORT}`;
  console.log(`\n  petalwave 2.0 en ${url}`);
  console.log(`  yt-dlp : ${YTDLP || 'NO ENCONTRADO'}`);
  console.log(`  ffmpeg : ${FFMPEG || 'NO ENCONTRADO'}  ffprobe: ${FFPROBE || 'NO ENCONTRADO'}`);
  console.log(`  carpetas: ${S.folders.join(' | ')}\n`);
  library.scan();
  library.watch();
  if (!process.argv.includes('--no-open')) {
    const a = U.IS_WIN ? ['/c', 'start', '', url] : [url];
    spawn(U.IS_WIN ? 'cmd' : 'xdg-open', a, { detached: true, stdio: 'ignore' }).unref();
  }
});

const shutdown = () => { downloads.stopAll(); ytm.stop(); playlists.save(true); settings.save(true); stats.store.save(true); library.store.save(true); process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
