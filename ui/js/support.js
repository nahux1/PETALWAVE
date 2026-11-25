// ❀ apoyar Petalwave: un botón para donar, sin publicidad ni nada exclusivo (todo sigue gratis para todos).
// El link sale de latest.json (campo "support"), así se puede poner o cambiar sin sacar otra versión.
// Se recuerda poco y bien: nunca la primera semana, como mucho una vez cada 60 días, y se puede apagar.
import { bus, P, local, toast, esc } from './core.js';
import { tasteEvents } from './taste.js';

const KEY = 'pw-support';
let url = (local.get(KEY, null) || {}).url || '';
export const supportUrl = () => url;
export function openSupport() { if (url) window.open(url, '_blank'); }

export const supportRowHtml = () => url ? `<div class="cfrow"><span>❀ apoyar Petalwave<span class="m">es gratis y sin publicidad, para todos. Si te sirve, podés ayudar con lo que quieras.</span></span><button class="go sm" id="cSupport">apoyar</button></div>
  <label class="cfrow"><span>recordármelo de vez en cuando<span class="m">como mucho una vez cada dos meses</span></span><input type="checkbox" id="cSupportAsk" ${P.get('supportAsk') !== false ? 'checked' : ''}></label>` : '';
export function bindSupportRow(el) {
  const b = el.querySelector('#cSupport'); if (b) b.onclick = openSupport;
  const c = el.querySelector('#cSupportAsk'); if (c) c.onchange = () => P.set('supportAsk', c.checked);
}
export const supportLinkHtml = (txt = '❀ apoyar Petalwave') => url ? `<button class="cb sm" data-support>${esc(txt)}</button>` : '';

const DAY = 86400000;
function mayAsk() {
  if (!url || P.get('supportAsk') === false) return false;
  const first = P.get('firstSeen') || Date.now();
  if (Date.now() - first < 7 * DAY) return false;
  const last = P.get('supportAskedAt') || 0;
  return Date.now() - last > 60 * DAY;
}
function ask(msg, sub) {
  if (!mayAsk()) return;
  P.set('supportAskedAt', Date.now());
  toast(msg, { sub, ms: 9000, action: { label: 'apoyar', fn: openSupport } });
}

export function initSupport() {
  if (!P.get('firstSeen')) P.set('firstSeen', Date.now());
  // el link viene con la consulta de actualizaciones
  bus.on('update:info', (i) => {
    const u = i && typeof i.support === 'string' ? i.support : '';
    if (u !== url) { url = u; local.set(KEY, { url }); bus.emit('support'); }
    // recién actualizada: buen momento (una sola vez por versión)
    if (i && i.current && P.get('lastVersion') && P.get('lastVersion') !== i.current) ask('¡Petalwave se actualizó! ❀', 'si te gusta, podés apoyar el proyecto con lo que quieras');
    if (i && i.current) P.set('lastVersion', i.current);
  });
  // 100 horas escuchadas
  setTimeout(() => {
    if (P.get('support100')) return;
    const secs = tasteEvents().reduce((a, e) => a + (e.k === 'play' && e.s > 0 ? e.s : 0), 0);
    if (secs >= 100 * 3600) { P.set('support100', true); ask('¡Ya escuchaste más de 100 horas con Petalwave! ❀', 'si te sirve, podés apoyar el proyecto con lo que quieras'); }
  }, 20000);
  document.addEventListener('click', (e) => { if (e.target.closest('[data-support]')) openSupport(); });
}
