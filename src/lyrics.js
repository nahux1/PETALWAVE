// letras, sin necesidad de archivos .lrc:
//   1) .lrc/.txt junto al archivo (si el usuario tiene uno)   2) etiqueta de letra dentro del archivo
//   3) YouTube Music (por el ID del video, o buscando la canción oficial)   4) LRCLIB (base abierta)
// Sirve para canciones locales y para las que suenan online (ids yt_…). Limpia los títulos de YouTube
// ("(Official Video)", "Artista - Tema", "slowed", etc.) y, si la canción es una versión slowed / sped up,
// estira las marcas de tiempo para que la letra sincronizada siga coincidiendo.
'use strict';
const fs = require('fs');
const path = require('path');
const { run } = require('./util');

const SYNC_RE = /\[\d{1,2}:\d{2}(?:[.:]\d{1,3})?\]/;
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const NOISE = /[([][^)\]]*(official|video|audio|lyric|letra|visuali[sz]er|music video|\bmv\b|\bhd\b|\b4k\b|remaster|clip|videoclip|en vivo|live session)[^)\]]*[)\]]/gi;
const EDIT = /[([][^)\]]*(slowed|reverb|sped|speed ?up|nightcore|bass ?boost|8d|daycore|tiktok)[^)\]]*[)\]]|\b(slowed( \+ reverb)?|sped up|nightcore)\b/gi;

// candidatos {title, artist} a partir de los metadatos (los títulos de YouTube vienen muy sucios)
function candidates(t) {
  let artist = String(t.artist || '').replace(/\s*-\s*topic$/i, '').replace(/vevo$/i, '').replace(/\s*official$/i, '').trim();
  let title = String(t.title || '').replace(/【[^】]*】|「|」/g, ' ').replace(NOISE, '').replace(/[([][^)\]]*\b(cover|extended|remix by|edit)\b[^)\]]*[)\]]/gi, '').replace(/\s*[|｜].*$/, '').replace(/["“”]/g, '').trim();
  const edited = EDIT.test(title) || EDIT.test(t.title || ''); EDIT.lastIndex = 0;
  title = title.replace(EDIT, '').replace(/\(\s*\)|\[\s*\]/g, '').replace(/\s{2,}/g, ' ').trim();
  title = title.replace(/\s+(ft\.?|feat\.?|prod\.?)\s.*$/i, '').trim();
  const out = [];
  const add = (ti, ar) => { ti = ti.replace(/^[\s\-–—]+|[\s\-–—]+$/g, '').trim(); ar = String(ar || '').split(/,|&| x | y | feat\.? | ft\.? /i)[0].trim(); if (ti && !out.some((c) => norm(c.title) === norm(ti) && norm(c.artist) === norm(ar))) out.push({ title: ti, artist: ar }); };
  const parts = title.split(/\s+[-–—]\s+/);
  if (parts.length >= 2) {
    const [a, ...rest] = parts, b = rest.join(' - ');
    const na = norm(a), nb = norm(b), nr = norm(artist);
    const isA = nr && (na.includes(nr) || nr.includes(na)), isB = nr && (nb.includes(nr) || nr.includes(nb));
    if (isA) add(b, a);                       // "Artista - Tema" y el canal es el artista
    else if (isB) add(a, b);                  // "Tema - Artista"
    else { add(b, a); add(a, b); if (artist) add(a, artist), add(b, artist); }
  }
  add(title, artist);
  return { list: out.slice(0, 4), edited };
}

// estira las marcas de tiempo de un LRC (versión slowed / sped up)
function rescale(text, k) {
  if (!k || Math.abs(k - 1) < 0.04) return text;
  return text.replace(/\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g, (_, m, s, f) => {
    const ms = Math.round(((+m * 60 + +s) * 1000 + (f ? +String(f).padEnd(3, '0') : 0)) * k);
    return `[${String(Math.floor(ms / 60000)).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}.${String(Math.floor((ms % 1000) / 10)).padStart(2, '0')}]`;
  });
}

async function getJson(url, ms = 8000) {
  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'petalwave (https://github.com/)' }, signal: ctl.signal });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally { clearTimeout(to); }
}

class Lyrics {
  constructor({ dataDir, library, ffprobe, settings, ytm }) {
    Object.assign(this, { library, ffprobe, settings, ytm });
    this.cacheDir = path.join(dataDir, 'lyrics');
    fs.mkdirSync(this.cacheDir, { recursive: true });
    this.inflight = new Map();
  }

  sidecar(t) {
    if (!t.path) return null;
    const base = t.path.slice(0, -(t.ext.length + 1));
    for (const ext of ['.lrc', '.txt']) {
      const f = base + ext;
      if (fs.existsSync(f)) {
        const text = fs.readFileSync(f, 'utf8').replace(/^﻿/, '');
        return { source: 'archivo ' + path.basename(f), synced: SYNC_RE.test(text), text };
      }
    }
    return null;
  }

  async embedded(t) {
    if (!t.path || !t.hasLyricsTag || !this.ffprobe) return null;
    const r = await run(this.ffprobe, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', t.path], { timeout: 15000 });
    try {
      const j = JSON.parse(r.out);
      const all = { ...(j.format && j.format.tags) };
      for (const s of j.streams || []) Object.assign(all, s.tags);
      const key = Object.keys(all).find((k) => /^(lyrics|unsyncedlyrics)/i.test(k));
      if (!key) return null;
      const text = String(all[key]);
      return { source: 'etiqueta del archivo', synced: SYNC_RE.test(text), text };
    } catch { return null; }
  }

  // caché en disco: lo encontrado se guarda para siempre; "no hay" se reintenta a los 3 días
  cache(key, fn) {
    const file = path.join(this.cacheDir, 'v2-' + key.replace(/[^\w-]/g, '_') + '.json');
    if (fs.existsSync(file)) {
      try { const c = JSON.parse(fs.readFileSync(file, 'utf8')); if (c.text || Date.now() - c.at < 3 * 864e5) return Promise.resolve(c.text ? c : null); } catch {}
    }
    if (this.inflight.has(file)) return this.inflight.get(file);
    const p = (async () => {
      let res = null;
      try { res = await fn(); } catch { return null; }   // error de red: no cachear
      try { fs.writeFileSync(file, JSON.stringify(res ? { ...res, at: Date.now() } : { at: Date.now() })); } catch {}
      return res;
    })().finally(() => this.inflight.delete(file));
    this.inflight.set(file, p);
    return p;
  }

  // YouTube Music: primero el video exacto; si no tiene letra (videos subidos, versiones editadas), busca la canción oficial
  async fromYtm(t, cand) {
    if (!this.ytm || !this.ytm.available()) return null;
    const c0 = cand.list[0];
    const q = c0 ? `${c0.title} ${c0.artist}`.trim() : '';
    if (!t.ytId && !q) return null;
    return this.cache('ytm-' + (t.ytId || t.id), async () => {
      const r = await this.ytm.call('lyrics', { videoId: t.ytId || null, q, duration: t.duration || 0 }, { timeout: 30000 });
      if (!r || !r.text) return null;
      let text = r.text;
      if (r.synced && r.matched && cand.edited && r.duration && t.duration) text = rescale(text, t.duration / r.duration);
      return { source: r.source + (r.matched ? ' · canción oficial' : ''), synced: !!r.synced, text };
    });
  }

  // LRCLIB: coincidencia exacta y, si no, búsqueda por cada candidato; elige la sincronizada de duración más parecida
  async fromLrclib(t, cand) {
    if (!cand.list.length) return null;
    return this.cache('lrclib-' + t.id, async () => {
      const d = Math.round(t.duration || 0);
      const pick = (arr) => {
        const ok = (arr || []).filter((x) => x && (x.syncedLyrics || x.plainLyrics) && !x.instrumental);
        if (!ok.length) return null;
        const score = (x) => (x.syncedLyrics ? 0 : 40) + (d && !cand.edited ? Math.min(60, Math.abs((x.duration || 0) - d)) : 0);
        return ok.sort((a, b) => score(a) - score(b))[0];
      };
      let hit = null;
      const c0 = cand.list[0];
      if (d && !cand.edited) {
        const q = new URLSearchParams({ track_name: c0.title, artist_name: c0.artist || '', duration: String(d) });
        if (t.album) q.set('album_name', t.album);
        hit = pick([await getJson('https://lrclib.net/api/get?' + q)]);
      }
      for (const c of cand.list) {
        if (hit) break;
        const q = new URLSearchParams({ track_name: c.title });
        if (c.artist) q.set('artist_name', c.artist);
        hit = pick(await getJson('https://lrclib.net/api/search?' + q));
      }
      if (!hit) hit = pick(await getJson('https://lrclib.net/api/search?' + new URLSearchParams({ q: `${c0.title} ${c0.artist}`.trim() })));
      if (!hit) return null;
      let text = hit.syncedLyrics || hit.plainLyrics;
      if (hit.syncedLyrics && cand.edited && d && hit.duration) text = rescale(text, d / hit.duration);
      return { source: `LRCLIB · ${hit.artistName} — ${hit.trackName}`, synced: !!hit.syncedLyrics, text };
    });
  }

  // id: pista local (hex16) o remota (yt_<videoId>, con título/artista/duración que manda la interfaz)
  async get(id, meta = {}) {
    let t;
    if (/^yt_[\w-]{11}$/.test(id)) t = { id, ytId: id.slice(3), title: meta.title, artist: meta.artist, album: meta.album, duration: +meta.duration || 0 };
    else t = this.library.get(id);
    if (!t) return { error: 'No existe esa canción' };
    const s = this.sidecar(t) || (await this.embedded(t));
    if (s) return s;
    const S = this.settings();
    const cand = candidates(t);
    const order = [];
    if (S.lyricsYtm !== false) order.push(() => this.fromYtm(t, cand));
    if (S.lyricsOnline !== false) order.push(() => this.fromLrclib(t, cand));
    // la primera sincronizada gana; si solo hay texto plano, se usa el primero que aparezca
    let plain = null;
    for (const f of order) { const r = await f(); if (r && r.synced) return r; if (r && !plain) plain = r; }
    if (plain) return plain;
    return { none: true, online: S.lyricsOnline !== false, ytm: S.lyricsYtm !== false, ytId: !!t.ytId, tried: cand.list.slice(0, 2) };
  }

  // guardar un .lrc arrastrado a la ventana como letra de la canción
  saveSidecar(id, text) {
    const t = this.library.get(id);
    if (!t) throw new Error('No existe esa canción');
    const f = t.path.slice(0, -(t.ext.length + 1)) + '.lrc';
    fs.writeFileSync(f, text);
    return { source: 'archivo ' + path.basename(f), synced: SYNC_RE.test(text), text };
  }
}

module.exports = { Lyrics, candidates, rescale };
