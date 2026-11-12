// workspace de estadísticas + recomendaciones (todo calculado con tu historial real)
import { $, bus, api, esc, fmtLong, coverUrl, icon } from './core.js';
import { D, T, loadAuto } from './data.js';
import { playList, radio } from './player.js';
import { go } from './library.js';

let range = 'month';
export async function renderStats() {
  const box = $('#statsBody');
  box.innerHTML = '<div class="empty">calculando…</div>';
  let s;
  try { s = await api.get('/api/stats?range=' + range); } catch (e) { box.innerHTML = `<div class="warn">${esc(e.message)}</div>`; return; }
  await loadAuto();
  const max = Math.max(1, ...s.chart.map((c) => c.seconds));
  const topRow = (i, img, name, sub, data) => `<div class="toprow" ${data}><span class="ix">${i + 1}</span><img loading="lazy" src="${img}" onerror="this.classList.add('x')"><div style="min-width:0"><div class="n">${esc(name)}</div><div class="s">${esc(sub)}</div></div><span class="s"></span></div>`;
  const rl = { week: 'últimos 7 días', month: 'últimos 30 días', all: 'desde siempre' }[range];
  box.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap"><div class="hd" style="margin:0">▤ estadísticas</div>
      <div class="seg">${['week', 'month', 'all'].map((r) => `<button data-r="${r}" class="${r === range ? 'on' : ''}">${{ week: 'semana', month: 'mes', all: 'todo' }[r]}</button>`).join('')}</div>
      <span class="m">${rl}</span></div>
    <div class="kpis">
      <div class="kpi"><div class="v">${fmtLong(s.seconds)}</div><div class="l">escuchado (${rl})</div></div>
      <div class="kpi"><div class="v">${s.plays}</div><div class="l">reproducciones</div></div>
      <div class="kpi"><div class="v">${s.distinct}</div><div class="l">canciones distintas</div></div>
      <div class="kpi"><div class="v">${s.artists}</div><div class="l">artistas</div></div>
      <div class="kpi"><div class="v">${fmtLong(s.totalSeconds)}</div><div class="l">tiempo total histórico</div></div>
      <div class="kpi"><div class="v">${D.tracks.length}</div><div class="l">en la biblioteca</div></div>
    </div>
    <div class="h3">${range === 'all' ? 'por mes' : 'por día'}</div>
    <div class="chart">${s.chart.map((c) => `<div class="b" style="height:${Math.max(2, (c.seconds / max) * 100)}%"><em>${fmtLong(c.seconds)}</em><span>${range === 'month' ? c.label.slice(3) : c.label}</span></div>`).join('')}</div>
    <div class="tops">
      <div><div class="h3">canciones más escuchadas</div>${s.topTracks.length ? s.topTracks.map((x, i) => { const t = T(x.id); return t ? topRow(i, coverUrl(t.id), t.title, `${t.artist || '—'} · ${x.plays} ${x.plays === 1 ? 'vez' : 'veces'}`, `data-t="${t.id}"`) : ''; }).join('') : '<div class="m">todavía no hay datos: escuchá un poco ♪</div>'}</div>
      <div><div class="h3">artistas favoritos</div>${s.topArtists.map((x, i) => topRow(i, coverUrl(x.cover), x.name, `${x.plays} reproducciones · ${fmtLong(x.seconds)}`, `data-a="${esc(x.name)}"`)).join('') || '<div class="m">—</div>'}</div>
      <div><div class="h3">álbumes más escuchados</div>${s.topAlbums.map((x, i) => topRow(i, coverUrl(x.cover), x.name, `${x.artist} · ${x.plays} reproducciones`, `data-al="${esc(x.name)}" data-ar="${esc(x.artist)}"`)).join('') || '<div class="m">tus archivos no tienen etiqueta de álbum</div>'}</div>
    </div>
    <div class="h3" style="margin-top:22px">❀ hecho para vos</div>
    <div class="m">mixes armados con tu propia biblioteca e historial (sin internet)</div>
    <div class="grid" style="margin-top:8px">${D.auto.map((a, i) => { const c = (a.tracks.map(T).find((t) => t && (t.hasCover || t.video)) || {}).id; return `<div class="card" data-auto="${i}"><div class="cimg">❀${c ? `<img loading="lazy" src="${coverUrl(c)}" onerror="this.classList.add('x')">` : ''}<button class="cplay" data-ap="${i}">${icon('play')}</button></div><div class="cn">${esc(a.name)}</div><div class="cs">${esc(a.desc)} · ${a.tracks.length}</div></div>`; }).join('') || '<div class="m">aparecen cuando escuches algunas canciones</div>'}</div>`;
  box.querySelectorAll('[data-r]').forEach((b) => (b.onclick = () => { range = b.dataset.r; renderStats(); }));
  box.querySelectorAll('[data-t]').forEach((r) => (r.onclick = () => radio(r.dataset.t)));
  box.querySelectorAll('[data-a]').forEach((r) => (r.onclick = () => { go({ type: 'artist', key: r.dataset.a }); bus.emit('ws', 'music'); }));
  box.querySelectorAll('[data-al]').forEach((r) => (r.onclick = () => { go({ type: 'album', key: { album: r.dataset.al, artist: r.dataset.ar } }); bus.emit('ws', 'music'); }));
  box.querySelectorAll('[data-auto]').forEach((c) => (c.onclick = (e) => {
    const a = D.auto[+c.dataset.auto];
    if (e.target.closest('[data-ap]')) return playList(a.tracks, 0, { shuffle: false });
    go({ type: 'auto', key: a.id }); bus.emit('ws', 'music');
  }));
}
