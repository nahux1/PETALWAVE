// actualizaciones: aviso en la barra cuando hay una versión nueva en GitHub y un botón para instalarla.
// La app baja solo lo nuevo, se cierra, se reemplaza y se vuelve a abrir. La música y los ajustes no se tocan.
import { $, api, bus, P, esc, toast, modal, host } from './core.js';

let info = null;

const mdLite = (s) => esc(s).replace(/^#+\s*(.*)$/gm, '<b>$1</b>').replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\n/g, '<br>');

function paintBadge() {
  const b = $('#tUpd'); if (!b) return;
  b.hidden = !(info && info.hasUpdate);
  if (info && info.hasUpdate) { b.title = `hay una versión nueva: ${info.latest} (tenés ${info.current})`; $('#tUpdTxt').textContent = info.latest; }
}

export async function checkUpdate(force, quiet) {
  try { info = await api.get('/api/update' + (force ? '?force=1' : '')); } catch (e) { info = { error: e.message }; }
  paintBadge();
  bus.emit('update:info', info);
  if (!quiet) {
    if (info.error) toast('no se pudo buscar actualizaciones', { kind: 'warn', sub: info.error });
    else if (!info.hasUpdate) toast('petalwave está al día ✓', { sub: 'versión ' + info.current });
  }
  if (info.hasUpdate && quiet && P.get('updSeen') !== info.latest) {
    toast(`hay una versión nueva de petalwave: ${info.latest}`, { sub: 'tocá el botón ⬆ de arriba para actualizar', ms: 6000 });
    P.set('updSeen', info.latest);
  }
  return info;
}

export async function openUpdate() {
  if (!info || !info.latest) await checkUpdate(true, true);
  if (!info || info.error) return toast('no se pudo consultar GitHub', { kind: 'err', sub: info && info.error });
  if (!info.hasUpdate) return toast('petalwave está al día ✓', { sub: 'versión ' + info.current });
  const mb = info.size ? ` (${Math.max(1, Math.round(info.size / 1048576))} MB)` : '';
  await modal({
    title: `actualizar a petalwave ${info.latest}`,
    wide: true,
    html: `<p>Tenés la <b>${esc(info.current)}</b>. La nueva es la <b>${esc(info.latest)}</b>.</p>
      <p class="m">Tu música, playlists, ajustes y sesión <b>no se tocan</b>. petalwave se va a cerrar unos segundos y se abre solo con la versión nueva.</p>
      <div class="upd-notes">${mdLite(info.notes || '')}</div>
      <div class="upd-bar" hidden><i></i><span>preparando…</span></div>`,
    actions: [
      { label: 'ahora no', value: false },
      info.canAuto ? { label: 'actualizar ahora' + mb, primary: true, fn: (box) => install(box) } : { label: 'abrir la descarga', primary: true, fn: () => { window.open(info.page, '_blank'); } },
    ],
  });
}

async function install(box) {
  const bar = box.querySelector('.upd-bar'); bar.hidden = false;
  box.querySelectorAll('.mact button').forEach((b) => (b.disabled = true));
  const set = (pct, txt) => { bar.querySelector('i').style.width = pct + '%'; bar.querySelector('span').textContent = txt; };
  const off = bus.on('sse:update', (m) => {
    if (m.state === 'downloading') set(m.pct || 0, `descargando… ${m.pct || 0}%`);
    else if (m.state === 'extracting') set(100, 'descomprimiendo…');
    else if (m.state === 'ready') set(100, 'listo · cerrando petalwave para instalar…');
    else if (m.state === 'error') set(0, 'error: ' + m.error);
  });
  try {
    await api.post('/api/update/apply');
    set(100, 'listo · petalwave se cierra y se vuelve a abrir solo…');
    setTimeout(() => {
      if (host.native) host.send('quit');
      else { api.post('/api/quit').catch(() => {}); set(100, 'cerrá esta pestaña: petalwave se abre solo con la versión nueva'); }
    }, 1200);
    return false;   // la ventana queda abierta hasta que se cierre la app
  } catch (e) {
    off();
    set(0, 'no se pudo actualizar: ' + e.message);
    box.querySelectorAll('.mact button').forEach((b) => (b.disabled = false));
    return false;
  }
}

export function initUpdate() {
  $('#tUpd').onclick = openUpdate;
  // buscar una vez al abrir (si el usuario no lo apagó), sin molestar si no hay internet
  if (P.get('autoUpdate') !== false) setTimeout(() => checkUpdate(false, true), 8000);
}
