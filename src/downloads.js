// cola de descargas con yt-dlp: concurrencia limitada, progreso real, cancelar, reintentar e historial persistente
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { JsonStore, killTree, YT_JS } = require('./util');

const AUDIO_FORMATS = {
  mp3: { label: 'mp3', qualities: ['320', '256', '192', '128'] },
  m4a: { label: 'm4a (AAC, sin recodificar si se puede)', qualities: ['best'] },
  opus: { label: 'opus (la mejor calidad de YouTube)', qualities: ['best'] },
};
const VIDEO_QUALITIES = ['2160', '1440', '1080', '720', '480', '360'];
const COOKIE_BROWSERS = ['firefox', 'chrome', 'edge', 'brave', 'opera', 'vivaldi'];
const ACTIVE = new Set(['en cola', 'iniciando', 'descargando', 'procesando', 'reintentando']);

class Downloads {
  constructor({ ytdlp, ffmpeg, dataDir, cookiesTxt, archive, settings, broadcast, onFile, onCookieExpired }) {
    Object.assign(this, { ytdlp, ffmpeg, cookiesTxt, archive, settings, broadcast, onFile, onCookieExpired });
    this.hist = new JsonStore(path.join(dataDir, 'downloads.json'), () => ({ items: [] }));
    // lo que quedó "descargando" de una sesión anterior se marca como interrumpido
    for (const it of this.hist.data.items) if (ACTIVE.has(it.status)) it.status = 'interrumpido';
    this.jobs = new Map();
    this.queue = [];
    this.nextId = Date.now() % 1e7;
  }

  running() { return [...this.jobs.values()].filter((j) => j.proc && j.proc.exitCode === null).length; }

  public(j) {
    const { proc, finished, done, _last, log, ...rest } = j;
    return rest;
  }
  list() {
    const active = [...this.jobs.values()].filter((j) => ACTIVE.has(j.status)).map((j) => this.public(j));
    return { active, history: this.hist.data.items.slice(0, 300) };
  }

  add(opts) {
    const id = String(++this.nextId);
    const isMusic = /^https?:\/\/music\.youtube\.com\//i.test(opts.url);
    const kind = opts.format === 'mp4' ? 'video' : 'audio';
    const job = {
      id, url: opts.url, format: opts.format, quality: opts.quality, playlist: !!opts.playlist,
      cookies: opts.cookies || '', dest: opts.dest || this.settings().downloadDir, isMusic, kind,
      sync: opts.sync || null, status: 'en cola', created: Date.now(), started: null, ended: null,
      title: opts.sync ? opts.sync.label : opts.url, percent: 0, speed: '', eta: '', size: '', downloaded: '',
      fmtInfo: '', item: 0, items: 0, files: [], skipped: 0, error: '', log: [],
    };
    job.finished = new Promise((ok) => (job.done = ok));
    this.jobs.set(id, job);
    this.queue.push(job);
    this.emit(job, true);
    this.pump();
    return job;
  }

  pump() {
    const max = Math.max(1, Math.min(4, this.settings().concurrency || 2));
    while (this.running() < max && this.queue.length) this.start(this.queue.shift());
  }

  emit(job, force) {
    // progreso: como mucho ~4 mensajes por segundo por descarga
    const now = Date.now();
    if (!force && job._last && now - job._last < 250) return;
    job._last = now;
    this.broadcast('dl', this.public(job));
  }

  saveHistory(job) {
    if (job.sync) return; // los syncs tienen su propio registro
    const items = this.hist.data.items;
    const rec = {
      id: job.id, url: job.url, title: job.title, format: job.format, quality: job.quality, playlist: job.playlist,
      dest: job.dest, status: job.status, created: job.created, ended: job.ended, files: job.files.slice(0, 200),
      error: job.error, size: job.size, fmtInfo: job.fmtInfo,
    };
    const i = items.findIndex((x) => x.id === job.id);
    if (i >= 0) items[i] = rec; else items.unshift(rec);
    if (items.length > 300) items.length = 300;
    this.hist.save();
  }

  args(job) {
    const tmp = path.join(job.dest, '.tmp', job.id);
    const outTpl = job.isMusic ? '%(artist,creator,uploader)s - %(track,title)s.%(ext)s' : '%(title)s.%(ext)s';
    const a = [
      '--newline', '--progress', '--no-simulate', '--encoding', 'utf-8',
      '--progress-template',
      'download:PROG %(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s|%(progress._total_bytes_str)s|%(progress._total_bytes_estimate_str)s|%(progress._downloaded_bytes_str)s',
      '--print', 'before_dl:TITLE %(artist,creator,uploader|)s|%(track,title)s',
      '--print', 'before_dl:FMT %(format_id)s|%(ext)s|%(acodec)s|%(vcodec)s|%(resolution)s|%(abr)s',
      '--print', 'after_move:FILE %(filepath)s',
      '-P', job.dest, '-P', 'temp:' + tmp, '-o', outTpl,
      '--windows-filenames', '--trim-filenames', '150', '--no-mtime',
      job.playlist ? '--yes-playlist' : '--no-playlist',
    ];
    if (job.playlist && /[?&]list=RD/.test(job.url)) a.push('--playlist-end', '50');      // mixes infinitos
    if (job.playlist) a.push('--ignore-errors');
    if (job.sync) {
      a.push('--download-archive', this.archive, '--no-overwrites',
        '--sleep-requests', '1', '--sleep-interval', '2', '--max-sleep-interval', '6');
      if (job.sync.breakOnExisting) a.push('--break-on-existing');
    } else if (job.playlist) a.push('--sleep-requests', '1');
    if (this.ffmpeg) a.push('--ffmpeg-location', path.dirname(this.ffmpeg));
    // sin cookies por defecto: solo se usan como último intento, o si el link es privado (me gusta, ver más tarde…)
    const mode = job.plan[job.attempt] || 'plain';
    if (mode === 'cookies') {
      if (COOKIE_BROWSERS.includes(job.cookies)) a.push('--cookies-from-browser', job.cookies);
      else a.push('--cookies', this.cookiesTxt);
    } else if (mode === 'alt') {
      // otros clientes de YouTube: suelen esquivar el "confirm you're not a bot" sin iniciar sesión
      a.push('--extractor-args', 'youtube:player_client=tv,mweb,web_safari', '--sleep-requests', '1');
    }

    const squareCover = ['--convert-thumbnails', 'jpg',
      '--ppa', `ThumbnailsConvertor+FFmpeg_o:-c:v mjpeg -vf crop="'if(gt(ih,iw),iw,ih)':'if(gt(iw,ih),ih,iw)'"`];
    if (job.format === 'mp4') {
      const h = VIDEO_QUALITIES.includes(job.quality) ? job.quality : '1080';
      a.push('-f', `bv*[height<=${h}][ext=mp4]+ba[ext=m4a]/bv*[height<=${h}]+ba/b[height<=${h}]/b`,
        '--merge-output-format', 'mp4', '--embed-metadata', '--embed-thumbnail');
    } else if (job.format === 'm4a') {
      // 141 = AAC 256 kbps, disponible con YouTube Music Premium (si no, el mejor m4a)
      a.push('-f', 'bestaudio[format_id=141]/bestaudio[ext=m4a]/bestaudio', '-x', '--audio-format', 'm4a', '--embed-metadata', '--embed-thumbnail', ...squareCover);
    } else if (job.format === 'opus') {
      a.push('-f', 'bestaudio[acodec=opus]/bestaudio', '-x', '--audio-format', 'opus', '--embed-metadata', '--embed-thumbnail', ...squareCover);
    } else {
      const q = AUDIO_FORMATS.mp3.qualities.includes(job.quality) ? job.quality : '320';
      a.push('-x', '--audio-format', 'mp3', '--audio-quality', q + 'K', '--embed-metadata', '--embed-thumbnail', ...squareCover);
    }
    a.push('--', job.url);
    return a;
  }

  // intentos: sin cookies → otros clientes de YouTube → con tu sesión (si hay). Lo privado arranca con la sesión.
  makePlan(job) {
    const hasCookies = COOKIE_BROWSERS.includes(job.cookies) || fs.existsSync(this.cookiesTxt);
    const priv = /[?&]list=(LM|LL|WL|LRYR)\b|\/feed\/|\/playlist\?list=PL[^&]*&.*private/i.test(job.url) || job.needAuth;
    if (priv && hasCookies) return ['cookies'];
    if (job.cookies && hasCookies) return ['cookies', 'plain', 'alt'];      // el usuario pidió usar la sesión siempre
    return hasCookies ? ['plain', 'alt', 'cookies'] : ['plain', 'alt'];
  }

  start(job) {
    if (!job.plan) { job.plan = this.makePlan(job); job.attempt = 0; }
    try { fs.mkdirSync(job.dest, { recursive: true }); } catch {}
    job.status = 'iniciando';
    job.started = Date.now();
    this.emit(job, true);
    let proc;
    try {
      proc = spawn(this.ytdlp, [...YT_JS, ...this.args(job)], { env: { ...process.env, PYTHONIOENCODING: 'utf-8' }, windowsHide: true });
    } catch (e) {
      return this.finish(job, -1, 'No pude ejecutar yt-dlp: ' + e.message);
    }
    job.proc = proc;
    let buf = '';
    const onData = (chunk) => {
      buf += chunk.toString('utf8');
      const lines = buf.split(/\r?\n/);
      buf = lines.pop();
      for (const raw of lines) this.line(job, raw.trim());
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('error', (e) => this.finish(job, -1, e.message));
    proc.on('close', (code) => this.finish(job, code));
  }

  line(job, line) {
    if (!line) return;
    if (line.startsWith('PROG ')) {
      const [p, speed, eta, total, est, dl] = line.slice(5).split('|').map((s) => s.trim());
      job.status = 'descargando';
      job.percent = parseFloat(p) || 0;
      job.speed = speed && !/N\/?A|Unknown/i.test(speed) ? speed : '';
      job.eta = eta && !/N\/?A|Unknown/i.test(eta) ? eta : '';
      const size = total && !/N\/?A/i.test(total) ? total : est && !/N\/?A/i.test(est) ? '~' + est : '';
      job.size = size; job.downloaded = dl && !/N\/?A/i.test(dl) ? dl : '';
      return this.emit(job);
    }
    if (line.startsWith('TITLE ')) {
      const [artist, ...rest] = line.slice(6).split('|');
      const track = rest.join('|');
      const t = artist && artist !== 'NA' ? `${artist} — ${track}` : track;
      job.current = t;
      if (!job.sync && !job.playlist) job.title = t;
      if (job.playlist && !job.sync && job.title === job.url) job.title = 'playlist · ' + t;
      return this.emit(job, true);
    }
    if (line.startsWith('FMT ')) {
      const [fid, ext, acodec, vcodec, res, abr] = line.slice(4).split('|');
      const parts = [];
      if (vcodec && vcodec !== 'none' && vcodec !== 'NA') parts.push(`${res} ${vcodec.split('.')[0]}`);
      if (acodec && acodec !== 'none' && acodec !== 'NA') parts.push(`${acodec.split('.')[0]}${abr && abr !== 'NA' ? ' ' + Math.round(+abr) + 'k' : ''}`);
      job.fmtInfo = `origen: ${parts.join(' + ') || ext} (#${fid})`;
      return this.emit(job, true);
    }
    if (line.startsWith('FILE ')) {
      const f = line.slice(5);
      job.files.push(path.basename(f));
      this.broadcast('dlfile', { id: job.id, file: path.basename(f) });
      if (this.onFile) this.onFile(f);
      return;
    }
    const it = /Downloading item (\d+) of (\d+)/.exec(line);
    if (it) { job.item = +it[1]; job.items = +it[2]; }
    if (/has already been recorded in the archive/.test(line)) job.skipped++;
    let hint = null;
    if (/cookies are no longer valid|have likely been rotated/i.test(line)) { hint = 'expired'; if (this.onCookieExpired) this.onCookieExpired(); }
    else if (/confirm you.?re not a bot|HTTP Error 429/i.test(line)) hint = 'bot';
    else if (/could not (copy|find).*cookie|Failed to decrypt|cookie database/i.test(line)) hint = 'cookies';
    if (/^\[(ExtractAudio|Merger|EmbedThumbnail|Metadata|ThumbnailsConvertor|VideoConvertor)\]/.test(line)) job.status = 'procesando';
    if (/^ERROR:/.test(line)) job.error = line.replace(/^ERROR:\s*(\[[^\]]+\]\s*)?/, '').slice(0, 400);
    job.log.push(line);
    if (job.log.length > 120) job.log.shift();
    this.broadcast('dllog', { id: job.id, line, hint, status: job.status });
  }

  finish(job, code, err) {
    if (job.ended) return;
    try { fs.rmSync(path.join(job.dest, '.tmp', job.id), { recursive: true, force: true }); } catch {}
    try { fs.rmdirSync(path.join(job.dest, '.tmp')); } catch {}   // borrar .tmp si quedó vacía
    const partial = job.files.length > 0 || job.skipped > 0;
    // 101 = frenó por --break-on-existing (al día); playlist con algún tema caído pero el resto bien = completado
    const ok = !job.cancelled && (code === 0 || code === 101 || ((job.sync || job.playlist) && code === 1 && partial));
    // falló por bloqueo de YouTube (bot, 429, 403, edad, sesión): probar el siguiente modo sin molestar al usuario
    const blocked = /not a bot|HTTP Error 429|HTTP Error 403|Sign in to|confirm your age|age.restricted|inappropriate|cookies are no longer valid|rotated|Requested format is not available|nsig|po.?token|This content isn.t available/i;
    if (!ok && !job.cancelled && !partial && job.plan && job.attempt < job.plan.length - 1 && job.log.some((l) => blocked.test(l))) {
      job.attempt++;
      const why = { alt: 'probando otro cliente de YouTube (sin cookies)…', cookies: 'probando con tu sesión de YouTube…' }[job.plan[job.attempt]];
      job.log.push('petalwave: ' + why);
      this.broadcast('dllog', { id: job.id, line: 'petalwave: ' + why, status: 'reintentando' });
      job.error = null; job.log = job.log.slice(-40);
      job.status = 'reintentando'; job.proc = null;
      this.emit(job, true);
      setTimeout(() => (job.cancelled ? this.finish(job, -1) : this.start(job)), 1500);
      return;
    }
    job.status = job.cancelled ? 'cancelado' : ok ? 'completado' : 'error';
    if (err) job.error = err;
    if (ok) job.percent = 100;
    job.ended = Date.now();
    job.proc = null;
    this.emit(job, true);
    this.saveHistory(job);
    job.done(job);
    // liberar memoria: los trabajos terminados quedan en el historial, no en el mapa
    setTimeout(() => this.jobs.delete(job.id), 60000);
    this.pump();
  }

  cancel(id) {
    const job = this.jobs.get(id);
    if (!job || !ACTIVE.has(job.status)) return false;
    job.cancelled = true;
    const qi = this.queue.indexOf(job);
    if (qi >= 0) { this.queue.splice(qi, 1); this.finish(job, -1); return true; }
    killTree(job.proc);
    return true;
  }

  retry(id) {
    const old = this.jobs.get(id) || this.hist.data.items.find((x) => x.id === id);
    if (!old) return null;
    return this.add({ url: old.url, format: old.format, quality: old.quality, playlist: old.playlist, dest: old.dest, cookies: old.cookies || 'txt' });
  }

  removeHistory(id) {
    if (id) this.hist.data.items = this.hist.data.items.filter((x) => x.id !== id);
    else this.hist.data.items = this.hist.data.items.filter((x) => ACTIVE.has(x.status));
    this.hist.save();
  }

  stopAll() { for (const j of this.jobs.values()) if (j.proc) killTree(j.proc); }
}

module.exports = { Downloads, AUDIO_FORMATS, VIDEO_QUALITIES };
