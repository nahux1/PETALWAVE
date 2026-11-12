// estadísticas de escucha y recomendaciones locales (todo calculado con tu propia biblioteca e historial)
'use strict';
const path = require('path');
const { JsonStore, normalize } = require('./util');

const dayKey = (ts) => { const d = new Date(ts); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const mainArtist = (t) => (t.albumArtist || t.artist || '').split(/\s*(?:,|&| feat\.? | ft\.? | x | y )\s*/i)[0].trim();

class Stats {
  constructor({ dataDir, library }) {
    this.library = library;
    this.store = new JsonStore(path.join(dataDir, 'stats.json'), () => ({ tracks: {}, days: {}, log: [] }));
  }

  // una "escucha" se registra al terminar o cambiar de canción, con los segundos reales escuchados
  record({ id, seconds, duration, completed }) {
    const t = this.library.get(id);
    if (!t || !(seconds > 0)) return;
    seconds = Math.min(seconds, (duration || t.duration || seconds) + 5, 6 * 3600);
    const d = this.store.data;
    const s = d.tracks[id] || (d.tracks[id] = { plays: 0, seconds: 0, first: Date.now(), last: 0, skips: 0 });
    s.seconds += seconds;
    const dur = duration || t.duration || 0;
    const counted = completed || seconds >= Math.min(30, dur * 0.5 || 30);
    if (counted) { s.plays++; s.last = Date.now(); } else if (seconds < 15) s.skips++;
    const k = dayKey(Date.now());
    d.days[k] = (d.days[k] || 0) + seconds;
    if (counted) { d.log.push([Date.now(), id, Math.round(seconds)]); if (d.log.length > 8000) d.log.splice(0, d.log.length - 8000); }
    this.store.save();
  }

  plays(id) { const s = this.store.data.tracks[id]; return s ? s.plays : 0; }
  playCounts() { const o = {}; for (const [id, s] of Object.entries(this.store.data.tracks)) o[id] = s.plays; return o; }

  summary(range = 'month') {
    const now = Date.now();
    const since = range === 'week' ? now - 7 * 864e5 : range === 'month' ? now - 30 * 864e5 : 0;
    const d = this.store.data;
    const log = d.log.filter((e) => e[0] >= since);
    const perTrack = new Map(), perArtist = new Map(), perAlbum = new Map();
    let seconds = 0;
    for (const [, id, sec] of log) {
      const t = this.library.get(id); if (!t) continue;
      seconds += sec;
      const pt = perTrack.get(id) || { id, plays: 0, seconds: 0 }; pt.plays++; pt.seconds += sec; perTrack.set(id, pt);
      const a = mainArtist(t) || '—';
      const pa = perArtist.get(a) || { name: a, plays: 0, seconds: 0, cover: id }; pa.plays++; pa.seconds += sec; perArtist.set(a, pa);
      if (t.album) {
        const ak = t.album + '\u0000' + (t.albumArtist || t.artist);
        const pb = perAlbum.get(ak) || { name: t.album, artist: t.albumArtist || t.artist, plays: 0, seconds: 0, cover: id }; pb.plays++; pb.seconds += sec; perAlbum.set(ak, pb);
      }
    }
    const top = (m) => [...m.values()].sort((a, b) => b.plays - a.plays || b.seconds - a.seconds).slice(0, 15);
    // gráfico por día (7 o 30 días) o por mes (todo)
    const chart = [];
    if (range === 'all') {
      const months = {};
      for (const [k, v] of Object.entries(d.days)) { const m = k.slice(0, 7); months[m] = (months[m] || 0) + v; }
      const keys = Object.keys(months).sort().slice(-12);
      for (const k of keys) chart.push({ label: k, seconds: Math.round(months[k]) });
    } else {
      const n = range === 'week' ? 7 : 30;
      for (let i = n - 1; i >= 0; i--) { const k = dayKey(now - i * 864e5); chart.push({ label: k.slice(5), seconds: Math.round(d.days[k] || 0) }); }
    }
    const totalAll = Object.values(d.days).reduce((a, b) => a + b, 0);
    return {
      range, plays: log.length, seconds: Math.round(seconds), totalSeconds: Math.round(totalAll),
      distinct: perTrack.size, artists: perArtist.size,
      topTracks: top(perTrack), topArtists: top(perArtist), topAlbums: top(perAlbum), chart,
    };
  }

  // ---------- recomendaciones ----------
  // similitud: mismo artista, mismo álbum, mismo género, años cercanos y "se escucharon juntas"
  similar(seedId, n = 25) {
    const seed = this.library.get(seedId);
    if (!seed) return [];
    const log = this.store.data.log;
    const co = new Map();
    for (let i = 0; i < log.length; i++) {
      if (log[i][1] !== seedId) continue;
      for (let j = Math.max(0, i - 3); j <= Math.min(log.length - 1, i + 3); j++) {
        if (j !== i && Math.abs(log[j][0] - log[i][0]) < 3 * 3600e3) co.set(log[j][1], (co.get(log[j][1]) || 0) + 1);
      }
    }
    const sa = normalize(mainArtist(seed)), sg = normalize(seed.genre), salb = normalize(seed.album);
    const scored = [];
    for (const t of this.library.list()) {
      if (t.id === seedId || t.video) continue;
      let s = 0;
      const a = normalize(mainArtist(t));
      if (sa && a === sa) s += 3;
      else if (sa && normalize(t.artist).includes(sa)) s += 2;
      if (salb && normalize(t.album) === salb) s += 1.5;
      if (sg && normalize(t.genre) === sg) s += 1.5;
      if (seed.year && t.year && Math.abs(seed.year - t.year) <= 3) s += 0.6;
      s += Math.min(4, (co.get(t.id) || 0) * 1.5);
      // palabras en común en el título (remix/slowed/phonk…)
      const tw = new Set(normalize(t.title + ' ' + t.name).split(' ').filter((w) => w.length > 4));
      for (const w of normalize(seed.title + ' ' + seed.name).split(' ')) if (w.length > 4 && tw.has(w)) s += 0.4;
      if (s > 0) scored.push([s + Math.random() * 0.5, t.id]);
    }
    scored.sort((a, b) => b[0] - a[0]);
    return scored.slice(0, n).map((x) => x[1]);
  }

  autoPlaylists() {
    const lib = this.library.list().filter((t) => !t.video);
    const st = this.store.data.tracks;
    const now = Date.now();
    const out = [];
    const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
    const top = lib.filter((t) => st[t.id] && st[t.id].plays > 0).sort((a, b) => st[b.id].plays - st[a.id].plays).slice(0, 50);
    if (top.length) out.push({ id: 'auto:top', name: '🔥 Más escuchadas', desc: 'tus canciones con más reproducciones', tracks: top.map((t) => t.id) });
    const recent = [...lib].sort((a, b) => b.added - a.added).slice(0, 50);
    if (recent.length) out.push({ id: 'auto:recent', name: '✦ Recién agregadas', desc: 'lo último que entró a la biblioteca', tracks: recent.map((t) => t.id) });
    const forgotten = lib.filter((t) => st[t.id] && st[t.id].plays >= 2 && now - st[t.id].last > 30 * 864e5);
    if (forgotten.length >= 3) out.push({ id: 'auto:forgotten', name: '↺ Redescubrir', desc: 'te gustaban y hace más de un mes que no suenan', tracks: shuffle(forgotten).slice(0, 40).map((t) => t.id) });
    const never = lib.filter((t) => !st[t.id] || !st[t.id].plays);
    if (never.length >= 3) out.push({ id: 'auto:never', name: '◌ Sin escuchar', desc: 'canciones que todavía no reproduciste', tracks: shuffle(never).slice(0, 50).map((t) => t.id) });
    // "para vos": mezcla de tus artistas frecuentes + similares
    const sum = this.summary('month');
    const seeds = sum.topTracks.slice(0, 5).map((x) => x.id);
    if (seeds.length) {
      const mix = new Set();
      for (const s of seeds) { mix.add(s); for (const id of this.similar(s, 8)) mix.add(id); }
      out.unshift({ id: 'auto:foryou', name: '❀ Para vos', desc: 'tus favoritas del mes y canciones parecidas', tracks: shuffle([...mix]).slice(0, 50) });
    }
    for (const a of sum.topArtists.slice(0, 3)) {
      const na = normalize(a.name);
      const tr = lib.filter((t) => normalize(t.artist).includes(na));
      if (tr.length >= 2) out.push({ id: 'auto:artist:' + na, name: '♫ Mix ' + a.name, desc: 'artista frecuente', tracks: shuffle(tr.map((t) => t.id)).slice(0, 40) });
    }
    const genres = new Map();
    for (const t of lib) if (t.genre) { const g = t.genre.split(/[;,/]/)[0].trim(); if (!genres.has(g)) genres.set(g, []); genres.get(g).push(t.id); }
    for (const [g, ids] of [...genres.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 4)) {
      if (ids.length >= 4) out.push({ id: 'auto:genre:' + normalize(g), name: '◈ ' + g, desc: 'por género', tracks: shuffle(ids).slice(0, 50) });
    }
    return out;
  }
}

module.exports = { Stats, mainArtist };
