// sincronización con YouTube Music usando la sesión propia del usuario (cookies.txt) vía yt-dlp.
// No hay API oficial pública para la biblioteca personal de YouTube Music: esto lee lo mismo que ve el usuario
// en su cuenta, con su propia sesión, y nunca esquiva DRM ni restricciones de acceso.
'use strict';
const fs = require('fs');
const path = require('path');
const { run, normalize, YT_JS } = require('./util');

const LIKED_URL = 'https://music.youtube.com/playlist?list=LM';
const plId = (url) => { try { return new URL(url).searchParams.get('list'); } catch { return null; } };
const toMusicUrl = (url) => { const id = plId(url); return id ? `https://music.youtube.com/playlist?list=${id}` : url; };

class Sync {
  constructor({ root, ytdlp, cookiesTxt, downloads, library, broadcast }) {
    Object.assign(this, { ytdlp, cookiesTxt, downloads, library, broadcast });
    this.file = path.join(root, 'sync.json');
    this.cfg = this.load();
    this.state = { running: false, current: null, jobId: null, queue: [], cancel: false, lastRun: this.cfg.lastRun || 0, lastResult: this.cfg.lastResult || null };
    setInterval(() => {
      if (this.cfg.auto > 0 && !this.state.running && fs.existsSync(this.cookiesTxt) && Date.now() - this.state.lastRun >= this.cfg.auto * 60000) this.run();
    }, 60000);
  }

  load() {
    let s = {};
    try { s = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch {}
    if (!Array.isArray(s.sources)) s.sources = [{ id: 'liked', name: '❤ Me gusta', url: LIKED_URL, enabled: true, liked: true }];
    if (typeof s.auto !== 'number') s.auto = 0;
    if (!['mp3', 'mp4', 'm4a', 'opus'].includes(s.format)) s.format = 'mp3';
    if (!s.quality) s.quality = '320';
    return s;
  }
  save() { try { fs.writeFileSync(this.file, JSON.stringify(this.cfg, null, 2)); } catch {} }
  view(extra = {}) { return { ...this.cfg, state: this.state, hasCookies: fs.existsSync(this.cookiesTxt), ...extra }; }
  notify() { this.broadcast('sync', this.view()); }

  update(b) {
    if (typeof b.auto === 'number') this.cfg.auto = Math.max(0, Math.min(1440, b.auto | 0));
    if (['mp3', 'mp4', 'm4a', 'opus'].includes(b.format)) this.cfg.format = b.format;
    if (b.quality) this.cfg.quality = String(b.quality);
    if (b.add) {
      const url = String(b.add.url || '').trim();
      if (!plId(url)) throw new Error('Pegá el link de una playlist (tiene que tener "list=").');
      const mu = toMusicUrl(url);
      if (this.cfg.sources.some((s) => toMusicUrl(s.url) === mu)) throw new Error('Esa playlist ya está en la lista.');
      const src = { id: 'pl' + Date.now().toString(36), name: String(b.add.name || 'playlist ' + plId(url)).slice(0, 80), url: mu, enabled: true };
      this.cfg.sources.push(src);
      if (!b.add.name) this.fetchTitle(src);
    }
    if (b.toggle) { const s = this.cfg.sources.find((x) => x.id === b.toggle); if (s) s.enabled = !s.enabled; }
    if (b.remove) this.cfg.sources = this.cfg.sources.filter((x) => x.id !== b.remove || x.liked);
    this.save();
    this.notify();
  }

  async run(onlyId) {
    if (this.state.running || !this.ytdlp) return false;
    const list = this.cfg.sources.filter((s) => (onlyId ? s.id === onlyId : s.enabled));
    if (!list.length) return false;
    Object.assign(this.state, { running: true, cancel: false, queue: list.map((s) => s.id) });
    this.notify();
    let added = 0, failed = 0, stopped = false;
    for (const src of list) {
      if (this.state.cancel) { stopped = true; break; }
      this.state.current = src.id;
      const job = this.downloads.add({
        url: src.url, format: this.cfg.format, quality: this.cfg.quality, playlist: true, cookies: 'txt',
        sync: { label: `⟳ ${src.name}`, breakOnExisting: !!src.liked },
      });
      this.state.jobId = job.id;
      this.notify();
      await job.finished;
      added += job.files.length;
      this.state.queue.shift();
      if (job.cancelled) { stopped = true; break; }
      Object.assign(src, { last: Date.now(), lastAdded: job.files.length, lastStatus: job.status });
      if (job.status !== 'completado') failed++;
      this.save();
    }
    Object.assign(this.state, { running: false, current: null, jobId: null, cancel: false, queue: [] });
    this.state.lastRun = this.cfg.lastRun = Date.now();
    this.state.lastResult = this.cfg.lastResult = { added, failed, stopped };
    this.save();
    this.notify();
    return true;
  }

  stop() {
    if (!this.state.running) return;
    this.state.cancel = true;
    if (this.state.jobId) this.downloads.cancel(this.state.jobId);
    this.notify();
  }

  async fetchTitle(src) {
    if (!this.ytdlp) return;
    const args = ['--flat-playlist', '--playlist-end', '1', '--print', 'playlist:%(title)s', '--encoding', 'utf-8'];
    if (fs.existsSync(this.cookiesTxt)) args.push('--cookies', this.cookiesTxt);
    const r = await run(this.ytdlp, [...YT_JS, ...args, src.url], { timeout: 60000 });
    const t = r.out.split(/\r?\n/).map((l) => l.trim()).find((l) => l && l !== 'NA');
    if (t) { src.name = t.replace(/^Album - /, '💿 ').slice(0, 80); this.save(); this.notify(); }
  }

  async discover() {
    if (!this.ytdlp || !fs.existsSync(this.cookiesTxt)) return { error: 'Necesitás cargar cookies.txt primero (botón 🍪).' };
    const r = await run(this.ytdlp, [...YT_JS, '--flat-playlist', '-J', '--encoding', 'utf-8', '--cookies', this.cookiesTxt, 'https://www.youtube.com/feed/playlists'], { timeout: 90000 });
    try {
      const j = JSON.parse(r.out);
      return { playlists: (j.entries || []).filter((e) => e.url && plId(e.url)).map((e) => ({ name: e.title || plId(e.url), url: toMusicUrl(e.url), count: e.playlist_count || null })) };
    } catch {
      return { error: /not a bot|429/i.test(r.err) ? 'YouTube bloqueó el pedido: exportá cookies.txt de nuevo.' : 'No pude leer tus playlists. ' + (r.err.split('\n').find((l) => l.startsWith('ERROR')) || '') };
    }
  }

  // lee una playlist (nombres, artistas, duración) y marca cuáles ya están en la biblioteca local
  async inspect(url) {
    if (!this.ytdlp) return { error: 'yt-dlp no encontrado' };
    if (!plId(url)) return { error: 'Pegá el link de una playlist o álbum (tiene que tener "list=").' };
    const args = ['--flat-playlist', '-J', '--encoding', 'utf-8'];
    if (fs.existsSync(this.cookiesTxt)) args.push('--cookies', this.cookiesTxt);
    const r = await run(this.ytdlp, [...YT_JS, ...args, toMusicUrl(url)], { timeout: 120000 });
    let j;
    try { j = JSON.parse(r.out); } catch {
      return { error: /not a bot|429/i.test(r.err) ? 'YouTube bloqueó el pedido: cargá cookies.txt (o exportalo de nuevo).' : 'No pude leer esa playlist. ' + (r.err.split('\n').find((l) => l.startsWith('ERROR')) || '') };
    }
    // índice local por título normalizado
    const local = this.library.list();
    const byTitle = new Map();
    for (const t of local) {
      const k = normalize(t.title);
      if (!byTitle.has(k)) byTitle.set(k, []);
      byTitle.get(k).push(t);
    }
    const entries = (j.entries || []).map((e) => {
      const title = e.title || '';
      const artist = e.artists ? e.artists.join(', ') : (e.channel || e.uploader || '').replace(/ - Topic$/, '');
      const nt = normalize(title), na = normalize(artist);
      let cands = byTitle.get(nt) || [];
      // también "Artista - Título" como título en el archivo local
      if (!cands.length) cands = local.filter((t) => { const lt = normalize(t.title); return lt && (lt.endsWith(nt) || nt.endsWith(lt)) && Math.min(lt.length, nt.length) > 3; });
      let match = cands.find((t) => !na || normalize(t.artist).includes(na) || na.includes(normalize(t.artist)) || normalize(t.name).includes(na));
      if (!match && cands.length === 1 && e.duration && Math.abs(cands[0].duration - e.duration) < 6) match = cands[0];
      return { title, artist, duration: e.duration || 0, url: e.url || (e.id ? `https://music.youtube.com/watch?v=${e.id}` : ''), match: match ? match.id : null };
    });
    return { title: (j.title || '').replace(/^Album - /, ''), url: toMusicUrl(url), entries, have: entries.filter((e) => e.match).length };
  }
}

module.exports = { Sync };
