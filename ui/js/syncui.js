// workspace de sincronización con YouTube Music + importar playlists comparando con la biblioteca local
import { $, $$, bus, api, esc, toast, ago, fmtTime } from './core.js';
import { D, plOp } from './data.js';
import { cookieHelp } from './downloads.js';
import { go } from './library.js';

let sync = null, wasRunning = false;

function render() {
  const s = sync; if (!s) return;
  const st = s.state;
  const warn = $('#syWarn');
  warn.hidden = !!s.hasCookies && !s.cookieExpired;
  warn.innerHTML = !s.hasCookies
    ? '🍪 Para sincronizar con tu cuenta cargá tu <b>cookies.txt</b> (workspace 2 → botón 🍪, o arrastralo a la ventana).'
    : '⚠ Tus <b>cookies vencieron</b> (el navegador las renovó). Exportalas desde una ventana privada. <a href="#" id="syHelp">ver pasos</a>';
  const hl = $('#syHelp'); if (hl) hl.onclick = (e) => { e.preventDefault(); cookieHelp('Cómo exportar cookies que no se vencen:'); toast('los pasos están en el log de descargas (2)'); };
  $('#syncDot').className = 'sdot' + (st.running ? ' run' : st.lastResult ? (st.lastResult.failed ? ' err' : ' ok') : '');
  const cur = s.sources.find((x) => x.id === st.current);
  const next = s.auto ? Math.max(0, Math.round((st.lastRun + s.auto * 60000 - Date.now()) / 60000)) : null;
  $('#syStatus').innerHTML = st.running
    ? `⟳ sincronizando <b>${esc(cur ? cur.name : '…')}</b>${st.queue.length > 1 ? ` · quedan ${st.queue.length - 1}` : ''} · el progreso está en descargas (2)`
    : `último sync: <b>${ago(st.lastRun)}</b>` + (st.lastResult ? ` · +${st.lastResult.added} nuevas${st.lastResult.stopped ? ' · detenido' : ''}${st.lastResult.failed ? ` · ${st.lastResult.failed} con error` : ''}` : '') +
      (next === null ? '' : next < 1 ? ' · próximo: en menos de 1 min' : ` · próximo en ~${next} min`);
  $('#syRun').textContent = st.running ? (st.cancel ? '■ deteniendo…' : '■ detener sync') : '⟳ sincronizar ahora';
  $('#syRun').classList.toggle('stop', st.running);
  $('#syRun').disabled = !!st.cancel;
  if (document.activeElement !== $('#syAuto')) $('#syAuto').value = String(s.auto);
  if (document.activeElement !== $('#syFmt')) { $('#syFmt').value = `${s.format}|${s.quality}`; if (!$('#syFmt').value) $('#syFmt').value = 'mp3|320'; }
  $('#sySources').innerHTML = s.sources.map((x) => `
    <div class="src-it ${st.current === x.id ? 'cur' : ''}">
      <input type="checkbox" data-tg="${x.id}" ${x.enabled ? 'checked' : ''} title="incluir en la sincronización">
      <div style="min-width:0"><div class="n">${esc(x.name)}</div>
        <div class="m">${x.last ? `${ago(x.last)} · ${x.lastStatus === 'completado' ? '+' + (x.lastAdded || 0) + ' nuevas' : '✖ error (ver log)'}` : 'sin sincronizar todavía'}</div></div>
      <button class="cb sm" data-one="${x.id}" title="sincronizar solo esta" ${st.running ? 'disabled' : ''}>⟳</button>
      ${x.liked ? '<span></span>' : `<button class="x" data-rm="${x.id}" title="quitar (no borra archivos)">✕</button>`}
    </div>`).join('');
  if (wasRunning && !st.running) toast(`sync listo: +${st.lastResult ? st.lastResult.added : 0} nuevas ♫`);
  wasRunning = st.running;
}
async function load() { try { sync = await api.get('/api/sync'); render(); } catch {} }
async function post(b) { try { sync = await api.post('/api/sync', b); render(); return true; } catch (e) { toast(e.message, { kind: 'err' }); return false; } }

// ---------- importar / comparar playlist ----------
let lastImp = null;
async function inspect() {
  const url = $('#impUrl').value.trim();
  if (!url) return;
  const out = $('#impOut');
  out.innerHTML = '<div class="empty">leyendo la playlist… (las grandes tardan un poco)</div>';
  $('#impGo').disabled = true;
  try {
    const j = await api.post('/api/yt/inspect', { url });
    if (j.error) { out.innerHTML = `<div class="warn">${esc(j.error)}</div>`; return; }
    lastImp = j;
    const miss = j.entries.filter((e) => !e.match);
    out.innerHTML = `<div class="imp-h"><b>${esc(j.title || 'playlist')}</b><span class="m">${j.entries.length} canciones · <span style="color:var(--ok)">${j.have} ya las tenés</span> · <span style="color:var(--warn)">${miss.length} faltan</span></span></div>
      <div class="imp-h"><button class="go" id="impMake" ${j.have ? '' : 'disabled'}>crear playlist local (${j.have})</button><button class="cb" id="impDl" ${miss.length ? '' : 'disabled'}>⇣ bajar las ${miss.length} que faltan</button><button class="cb" id="impSync">⟳ agregar al sync</button></div>
      <div class="imp-list">${j.entries.map((e) => `<div class="irow ${e.match ? 'have' : 'miss'}"><span class="s">${e.match ? '✓' : '⇣'}</span><div style="min-width:0"><div>${esc(e.title)}</div><div class="a">${esc(e.artist || '')}</div></div><span class="m">${e.duration ? fmtTime(e.duration) : ''}</span></div>`).join('')}</div>`;
    $('#impMake').onclick = async () => {
      const p = await plOp({ create: { name: j.title || 'playlist importada', tracks: j.entries.filter((e) => e.match).map((e) => e.match) } });
      toast(`playlist «${p.name}» creada con ${p.tracks.length}`);
      go({ type: 'pl', key: p.id });
      bus.emit('ws', 'music');
    };
    $('#impDl').onclick = async () => {
      try {
        const r = await api.post('/api/downloads', { urls: miss.map((e) => e.url).filter(Boolean), format: 'mp3', quality: '320', cookies: 'txt' });
        toast(`${r.ids.length} descargas en cola`, { sub: 'se bajan de a poco para no gatillar el anti-bots' });
      } catch (e) { toast(e.message, { kind: 'err' }); }
    };
    $('#impSync').onclick = () => post({ add: { url: j.url, name: j.title } }).then((ok) => ok && toast('agregada a la sincronización'));
  } catch (e) { out.innerHTML = `<div class="warn">${esc(e.message)}</div>`; }
  finally { $('#impGo').disabled = false; }
}

export function initSync() {
  $('#sySources').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.one) runNow(b.dataset.one);
    if (b.dataset.rm) post({ remove: b.dataset.rm });
  });
  $('#sySources').addEventListener('change', (e) => { if (e.target.dataset.tg) post({ toggle: e.target.dataset.tg }); });
  $('#syRun').onclick = async () => { if (sync && sync.state.running) { await api.post('/api/sync/stop'); toast('deteniendo sync…'); return load(); } runNow(); };
  $('#syAuto').onchange = () => post({ auto: +$('#syAuto').value }).then(() => toast(+$('#syAuto').value ? 'auto-sync activado ♫' : 'auto-sync apagado'));
  $('#syFmt').onchange = () => { const [format, quality] = $('#syFmt').value.split('|'); post({ format, quality }); };
  $('#syAdd').onclick = async () => { const url = $('#syUrl').value.trim(); if (url && (await post({ add: { url } }))) { $('#syUrl').value = ''; toast('playlist agregada ♫'); } };
  $('#syUrl').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#syAdd').click(); });
  $('#syDisc').onclick = async () => {
    const box = $('#syDiscList');
    box.hidden = false; box.innerHTML = '<div class="empty">buscando tus playlists…</div>';
    const j = await api.get('/api/sync/discover');
    if (j.error) { box.innerHTML = `<div class="empty">${esc(j.error)}</div>`; return; }
    if (!j.playlists.length) { box.innerHTML = '<div class="empty">no encontré playlists en tu cuenta</div>'; return; }
    const have = new Set((sync ? sync.sources : []).map((s) => s.url));
    box.innerHTML = j.playlists.map((p, i) => `<div class="src-it"><span>♫</span><div style="min-width:0"><div class="n">${esc(p.name)}</div><div class="m">${p.count ? p.count + ' temas' : ''}</div></div>
      <button class="cb sm" data-insp="${i}" title="comparar con la biblioteca">⇄</button>${have.has(p.url) ? '<span class="m">✓</span>' : `<button class="cb sm" data-add="${i}">+</button>`}</div>`).join('');
    box.onclick = async (e) => {
      const a = e.target.closest('[data-add]'), ins = e.target.closest('[data-insp]');
      if (a) { const p = j.playlists[+a.dataset.add]; if (await post({ add: { url: p.url, name: p.name } })) a.outerHTML = '<span class="m">✓</span>'; }
      if (ins) { $('#impUrl').value = j.playlists[+ins.dataset.insp].url; inspect(); }
    };
  };
  $('#impGo').onclick = inspect;
  $('#impUrl').addEventListener('keydown', (e) => { if (e.key === 'Enter') inspect(); });
  bus.on('sse:sync', (s) => { sync = s; render(); });
  bus.on('sse:open', load);
  setInterval(() => { if (sync && !sync.state.running) render(); }, 30000);
  load();
}
async function runNow(id) {
  try { await api.post('/api/sync/run', id ? { id } : {}); toast('⟳ sincronizando… (solo baja lo nuevo)'); load(); }
  catch (e) { toast(e.message, { kind: 'err' }); }
}
