// ajustes más fáciles: categorías arriba y un buscador que filtra las opciones mientras escribís
import { $, norm } from './core.js';

const CATS = [
  { id: 'todo', name: 'todo' },
  { id: 'look', name: 'apariencia', match: ['tema', 'mis temas', 'diseno', 'presets', 'fondo', 'que se muestra', 'visualizador', 'pantalla completa', 'reproductor'] },
  { id: 'play', name: 'reproducción', match: ['reproduccion', 'letras', 'atajos'] },
  { id: 'lib', name: 'biblioteca y descargas', match: ['biblioteca', 'descargas'] },
  { id: 'acc', name: 'cuentas', match: ['cuentas'] },
  { id: 'sys', name: 'sistema', match: ['rendimiento', 'acerca'] },
];
let cat = 'todo', q = '';

function catOf(sec) {
  const h = norm((sec.querySelector('h3') || {}).textContent || '');
  const c = CATS.find((x) => x.match && x.match.some((m) => h.includes(m)));
  return c ? c.id : 'sys';
}

function apply(box) {
  const ws = norm(q).split(/\s+/).filter(Boolean);
  let shown = 0;
  for (const sec of box.querySelectorAll('.cfgsec')) {
    if (!sec.dataset.cat) sec.dataset.cat = catOf(sec);
    const inCat = cat === 'todo' || sec.dataset.cat === cat;
    if (!ws.length) {
      sec.hidden = !inCat;
      sec.querySelectorAll('.cfg-hide').forEach((r) => r.classList.remove('cfg-hide'));
      if (inCat) shown++;
      continue;
    }
    const head = norm((sec.querySelector('h3') || {}).textContent || '');
    const headHit = ws.every((w) => head.includes(w));
    let hits = 0;
    for (const r of sec.querySelectorAll('.cfrow, .acc-card, .folders .fr')) {
      const ok = headHit || ws.every((w) => norm(r.textContent + ' ' + (r.querySelector('[title]') || {}).title).includes(w));
      r.classList.toggle('cfg-hide', !ok);
      if (ok) hits++;
    }
    sec.hidden = !(headHit || hits);
    if (!sec.hidden) shown++;
  }
  const none = $('#cfgNone'); if (none) none.hidden = shown > 0;
}

// se llama cada vez que se dibujan los ajustes
export function decorateSettings() {
  const box = $('#cfgBody'); if (!box || !box.querySelector('.cfgsec')) return;
  if (!box.querySelector('.cfgnav')) {
    const bar = document.createElement('div');
    bar.className = 'cfgnav';
    bar.innerHTML = `<input type="search" id="cfgQ" placeholder="buscar en ajustes… (p. ej. fondo, volumen, cookies)" autocomplete="off">
      <div class="cfgcats">${CATS.map((c) => `<button data-cat="${c.id}" class="${c.id === cat ? 'on' : ''}">${c.name}</button>`).join('')}</div>
      <div class="m" id="cfgNone" hidden>no encontré ese ajuste</div>`;
    box.prepend(bar);
    const inp = bar.querySelector('#cfgQ');
    inp.value = q;
    inp.oninput = () => { q = inp.value; apply(box); };
    bar.querySelector('.cfgcats').onclick = (e) => {
      const b = e.target.closest('[data-cat]'); if (!b) return;
      cat = b.dataset.cat;
      bar.querySelectorAll('[data-cat]').forEach((x) => x.classList.toggle('on', x === b));
      apply(box);
      box.scrollTop = 0;
    };
  }
  apply(box);
}

export function initCfgNav() {
  const box = $('#cfgBody'); if (!box) return;
  // los ajustes se redibujan solos en varios casos: volver a poner la barra y el filtro cada vez
  new MutationObserver(() => { if (!box.querySelector('.cfgnav') || box.querySelector('.cfgsec:not([data-cat])')) decorateSettings(); }).observe(box, { childList: true, subtree: true });
}
