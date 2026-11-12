// workspace de ajustes: temas, reproducción, visualizador, carpetas, descargas, letras, atajos y rendimiento
import { $, $$, bus, P, api, esc, toast, host, DEFAULT_SHORTCUTS, SHORTCUT_LABELS, confirm2 } from './core.js';
import { allThemes, setTheme, setDyn } from './theme.js';
import { customizerHtml, bindCustomizer } from './custom.js';
import { checkUpdate, openUpdate } from './update.js';
import { MODES, setMode } from './viz.js';
import { D } from './data.js';
import { setDest } from './downloads.js';

let server = null;
export function keyName(e) {
  let k = e.key === ' ' ? 'Space' : e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (k === 'Shift' || k === 'Control' || k === 'Alt' || k === 'Meta') return null;
  if (e.shiftKey && e.key.length === 1) k = e.key.toUpperCase();
  return (e.ctrlKey ? 'Ctrl+' : '') + (e.altKey ? 'Alt+' : '') + (e.shiftKey ? 'Shift+' : '') + (e.shiftKey && e.key.length === 1 ? k : k);
}
const pretty = (k) => (k || '—').replace('Space', 'espacio').replace('ArrowRight', '→').replace('ArrowLeft', '←').replace('ArrowUp', '↑').replace('ArrowDown', '↓');

export async function renderSettings() {
  try { server = await api.get('/api/settings'); } catch { server = server || {}; }
  const p = P.all();
  const box = $('#cfgBody');
  const sw = (t) => `<div class="sw">${['--deep', '--g2', '--ac3', '--ac', '--ac2', '--sec', '--fg'].map((k) => `<i style="background:${t[k]}"></i>`).join('')}</div>`;
  const tip = (txt) => `<i class="tipi" title="${esc(txt)}">i</i>`;
  const chk = (k, label, sub, more) => `<label class="cfrow"><span>${label}${more ? tip(more) : ''}${sub ? `<span class="m">${sub}</span>` : ''}</span><input type="checkbox" data-p="${k}" ${p[k] ? 'checked' : ''}></label>`;
  box.innerHTML = `<div class="cfg">
    <div class="cfgsec"><h3>◐ tema</h3>
      <div class="themes">${Object.entries(allThemes()).map(([k, t]) => `<button class="th-card ${p.theme === k ? 'on' : ''}" data-theme="${k}" title="${esc(t.desc)}">${sw(t)}<b>${t.mine ? '✎ ' : ''}${esc(t.name)}</b><div class="m">${esc(t.desc)}</div></button>`).join('')}</div>
      ${chk('dyn', 'colores de la carátula', 'usa los colores de la portada · tecla c', 'Mientras suena algo, los colores del tema se reemplazan por los de la portada de la canción. Elegir un tema lo apaga.')}
      <label class="cfrow"><span>teñir el wallpaper<span class="m">tu imagen toma los colores del tema</span></span><input type="checkbox" id="cWpTint" ${p.wpTint !== false ? 'checked' : ''}></label>
      <div class="cfrow"><span>wallpaper<span class="m">o arrastrá una imagen a la ventana</span></span><span><button class="cb" id="cWp">elegir</button> <button class="cb" id="cWpDel">quitar</button></span></div>
    </div>
    ${customizerHtml()}
    <div class="cfgsec"><h3>▶ reproducción</h3>
      <div class="cfrow"><span>fundido entre canciones${tip('Crossfade: la canción que termina baja mientras la siguiente sube. 0 = corte directo.')}<span class="m">segundos de crossfade</span></span><span><input type="range" min="0" max="10" step="0.5" value="${p.crossfade}" id="cXf"> <b id="cXfV">${p.crossfade} s</b></span></div>
      ${chk('resume', 'reanudar al abrir', 'vuelve a donde quedaste')}
      ${chk('notifyToast', 'aviso al cambiar de canción', 'en la esquina de la ventana')}
      ${chk('notify', 'notificación de Windows', 'si petalwave está en segundo plano')}
    </div>
    <div class="cfgsec"><h3>≋ visualizador</h3>
      <div class="cfrow"><span>modo<span class="m">también con la tecla z</span></span><select id="cViz">${MODES.map((m) => `<option value="${m.id}" ${p.viz === m.id ? 'selected' : ''}>${m.name}</option>`).join('')}</select></div>
      <div class="cfrow"><span>cuadros por segundo<span class="m">30 usa menos CPU</span></span><select id="cFps"><option value="30" ${p.fps == 30 ? 'selected' : ''}>30</option><option value="60" ${p.fps == 60 ? 'selected' : ''}>60</option></select></div>
      <div class="cfrow"><span>partículas<span class="m">cantidad en el modo particles</span></span><span><input type="range" min="40" max="400" step="20" value="${p.particles}" id="cPart"> <b id="cPartV">${p.particles}</b></span></div>
    </div>
    <div class="cfgsec"><h3>♫ biblioteca ${tip('petalwave escanea estas carpetas con sus subcarpetas. Formatos: mp3, flac, wav, ogg, opus, m4a, aac, mp4, webm.')}</h3>
      <div class="folders" id="cFolders">${(server.folders || []).map((f) => `<div class="fr"><span title="${esc(f)}">${esc(f)}</span><button class="cb sm" data-open="${esc(f)}">abrir</button><button class="cb sm danger" data-rmf="${esc(f)}">quitar</button></div>`).join('')}</div>
      <div class="cfrow"><span>${D.tracks.length} canciones<span class="m">en tu PC</span></span><span><button class="cb" id="cAddF">+ carpeta</button> <button class="cb" id="cScan">reescanear</button></span></div>
    </div>
    <div class="cfgsec"><h3>⇣ descargas</h3>
      <div class="cfrow"><span>carpeta de destino<span class="m" style="word-break:break-all">${esc(server.downloadDir || '')}</span></span><button class="cb" id="cDest">cambiar</button></div>
      <div class="cfrow"><span>simultáneas${tip('Más de 2 a la vez aumenta el riesgo de que YouTube bloquee las descargas por un rato.')}<span class="m">recomendado: 2</span></span><select id="cConc">${[1, 2, 3, 4].map((n) => `<option ${server.concurrency == n ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
    </div>
    <div class="cfgsec"><h3>≡ letras ${tip('Orden de búsqueda: archivo .lrc o .txt con el mismo nombre del audio → letra guardada dentro del archivo → YouTube Music → LRCLIB.')}</h3>
      <label class="cfrow"><span>YouTube Music${tip('Las mismas letras que muestra YouTube Music (LyricFind / Musixmatch), sincronizadas cuando existen. Vía ytmusicapi.')}<span class="m">letras oficiales, sincronizadas</span></span><input type="checkbox" id="cLrcY" ${server.lyricsYtm !== false ? 'checked' : ''}></label>
      <label class="cfrow"><span>LRCLIB${tip('Base abierta y comunitaria de letras (lrclib.net). Envía artista, título y duración de la canción.')}<span class="m">base abierta de internet</span></span><input type="checkbox" id="cLrc" ${server.lyricsOnline ? 'checked' : ''}></label>
    </div>
    <div class="cfgsec"><h3>⌨ atajos de teclado ${tip('Clic en un atajo y apretá la tecla nueva. Esc cancela.')}</h3>
      <div class="keys" id="cKeys">${Object.keys(DEFAULT_SHORTCUTS).map((k) => `<span>${esc(SHORTCUT_LABELS[k] || k)}</span><button class="cb sm" data-key="${k}">${esc(pretty(p.shortcuts[k]))}</button>`).join('')}</div>
      <div class="cfrow"><span></span><button class="cb" id="cKeysReset">restaurar</button></div>
    </div>
    <div class="cfgsec"><h3>⚡ rendimiento</h3>
      ${chk('blur', 'desenfoque de fondo', 'apagalo si la PC va lenta')}
      ${chk('anim', 'animaciones')}
      ${chk('compact', 'modo compacto', 'filas chicas, sin visualizador · tecla k')}
      <div class="m" id="cMem" style="margin-top:8px"></div>
    </div>
    <div class="cfgsec"><h3>❀ acerca de</h3>
      <div class="cfrow"><span>versión <b id="cVer">…</b><span class="m" id="cVerSub">buscando actualizaciones…</span></span><span><button class="cb" id="cUpd">buscar actualizaciones</button></span></div>
      <label class="cfrow"><span>avisarme si hay versión nueva<span class="m">consulta GitHub al abrir (no manda datos tuyos)</span></span><input type="checkbox" id="cAutoUpd" ${p.autoUpdate !== false ? 'checked' : ''}></label>
      <div class="m">ventana ${host.native ? 'nativa (WebView2)' : 'en navegador'} · datos en <code>petalwave\\data</code></div>
      <div class="m" style="margin-top:6px">usalo con música propia, libre o con permiso. No esquiva DRM ni restricciones de las plataformas.</div>
    </div>
  </div>`;

  box.querySelectorAll('[data-theme]').forEach((b) => (b.onclick = () => setTheme(b.dataset.theme)));
  bindCustomizer(box, () => { const y = box.scrollTop; renderSettings().then(() => (box.scrollTop = y)); });
  // mantener tarjetas y casilla al día (también si el tema se cambia con la tecla t o la barra)
  const syncTheme = () => {
    box.querySelectorAll('[data-theme]').forEach((x) => x.classList.toggle('on', x.dataset.theme === P.get('theme')));
    const d = box.querySelector('[data-p="dyn"]'); if (d) d.checked = !!P.get('dyn');
  };
  if (box._offTheme) box._offTheme();
  box._offTheme = bus.on('theme:changed', syncTheme);
  box.querySelectorAll('[data-p]').forEach((c) => (c.onchange = () => {
    const k = c.dataset.p;
    if (k === 'dyn') return setDyn(c.checked);
    P.set(k, c.checked); bus.emit('prefs', k);
  }));
  $('#cWpTint').onchange = (e) => { P.set('wpTint', e.target.checked); document.body.classList.toggle('wptint', e.target.checked); };
  $('#cXf').oninput = (e) => { P.set('crossfade', +e.target.value); $('#cXfV').textContent = e.target.value + ' s'; };
  $('#cViz').onchange = (e) => setMode(e.target.value);
  $('#cFps').onchange = (e) => P.set('fps', +e.target.value);
  $('#cPart').oninput = (e) => { P.set('particles', +e.target.value); $('#cPartV').textContent = e.target.value; };
  $('#cWp').onclick = () => $('#tWp').click();
  $('#cWpDel').onclick = () => api.del('/api/wallpaper').then(() => bus.emit('wallpaper'));
  $('#cAddF').onclick = async () => {
    const f = await host.pickFolder('Carpeta con música para agregar a la biblioteca');
    if (!f) return;
    try { await api.post('/api/library/folders', { add: f }); toast('carpeta agregada: escaneando…'); renderSettings(); } catch (e) { toast(e.message, { kind: 'err' }); }
  };
  $('#cScan').onclick = () => { api.post('/api/library/rescan'); toast('reescaneando…', { ms: 1400 }); };
  box.querySelectorAll('[data-rmf]').forEach((b) => (b.onclick = async () => {
    if (!(await confirm2('Quitar carpeta', `¿Dejar de escanear <b>${esc(b.dataset.rmf)}</b>? Los archivos no se borran.`, 'quitar'))) return;
    await api.post('/api/library/folders', { remove: b.dataset.rmf }); renderSettings();
  }));
  box.querySelectorAll('[data-open]').forEach((b) => (b.onclick = () => api.post('/api/open', { path: b.dataset.open })));
  $('#cDest').onclick = async () => {
    const f = await host.pickFolder('Carpeta donde guardar las descargas');
    if (!f) return;
    try { const s = await api.post('/api/settings', { downloadDir: f }); setDest(s.downloadDir); renderSettings(); toast('las descargas van a ' + s.downloadDir); } catch (e) { toast(e.message, { kind: 'err' }); }
  };
  $('#cConc').onchange = (e) => api.post('/api/settings', { concurrency: +e.target.value });
  $('#cLrcY').onchange = (e) => api.post('/api/settings', { lyricsYtm: e.target.checked }).then(() => toast(e.target.checked ? 'letras de YouTube Music activadas' : 'letras de YouTube Music desactivadas'));
  $('#cLrc').onchange = (e) => api.post('/api/settings', { lyricsOnline: e.target.checked }).then(() => toast(e.target.checked ? 'letras online activadas' : 'letras online desactivadas'));
  // atajos
  let rec = null;
  $('#cKeys').addEventListener('click', (e) => {
    const b = e.target.closest('[data-key]'); if (!b) return;
    if (rec) rec.classList.remove('rec');
    rec = b; b.classList.add('rec'); b.textContent = 'apretá una tecla…';
  });
  const onKey = (e) => {
    if (!rec) return;
    e.preventDefault(); e.stopPropagation();
    const id = rec.dataset.key;
    if (e.key === 'Escape') { rec.textContent = pretty(P.get('shortcuts')[id]); rec.classList.remove('rec'); rec = null; return; }
    const k = keyName(e); if (!k) return;
    const sc = P.get('shortcuts');
    const clash = Object.keys(sc).find((x) => x !== id && sc[x] === k);
    if (clash) { sc[clash] = ''; toast(`«${pretty(k)}» se sacó de «${SHORTCUT_LABELS[clash]}»`, { kind: 'warn' }); }
    sc[id] = k; P.save();
    rec.classList.remove('rec'); rec = null;
    renderSettings();
  };
  document.removeEventListener('keydown', box._onKey, true);
  box._onKey = onKey;
  document.addEventListener('keydown', onKey, true);
  $('#cKeysReset').onclick = () => { P.set('shortcuts', { ...DEFAULT_SHORTCUTS }); renderSettings(); toast('atajos restaurados'); };
  api.get('/api/sys').then((s) => { const m = $('#cMem'); if (m) m.textContent = `servidor: ${s.appMem} MB de RAM · interfaz: ${performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) + ' MB' : '—'}`; }).catch(() => {});
  // actualizaciones
  const paintVer = (i) => {
    if (!i || !$('#cVer')) return;
    $('#cVer').textContent = i.current || '?';
    $('#cVerSub').textContent = i.error ? 'no se pudo consultar GitHub' : i.hasUpdate ? 'hay una nueva: ' + i.latest : 'estás al día';
    $('#cUpd').textContent = i.hasUpdate ? 'actualizar a ' + i.latest : 'buscar actualizaciones';
    $('#cUpd').onclick = i.hasUpdate ? openUpdate : () => checkUpdate(true, false).then(paintVer);
  };
  checkUpdate(false, true).then(paintVer);
  $('#cAutoUpd').onchange = (e) => P.set('autoUpdate', e.target.checked);
  box.dataset.rec = '';
  box.isRecording = () => !!rec;
}
export const isRecordingKey = () => { const b = $('#cfgBody'); return !!(b && b.isRecording && b.isRecording()); };
