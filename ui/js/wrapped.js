// "Tu año en Petalwave": un resumen de tu año en una imagen tipo historia (1080×1920) para guardar o compartir.
// Junta las estadísticas de tu biblioteca (/api/stats?range=year) con lo que escuchaste online (señales de taste.js).
import { api, esc, toast, modal, fmtLong, coverUrl } from './core.js';
import { D, T, mainArtist } from './data.js';
import { tasteEvents, profile, SLOTS } from './taste.js';

const W = 1080, H = 1920;
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

export async function yearData() {
  const year = new Date().getFullYear();
  const since = new Date(year, 0, 1).getTime();
  let s = { seconds: 0, plays: 0, topTracks: [], topArtists: [] };
  try { s = await api.get('/api/stats?range=year'); } catch {}
  // canciones: las de tu biblioteca + las que escuchaste online (no están en las estadísticas de la biblioteca)
  const songs = new Map((s.topTracks || []).map((x) => [x.id, { id: x.id, plays: x.plays, seconds: x.seconds }]));
  const artists = new Map((s.topArtists || []).map((x) => [x.name.toLowerCase(), { name: x.name, plays: x.plays, cover: x.cover }]));
  let seconds = s.seconds || 0, plays = s.plays || 0;
  const slots = {};
  const evs = tasteEvents().filter((e) => e.t >= since && e.k === 'play');
  for (const e of evs) {
    const slot = Object.keys(SLOTS).find((k) => { const h = new Date(e.t).getHours(); return h >= SLOTS[k].from && h < SLOTS[k].to; });
    slots[slot] = (slots[slot] || 0) + 1;
    const id = e.yt && !D.tracks.some((t) => t.id === e.id) ? 'yt_' + e.yt : e.id;
    if (!id || !id.startsWith('yt_')) continue;        // las de la biblioteca ya están en las estadísticas
    seconds += e.s || 0; plays++;
    const x = songs.get(id) || { id, plays: 0, seconds: 0, title: e.ti, artist: e.a }; x.plays++; x.seconds += e.s || 0; songs.set(id, x);
    const an = mainArtist({ artist: e.a }) || '—';
    const a = artists.get(an.toLowerCase()) || { name: an, plays: 0, cover: id }; a.plays++; artists.set(an.toLowerCase(), a);
  }
  const topSongs = [...songs.values()].sort((a, b) => b.plays - a.plays || b.seconds - a.seconds).slice(0, 5)
    .map((x) => { const t = T(x.id); return { id: x.id, title: t ? t.title : x.title || '—', artist: t ? t.artist : x.artist || '', plays: x.plays }; });
  const topArtists = [...artists.values()].sort((a, b) => b.plays - a.plays).slice(0, 5);
  const p = profile();
  const slot = Object.entries(slots).sort((a, b) => b[1] - a[1])[0];
  const liked = (D.playlists.find((x) => x.id === 'liked') || { tracks: [] }).tracks.length;
  return { year, seconds, plays, topSongs, topArtists, style: (p.topTags[0] || {}).name || '', slot: slot ? SLOTS[slot[0]].name : '', liked };
}

function loadImg(src) {
  return new Promise((ok) => { if (!src) return ok(null); const i = new Image(); i.onload = () => ok(i); i.onerror = () => ok(null); i.src = src; });
}
function fit(ctx, text, max) {
  if (ctx.measureText(text).width <= max) return text;
  let t = text; while (t.length > 1 && ctx.measureText(t + '…').width > max) t = t.slice(0, -1);
  return t + '…';
}
function petal(ctx, x, y, r, rot, color) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.fillStyle = color;
  for (let i = 0; i < 5; i++) { ctx.rotate((Math.PI * 2) / 5); ctx.beginPath(); ctx.ellipse(0, -r * 0.55, r * 0.32, r * 0.55, 0, 0, Math.PI * 2); ctx.fill(); }
  ctx.restore();
}

export async function drawYear(d) {
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  const ac = css('--ac') || '#f08a8f', ac2 = css('--ac2') || ac, deep = css('--deep') || '#0b0708', fg = css('--fg') || '#f3e9ea', dim = css('--dim') || '#a89a9b';
  try { await document.fonts.load('700 60px "Quicksand"'); await document.fonts.load('400 40px "JetBrains Mono"'); } catch {}
  const F = (w, px, fam = 'Quicksand') => `${w} ${px}px "${fam}", "JetBrains Mono", sans-serif`;
  // fondo
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, deep); g.addColorStop(0.55, deep); g.addColorStop(1, ac);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = 0.18;
  const rnd = (i) => ((Math.sin(i * 999) + 1) / 2);
  for (let i = 0; i < 18; i++) petal(ctx, rnd(i) * W, rnd(i + 50) * H, 30 + rnd(i + 9) * 70, rnd(i + 3) * 6, i % 2 ? ac : ac2);
  ctx.globalAlpha = 1;
  // título
  ctx.fillStyle = ac; ctx.font = F(700, 44, 'JetBrains Mono'); ctx.fillText('❀ PETALWAVE', 80, 140);
  ctx.fillStyle = fg; ctx.font = F(700, 96); ctx.fillText('Tu ' + d.year, 80, 270);
  ctx.font = F(500, 52); ctx.fillStyle = dim; ctx.fillText('en música', 80, 340);
  // minutos
  const mins = Math.round(d.seconds / 60);
  ctx.fillStyle = ac2; ctx.font = F(700, 150); ctx.fillText(mins.toLocaleString('es'), 80, 530);
  ctx.fillStyle = fg; ctx.font = F(500, 44); ctx.fillText('minutos escuchados · ' + d.plays + ' reproducciones', 80, 595);
  // canción del año
  let y = 690;
  const top = d.topSongs[0];
  if (top) {
    const img = await loadImg(coverUrl(top.id));
    ctx.fillStyle = dim; ctx.font = F(600, 38); ctx.fillText('TU CANCIÓN DEL AÑO', 80, y);
    if (img) { ctx.save(); ctx.beginPath(); ctx.roundRect(80, y + 30, 260, 260, 28); ctx.clip(); const s = Math.max(260 / img.width, 260 / img.height); ctx.drawImage(img, 80 + (260 - img.width * s) / 2, y + 30 + (260 - img.height * s) / 2, img.width * s, img.height * s); ctx.restore(); }
    ctx.fillStyle = fg; ctx.font = F(700, 58); ctx.fillText(fit(ctx, top.title, W - 460), 380, y + 130);
    ctx.fillStyle = dim; ctx.font = F(500, 42); ctx.fillText(fit(ctx, top.artist || '', W - 460), 380, y + 190);
    ctx.fillStyle = ac; ctx.font = F(600, 38); ctx.fillText(top.plays + ' veces', 380, y + 250);
    y += 360;
  }
  // tops
  const list = (title, items, x) => {
    ctx.fillStyle = dim; ctx.font = F(600, 36); ctx.fillText(title, x, y);
    items.forEach((it, i) => {
      ctx.fillStyle = ac2; ctx.font = F(700, 44); ctx.fillText(String(i + 1), x, y + 80 + i * 78);
      ctx.fillStyle = fg; ctx.font = F(600, 42); ctx.fillText(fit(ctx, it, 400), x + 50, y + 80 + i * 78);
    });
  };
  list('TUS ARTISTAS', d.topArtists.map((a) => a.name), 80);
  list('TUS CANCIONES', d.topSongs.map((s) => s.title), 560);
  y += 80 + 5 * 78 + 40;
  // detalles
  const facts = [d.style && ['tu estilo', d.style], d.slot && ['escuchás más', d.slot], d.liked && ['me gusta', d.liked + ' canciones']].filter(Boolean);
  facts.forEach(([k, v], i) => {
    const x = 80 + i * 320;
    ctx.fillStyle = dim; ctx.font = F(600, 32); ctx.fillText(k.toUpperCase(), x, y);
    ctx.fillStyle = fg; ctx.font = F(700, 46); ctx.fillText(fit(ctx, String(v), 290), x, y + 60);
  });
  ctx.fillStyle = fg; ctx.globalAlpha = 0.7; ctx.font = F(500, 34, 'JetBrains Mono'); ctx.fillText('hecho con Petalwave ❀', 80, H - 90); ctx.globalAlpha = 1;
  return cv;
}

export async function showYear() {
  toast('armando tu año…', { ms: 1200 });
  const d = await yearData();
  if (!d.plays) return toast('Todavía no hay escuchas este año', { kind: 'warn', sub: 'escuchá música y volvé a mirar' });
  const cv = await drawYear(d);
  const url = cv.toDataURL('image/png');
  const name = `petalwave-${d.year}.png`;
  const nat = window.PetalwaveNative;
  const b64 = () => url.split(',')[1];
  await modal({
    title: 'Tu ' + d.year + ' en Petalwave',
    html: `<img src="${url}" alt="" style="display:block;width:min(300px,70vw);margin:0 auto;border-radius:12px;box-shadow:0 10px 40px rgba(0,0,0,.5)">
      <div class="m" style="text-align:center;margin-top:8px">${esc(fmtLong(d.seconds))} de música este año</div>`,
    actions: [
      ...(nat && nat.saveImage ? [
        { label: 'compartir', fn: () => { const r = nat.saveImage(b64(), name, true); if (r !== 'ok') toast(r, { kind: 'err' }); return false; } },
        { label: 'guardar en la galería', primary: true, fn: () => { const r = nat.saveImage(b64(), name, false); toast(r === 'ok' ? 'guardada en Imágenes/Petalwave ✓' : r, { kind: r === 'ok' ? '' : 'err' }); return false; } },
      ] : [
        { label: 'copiar imagen', fn: async () => { try { const blob = await (await fetch(url)).blob(); await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]); toast('imagen copiada: pegala en WhatsApp, Instagram…'); } catch (e) { toast('no se pudo copiar: ' + e.message, { kind: 'err' }); } return false; } },
        { label: 'guardar imagen', primary: true, fn: () => { const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); toast('guardada en Descargas ✓', { sub: name }); return false; } },
      ]),
      { label: 'cerrar', value: null },
    ],
  });
}
