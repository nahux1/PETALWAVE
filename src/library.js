// biblioteca musical: escaneo de carpetas, índice persistente, metadatos, carátulas, duplicados y edición de etiquetas
'use strict';
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { sha, Limiter, run, normalize, AUDIO_EXT, VIDEO_EXT, JsonStore, IS_WIN } = require('./util');

const INDEX_VERSION = 4;
const { ytIdFrom } = require('./ytm');
const YT_CATEGORIES = new Set(['music', 'people & blogs', 'entertainment', 'gaming', 'film & animation', 'comedy', 'education',
  'howto & style', 'news & politics', 'nonprofits & activism', 'pets & animals', 'science & technology', 'sports', 'travel & events', 'autos & vehicles']);
const COVER_NAMES = ['cover.jpg', 'folder.jpg', 'front.jpg', 'cover.png', 'folder.png', 'album.jpg', 'cover.webp'];

class Library {
  constructor({ dataDir, getFolders, ffprobe, ffmpeg, broadcast }) {
    this.ffprobe = ffprobe;
    this.ffmpeg = ffmpeg;
    this.getFolders = getFolders;
    this.broadcast = broadcast;
    this.coverDir = path.join(dataDir, 'covers');
    fs.mkdirSync(this.coverDir, { recursive: true });
    this.store = new JsonStore(path.join(dataDir, 'library.json'), () => ({ version: INDEX_VERSION, tracks: [] }));
    if (this.store.data.version !== INDEX_VERSION) this.store.data = { version: INDEX_VERSION, tracks: [] };
    this.tracks = new Map(this.store.data.tracks.map((t) => [t.id, t]));
    this.probeQ = new Limiter(3);   // ffprobe en paralelo como máximo
    this.coverQ = new Limiter(2);   // ffmpeg de carátulas como máximo
    this.noCover = new Set();       // ids sin carátula (para no reintentar en cada pedido)
    this.coverPending = new Map();
    this.scanning = null;
    this.progress = { scanning: false, done: 0, total: 0 };
    this.watchers = [];
    this.rescanTimer = null;
  }

  list() { return [...this.tracks.values()]; }
  get(id) { return this.tracks.get(id); }
  byPath(p) { return this.tracks.get(sha(path.resolve(p).toLowerCase())); }

  // ---------- escaneo ----------
  async walk(dir, out, depth = 0) {
    if (depth > 12) return;
    let ents;
    try { ents = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (e.name.startsWith('.')) continue;                    // .tmp, .covers, carpetas ocultas
      const full = path.join(dir, e.name);
      if (e.isDirectory()) await this.walk(full, out, depth + 1);
      else {
        const ext = path.extname(e.name).toLowerCase();
        if (AUDIO_EXT.has(ext) || VIDEO_EXT.has(ext)) out.push(full);
      }
    }
  }

  scan() {
    if (this.scanning) { this.again = true; return this.scanning; }
    this.scanning = (async () => {
      const folders = this.getFolders();
      const found = [];
      for (const f of folders) await this.walk(f, found);
      const seen = new Set();
      const todo = [];
      for (const file of found) {
        const id = sha(path.resolve(file).toLowerCase());
        seen.add(id);
        let st; try { st = await fsp.stat(file); } catch { continue; }
        const old = this.tracks.get(id);
        if (old && old.size === st.size && old.mtime === st.mtimeMs) continue;   // sin cambios
        todo.push({ id, file, st, old });
      }
      let removed = 0;
      for (const id of [...this.tracks.keys()]) if (!seen.has(id)) { this.tracks.delete(id); removed++; }
      this.progress = { scanning: true, done: 0, total: todo.length };
      this.broadcast('scan', this.progress);
      let last = Date.now();
      await Promise.all(todo.map((t) => this.probeQ.run(async () => {
        const meta = await this.probe(t.file);
        this.tracks.set(t.id, this.build(t.id, t.file, t.st, meta, t.old));
        this.noCover.delete(t.id);
        this.progress.done++;
        if (Date.now() - last > 400) { last = Date.now(); this.broadcast('scan', this.progress); }
      })));
      this.progress = { scanning: false, done: todo.length, total: todo.length };
      if (todo.length || removed) {
        this.store.data.tracks = this.list();
        this.store.save();
      }
      this.broadcast('scan', this.progress);
      this.broadcast('library', { count: this.tracks.size, changed: todo.length + removed });
      return { added: todo.length, removed };
    })().finally(() => {
      this.scanning = null;
      if (this.again) { this.again = false; this.scan(); }
    });
    return this.scanning;
  }

  // agrega/actualiza un archivo puntual (después de una descarga o importación)
  async addFile(file) {
    let st; try { st = await fsp.stat(file); } catch { return null; }
    const id = sha(path.resolve(file).toLowerCase());
    const meta = await this.probeQ.run(() => this.probe(file));
    const t = this.build(id, file, st, meta, this.tracks.get(id));
    this.tracks.set(id, t);
    this.noCover.delete(id);
    this.store.data.tracks = this.list();
    this.store.save();
    this.broadcast('library', { count: this.tracks.size, changed: 1, added: id });
    return t;
  }

  async probe(file) {
    if (!this.ffprobe) return {};
    const r = await run(this.ffprobe, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file], { timeout: 20000 });
    try { return JSON.parse(r.out); } catch { return {}; }
  }

  build(id, file, st, probe, old) {
    const fmt = probe.format || {};
    const streams = probe.streams || [];
    const tags = {};
    const addTags = (o) => { for (const [k, v] of Object.entries(o || {})) { const kk = k.toLowerCase(); if (!(kk in tags)) tags[kk] = v; } };
    addTags(fmt.tags);
    for (const s of streams) addTags(s.tags);   // ogg/opus guardan las etiquetas en el stream
    const audio = streams.find((s) => s.codec_type === 'audio') || {};
    const pic = streams.find((s) => s.codec_type === 'video' && s.disposition && s.disposition.attached_pic);
    const realVideo = streams.find((s) => s.codec_type === 'video' && !(s.disposition && s.disposition.attached_pic));
    const base = path.basename(file, path.extname(file));
    // si no hay etiquetas, intentar "Artista - Título" desde el nombre
    let fnArtist = '', fnTitle = base;
    const dash = base.indexOf(' - ');
    if (dash > 0) { fnArtist = base.slice(0, dash).trim(); fnTitle = base.slice(dash + 3).trim(); }
    const num = (v) => { const n = parseInt(String(v || '').split('/')[0], 10); return Number.isFinite(n) ? n : null; };
    const year = (() => { const m = /(\d{4})/.exec(tags.date || tags.year || tags.originaldate || ''); return m ? +m[1] : null; })();
    return {
      id, path: file, folder: path.dirname(file), name: path.basename(file),
      ext: path.extname(file).slice(1).toLowerCase(),
      size: st.size, mtime: st.mtimeMs,
      added: old && old.added ? old.added : Math.round(st.birthtimeMs || st.mtimeMs),
      title: (tags.title || fnTitle || base).trim(),
      artist: (tags.artist || tags.album_artist || tags.albumartist || fnArtist || '').trim(),
      albumArtist: (tags.album_artist || tags.albumartist || '').trim(),
      album: (tags.album || '').trim(),
      // yt-dlp guarda la categoría de YouTube ("Music", "People & Blogs"…) como género: eso no es un género real
      genre: YT_CATEGORIES.has((tags.genre || '').trim().toLowerCase()) ? '' : (tags.genre || '').trim(),
      year,
      trackNo: num(tags.track), discNo: num(tags.disc),
      duration: +fmt.duration || 0,
      bitrate: Math.round((+fmt.bit_rate || +audio.bit_rate || 0) / 1000),
      codec: audio.codec_name || '',
      sampleRate: +audio.sample_rate || 0,
      channels: audio.channels || 0,
      video: !!realVideo && VIDEO_EXT.has(path.extname(file).toLowerCase()),
      hasCover: !!pic,
      hasLyricsTag: Object.keys(tags).some((k) => k.startsWith('lyrics') || k === 'unsyncedlyrics'),
      // ID de YouTube (lo guarda yt-dlp en purl/comment): sirve para letras, radio y "me gusta" de YouTube Music
      ytId: ytIdFrom(tags.purl, tags.comment, tags.description, tags.synopsis),
    };
  }

  // ---------- carátulas ----------
  coverPath(id) { return path.join(this.coverDir, id + '.jpg'); }
  async cover(id) {
    const t = this.tracks.get(id);
    if (!t) return null;
    const dst = this.coverPath(id);
    if (fs.existsSync(dst)) return dst;
    if (this.noCover.has(id)) return null;
    if (this.coverPending.has(id)) return this.coverPending.get(id);
    const job = (async () => {
      if ((t.hasCover || t.video) && this.ffmpeg) {
        const args = t.video
          ? ['-y', '-v', 'error', '-ss', '3', '-i', t.path, '-vf', 'thumbnail=40,scale=512:-2', '-frames:v', '1', dst]
          : ['-y', '-v', 'error', '-i', t.path, '-map', '0:v:0', '-vf', 'scale=512:-2', '-frames:v', '1', dst];
        await this.coverQ.run(() => run(this.ffmpeg, args, { timeout: 20000 }));
        if (fs.existsSync(dst)) return dst;
      }
      // portada suelta en la carpeta del álbum
      for (const n of COVER_NAMES) {
        const f = path.join(t.folder, n);
        if (fs.existsSync(f)) return f;
      }
      this.noCover.add(id);
      return null;
    })().finally(() => this.coverPending.delete(id));
    this.coverPending.set(id, job);
    return job;
  }

  // ---------- duplicados ----------
  duplicates() {
    const groups = new Map();
    for (const t of this.tracks.values()) {
      const key = normalize(t.artist) + '|' + normalize(t.title);
      if (!normalize(t.title)) continue;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(t);
    }
    const out = [];
    for (const list of groups.values()) {
      if (list.length < 2) continue;
      // separar versiones distintas (p. ej. "slowed" de 4 min vs original de 3 min)
      list.sort((a, b) => a.duration - b.duration);
      let cluster = [list[0]];
      const flush = () => { if (cluster.length > 1) out.push(cluster.map((t) => t.id)); };
      for (let i = 1; i < list.length; i++) {
        if (Math.abs(list[i].duration - cluster[cluster.length - 1].duration) <= 3) cluster.push(list[i]);
        else { flush(); cluster = [list[i]]; }
      }
      flush();
    }
    return out;
  }

  // ---------- edición de etiquetas (ffmpeg, sin recodificar) ----------
  async editMeta(id, fields) {
    const t = this.tracks.get(id);
    if (!t) throw new Error('No existe esa canción');
    if (!this.ffmpeg) throw new Error('Necesito ffmpeg para editar etiquetas');
    if (['wav', 'aac'].includes(t.ext)) throw new Error(`Los archivos .${t.ext} no guardan bien etiquetas`);
    const allowed = { title: 'title', artist: 'artist', album: 'album', albumArtist: 'album_artist', genre: 'genre', year: 'date', trackNo: 'track' };
    const meta = [];
    for (const [k, tag] of Object.entries(allowed)) {
      if (!(k in fields)) continue;
      const v = String(fields[k] == null ? '' : fields[k]).replace(/[\r\n]+/g, ' ').slice(0, 300);
      meta.push('-metadata', `${tag}=${v}`);
    }
    if (!meta.length) return t;
    const tmp = path.join(t.folder, `.pw-edit-${id}.${t.ext}`);
    const args = ['-y', '-v', 'error', '-i', t.path, '-map', '0', '-c', 'copy', ...meta];
    if (t.ext === 'mp3') args.push('-id3v2_version', '3', '-write_id3v1', '1');
    args.push(tmp);
    const r = await run(this.ffmpeg, args, { timeout: 120000 });
    if (r.code !== 0 || !fs.existsSync(tmp)) {
      try { fs.unlinkSync(tmp); } catch {}
      throw new Error('ffmpeg no pudo escribir las etiquetas: ' + (r.err.split('\n').filter(Boolean).pop() || r.code));
    }
    await fsp.rename(tmp, t.path);   // reemplazo atómico
    try { fs.unlinkSync(this.coverPath(id)); } catch {}
    return this.addFile(t.path);
  }

  // mueve a la papelera de reciclaje (se puede recuperar)
  async trash(id) {
    const t = this.tracks.get(id);
    if (!t) throw new Error('No existe esa canción');
    if (IS_WIN) {
      const ps = `Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($env:PW_FILE, 'OnlyErrorDialogs', 'SendToRecycleBin')`;
      const r = await run('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { env: { ...process.env, PW_FILE: t.path }, timeout: 30000 });
      if (fs.existsSync(t.path)) throw new Error('No se pudo mover a la papelera. ' + r.err.trim());
    } else throw new Error('Solo disponible en Windows');
    this.tracks.delete(id);
    try { fs.unlinkSync(this.coverPath(id)); } catch {}
    this.store.data.tracks = this.list();
    this.store.save();
    this.broadcast('library', { count: this.tracks.size, changed: 1, removed: id });
    return true;
  }

  // ---------- vigilar carpetas ----------
  watch() {
    for (const w of this.watchers) try { w.close(); } catch {}
    this.watchers = [];
    for (const f of this.getFolders()) {
      try {
        const w = fs.watch(f, { recursive: true }, (ev, name) => {
          if (!name || /(^|[\\/])\./.test(name)) return;        // ignorar .tmp, .covers, .pw-edit
          const ext = path.extname(String(name)).toLowerCase();
          if (ext && !AUDIO_EXT.has(ext) && !VIDEO_EXT.has(ext)) return;
          clearTimeout(this.rescanTimer);
          this.rescanTimer = setTimeout(() => this.scan(), 2500);
        });
        w.on('error', () => {});
        this.watchers.push(w);
      } catch {}
    }
  }
}

module.exports = { Library };
