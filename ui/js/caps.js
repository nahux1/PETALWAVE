// mayúscula inicial: los textos de la interfaz que empiezan en minúscula ("reproducir", "cola", "ajustes"…)
// se muestran con la primera letra en mayúscula. Se puede apagar en ajustes → diseño.
// Nunca se tocan datos tuyos: títulos, artistas, álbumes, playlists, letras, rutas ni lo que escribís.
import { P, bus } from './core.js';
import { tr } from './i18n.js';

// zonas con contenido del usuario o de internet: se dejan exactamente como vienen
const SKIP = [
  'input', 'textarea', 'select', 'code', 'pre', 'kbd', 'script', 'style', '[contenteditable]',
  '.row .tt', '.row .c2', '.yrow .t', '.yrow .a', '.yrow .al', '.hrow .t', '.tlist [data-g]', '[data-pl]', '[data-ytm]:not([data-ytm=liked])', '#ytmAcc b', '.tipi', '.tg', '.c', '.qrow', '.hrow', '.toprow', '.card', '.kv span', '[data-np]',
  '.lyr', '#fLyrics', '.ft', '.fa', '.np-t', '#buf', '.term', '.src-it', '.lnav [data-pl]', '.lnav [data-ypl]', '.lnav [data-key]',
  '.fr', '.sp-list', '.sp-row', '.mythemes', '.th-card b', '.upd-notes', '.toast .ts', '[data-raw]', '.ttl',
].join(',');
// elementos que "cortan" una frase: lo que empieza adentro es el comienzo de un texto
const BLOCK = /^(BUTTON|LABEL|H1|H2|H3|H4|LI|OPTION|TD|TH|P|DIV|SECTION|HEADER|NAV|ASIDE|MAIN)$/;
const LOWER = /^(\s*[^\p{L}\p{N}]{0,3}\s*)(\p{Ll})/u;
// el nombre del programa va siempre con mayúscula, salvo dentro de rutas o nombres de archivo
const BRAND = /(?<![\p{L}\p{N}_\/\\.~-])petalwave(?![\p{L}\p{N}_.\\\/-])/gu;
const brand = (v) => v.replace(BRAND, 'Petalwave');
const PATHLIKE = /^\s*([~./\\]|[a-z]:\\)/i;
const upFirst = (v) => v.replace(LOWER, (_, pre, ch) => pre + ch.toLocaleUpperCase('es'));

let on = true, busy = false;
const done = new WeakSet();

// ¿el texto es lo primero que se lee dentro de su bloque? (así no se capitaliza la mitad de una frase)
function startsBlock(node) {
  let n = node;
  for (let depth = 0; depth < 6 && n; depth++) {
    for (let p = n.previousSibling; p; p = p.previousSibling) {
      if (p.nodeType === 3 ? /[\p{L}\p{N}]/u.test(p.nodeValue) : p.nodeType === 1 && /[\p{L}\p{N}]/u.test(p.textContent || '')) return false;
    }
    const par = n.parentElement;
    if (!par) return true;
    if (BLOCK.test(par.tagName) || (par.classList && (par.classList.contains('m') || par.classList.contains('tab') || par.classList.contains('mod')))) return true;
    const d = getComputedStyle(par).display;
    if (d !== 'inline' && d !== 'contents') return true;
    n = par;
  }
  return true;
}

function fixText(t) {
  if (done.has(t)) return;
  const v = t.nodeValue;
  if (!v) return;
  const el = t.parentElement;
  if (!el) return;
  const sk = el.closest(SKIP); if (sk) return trOnly(sk);
  let n = brand(tr(v));
  // las rutas (~/.config/…, C:\…, /algo) no llevan mayúscula
  if (on && LOWER.test(n) && !PATHLIKE.test(n) && startsBlock(t)) n = upFirst(n);
  if (n === v) return;
  done.add(t);
  t.__orig = v;
  t.nodeValue = n;
}
function fixAttr(el) {
  for (const a of ['placeholder', 'title', 'aria-label']) {
    const v = el.getAttribute && el.getAttribute(a);
    if (!v || el.closest('[data-raw]') || el.dataset['orig' + a.replace('-', '')]) continue;
    let n = brand(tr(v)); if (on && LOWER.test(n)) n = upFirst(n);
    if (n !== v) { el.dataset['orig' + a.replace('-', '')] = v; el.setAttribute(a, n); }
  }
}
// zonas salteadas que igual son texto de la interfaz: el (i) de ayuda y el subtítulo de los avisos (solo se traducen)
const PLACEHOLDER = new Set(['sin reproducir', 'nada sonando', 'nada sonando todavía', 'buscando la letra…', 'sin letra', 'la letra aparece acá cuando pongas una canción', 'no se encontró letra para esta canción', 'se buscó en youtube music y lrclib', 'youtube music no tiene letra para esta versión', 'activá lrclib en ajustes → letras para buscar en más lugares', '🌐 traducir', 'ocultar traducción']);
function trOnly(el) {
  if (el.classList.contains('tipi')) { const v = el.getAttribute('title'); if (v && !el.dataset.origtitle) { const n = tr(v); if (n !== v) { el.dataset.origtitle = v; el.setAttribute('title', n); } } return; }
  // en la zona de "lo que suena" solo los textos de relleno (cuando no hay canción), nunca un título
  if (el.matches('[data-np], .np-t, .lyr, #fLyrics')) { for (const t of el.querySelectorAll ? [el, ...el.querySelectorAll('*')] : [el]) for (const x of t.childNodes) if (x.nodeType === 3 && PLACEHOLDER.has(x.nodeValue.trim().toLowerCase()) && !done.has(x)) { const n = tr(x.nodeValue); if (n !== x.nodeValue) { done.add(x); x.__orig = x.nodeValue; x.nodeValue = n; } } return; }
  if (el.matches('.toast .ts')) for (const t of el.childNodes) if (t.nodeType === 3 && !done.has(t)) { const n = tr(t.nodeValue); if (n !== t.nodeValue) { done.add(t); t.__orig = t.nodeValue; t.nodeValue = n; } }
}
function walk(root) {
  if (!root) return;
  if (root.nodeType === 3) return fixText(root);
  if (root.nodeType !== 1) return;
  const sk = root.closest(SKIP); if (sk) return trOnly(sk);
  fixAttr(root);
  // los campos de texto se saltean, pero su texto de ayuda (placeholder) es de la interfaz
  root.querySelectorAll('input[placeholder],textarea[placeholder]').forEach(fixAttr);
  const it = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode: (n) => (n.nodeType === 1 ? (n.matches(SKIP) ? (trOnly(n), NodeFilter.FILTER_REJECT) : (fixAttr(n), NodeFilter.FILTER_SKIP)) : NodeFilter.FILTER_ACCEPT),
  });
  for (let n = it.nextNode(); n; n = it.nextNode()) fixText(n);
}

let pending = new Set(), timer = 0;
const flush = () => { timer = 0; busy = true; for (const n of pending) if (n.isConnected) walk(n); pending.clear(); busy = false; };
const mo = new MutationObserver((list) => {
  if (busy) return;
  for (const m of list) {
    if (m.type === 'characterData') { done.delete(m.target); pending.add(m.target); }
    else for (const n of m.addedNodes) pending.add(n);
  }
  // en el momento (antes de que se vea), no en el próximo cuadro: con la ventana oculta los cuadros se frenan
  if (!timer) { timer = 1; flush(); }
});

// apagar: devolver todo a como estaba
function undo() {
  const it = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = it.nextNode(); n; n = it.nextNode()) if (n.__orig != null) { n.nodeValue = n.__orig; delete n.__orig; done.delete(n); }
  document.querySelectorAll('[data-origplaceholder],[data-origtitle],[data-origarialabel]').forEach((el) => {
    for (const [k, a] of [['origplaceholder', 'placeholder'], ['origtitle', 'title'], ['origarialabel', 'aria-label']]) if (el.dataset[k]) { el.setAttribute(a, el.dataset[k]); delete el.dataset[k]; }
  });
}

export function applyCaps() {
  on = P.get('caps') !== false;
  document.body.classList.toggle('caps', on);
  // apagar la mayúscula inicial: se vuelve todo atrás y se aplica solo el nombre con mayúscula
  if (!on) undo();
  walk(document.body);
  mo.observe(document.body, { childList: true, subtree: true, characterData: true });
}
export function setCaps(v) { P.set('caps', !!v); applyCaps(); bus.emit('caps', !!v); }
