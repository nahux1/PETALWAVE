// ordenar mi música: portadas que faltan, nombres desprolijos ("Artista - Canción (Official Video)") y duplicados.
// Todo se escribe en tus archivos con ffmpeg, sin recodificar el audio (solo en la PC).
import { api, toast, modal, esc, norm, bus } from './core.js';
import { D, loadLibrary } from './data.js';

const NOISE = /\s*[([][^)\]]*(official|oficial|video|v[ií]deo|audio|lyric|letra|visuali[sz]er|music video|\bmv\b|\bhd\b|\b4k\b|clip|en vivo\b(?=.*video)|remaster(ed)?\s*\d*)[^)\]]*[)\]]/gi;
const TAIL = /\s*[|•]\s*.*$|\s+-\s+(official|video|audio|lyric).*$/i;

// ¿cómo debería llamarse? (sin internet: solo limpieza de texto)
export function suggestName(t) {
  let title = String(t.title || '').replace(NOISE, '').replace(TAIL, '').replace(/\s{2,}/g, ' ').trim();
  let artist = String(t.artist || '').replace(/\s*-\s*topic$/i, '').replace(/vevo$/i, '').trim();
  const unknown = !artist || /^(desconocido|unknown|various artists)$/i.test(artist);
  const m = /^(.{2,60}?)\s+[-–—]\s+(.{2,})$/.exec(title);
  if (m && (unknown || norm(m[1]).includes(norm(artist)) || norm(artist).includes(norm(m[1])))) { artist = m[1].trim(); title = m[2].trim(); }
  title = title.replace(/^["'“”]+|["'“”]+$/g, '').trim();
  return { title: title || t.title, artist: artist || t.artist };
}
const messy = (t) => { const s = suggestName(t); return s.title !== t.title || s.artist !== (t.artist || ''); };
const local = () => D.tracks.filter((t) => !t.video && !t.remote);
const coverable = (t) => ['mp3', 'm4a', 'flac', 'aac'].includes(t.ext);

// portada de YouTube Music: por el ID de YouTube si la canción lo tiene, si no buscando título + artista
async function findCover(t) {
  const q = (t.artist && !/^desconocido$/i.test(t.artist) ? t.artist + ' ' : '') + suggestName(t).title;
  const j = await api.get('/api/ytm/search?filter=songs&q=' + encodeURIComponent(q));
  const items = (j.items || []).filter((x) => x.thumb);
  const best = items.find((x) => x.videoId === t.ytId) || items.find((x) => !t.duration || !x.duration || Math.abs(x.duration - t.duration) <= 5) || null;
  return best ? best.thumb.replace(/=w\d+-h\d+[^&]*$/, '=w600-h600-l90-rj') : null;
}

async function runBatch(list, fn, label) {
  let ok = 0, fail = 0;
  const tst = (n) => toast(`${label}… ${n}/${list.length}`, { ms: 1200 });
  for (let i = 0; i < list.length; i++) {
    if (i % 3 === 0) tst(i);
    try { if (await fn(list[i])) ok++; else fail++; } catch { fail++; }
  }
  await loadLibrary();
  bus.emit('library');
  return { ok, fail };
}

export async function openTidy() {
  const L = local();
  const noCover = L.filter((t) => !t.hasCover && coverable(t));
  const names = L.filter(messy);
  let dupes = 0; try { dupes = (await api.get('/api/library/duplicates')).groups.length; } catch {}
  let chosen = null;
  const row = (id, title, n, sub, btn) => `<div class="tidy-row"><div><b>${title}</b><span class="m">${sub}</span></div><button class="${n ? 'go' : 'cb'} sm" data-t="${id}" ${n ? '' : 'disabled'}>${n ? btn : '✓ todo bien'}</button></div>`;
  const r = await modal({
    title: '✨ ordenar mi música',
    html: `<p class="m">Se escribe en tus archivos con ffmpeg, sin tocar el audio. Antes de cambiar nombres te muestro la lista.</p>
      ${row('cover', `🖼 portadas que faltan: ${noCover.length}`, noCover.length, 'las busca en YouTube Music y las pone dentro del archivo (mp3, m4a, flac)', 'buscar y poner')}
      ${row('names', `✎ nombres para arreglar: ${names.length}`, names.length, 'saca "(Official Video)", "[HD]", y separa "Artista - Canción"', 'ver y arreglar')}
      ${row('dupes', `⧉ canciones repetidas: ${dupes}`, dupes, 'misma canción en más de un archivo: elegís cuál mandar a la papelera', 'ver repetidas')}`,
    actions: [{ label: 'cerrar', value: null }],
    onOpen: (box) => box.querySelectorAll('[data-t]').forEach((b) => (b.onclick = () => { chosen = b.dataset.t; box.querySelector('.mact button').click(); })),
  });
  void r;
  if (chosen) act(chosen, { noCover, names });
}

async function act(what, { noCover, names }) {
  if (what === 'dupes') { bus.emit('ws', 'music'); return import('./library.js').then((m) => m.go({ type: 'dupes' })); }
  if (what === 'cover') {
    const { ok, fail } = await runBatch(noCover, async (t) => { const url = await findCover(t); if (!url) return false; await api.post(`/api/track/${t.id}/cover`, { url }); return true; }, 'poniendo portadas');
    return toast(`portadas puestas: ${ok}`, { sub: fail ? `${fail} no se encontraron en YouTube Music` : 'listo ✓', ms: 3500 });
  }
  if (what === 'names') {
    const sug = names.map((t) => ({ t, s: suggestName(t) }));
    const r = await modal({
      title: `✎ arreglar ${sug.length} nombres`, wide: true,
      html: `<div class="tidy-list">${sug.map(({ t, s }, i) => `<label class="tidy-n"><input type="checkbox" data-i="${i}" checked><span><s>${esc(t.artist || '—')} · ${esc(t.title)}</s><b>${esc(s.artist)} · ${esc(s.title)}</b></span></label>`).join('')}</div>`,
      actions: [{ label: 'cancelar', value: null }, { label: 'arreglar los marcados', primary: true, fn: (box) => [...box.querySelectorAll('[data-i]:checked')].map((c) => +c.dataset.i) }],
    });
    if (!r || !r.length) return;
    const { ok, fail } = await runBatch(r.map((i) => sug[i]), async ({ t, s }) => { await api.post(`/api/track/${t.id}/meta`, { title: s.title, artist: s.artist }); return true; }, 'arreglando nombres');
    return toast(`nombres arreglados: ${ok}`, { sub: fail ? `${fail} no se pudieron (formato .wav o archivo en uso)` : 'listo ✓', ms: 3500 });
  }
}

// cambiar la portada de una canción (menú de la canción)
export async function changeCover(t) {
  if (!coverable(t)) return toast(`los archivos .${t.ext} no guardan portada adentro`, { kind: 'warn', sub: 'sirven mp3, m4a y flac' });
  const r = await modal({
    title: 'Portada de «' + t.title + '»',
    html: '<p class="m">Buscarla en YouTube Music o elegir una imagen tuya (JPG o PNG).</p><input type="file" id="tcFile" accept="image/jpeg,image/png" hidden>',
    actions: [{ label: 'cancelar', value: null }, { label: '🖼 elegir imagen…', fn: (box) => new Promise((ok) => { const f = box.querySelector('#tcFile'); f.onchange = () => ok(f.files[0] || null); f.click(); }) }, { label: '🔍 buscar en YouTube Music', primary: true, value: 'ytm' }],
  });
  if (!r) return;
  try {
    if (r === 'ytm') { const url = await findCover(t); if (!url) return toast('no la encontré en YouTube Music', { kind: 'warn' }); await api.post(`/api/track/${t.id}/cover`, { url }); }
    else {
      if (r.size > 12e6) return toast('la imagen es muy grande (máx. 12 MB)', { kind: 'warn' });
      const data = await new Promise((ok, no) => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.onerror = no; fr.readAsDataURL(r); });
      await api.post(`/api/track/${t.id}/cover`, { data });
    }
    await loadLibrary(); bus.emit('library');
    toast('portada puesta ✓');
  } catch (e) { toast(e.message, { kind: 'err' }); }
}
