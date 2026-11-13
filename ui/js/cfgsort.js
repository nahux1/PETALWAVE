// ordenar las secciones de ajustes: mantené apretado el título de una sección medio segundo y arrastrala
// a otro lugar de la grilla. El orden se guarda (P.cfgOrder) y se restablece con el botón de "ventanas".
import { P, toast } from './core.js';

const HOLD_MS = 450, MOVE_TOL = 8;
// clave estable de cada sección: el texto del título sin el ícono, en minúscula (no cambia con la mayúscula inicial)
const keyOf = (sec) => sec.dataset.sec || (sec.dataset.sec = (sec.querySelector('h3')?.textContent || '').toLowerCase().replace(/[^a-záéíóúñü ]/gi, '').replace(/\bi\b/g, '').trim().replace(/\s+/g, '-'));

export function applyCfgOrder(grid) {
  const order = P.get('cfgOrder');
  const secs = [...grid.querySelectorAll(':scope > .cfgsec')];
  secs.forEach(keyOf);
  if (!Array.isArray(order) || !order.length) return;
  const pos = new Map(order.map((k, i) => [k, i]));
  // las secciones nuevas (que no estaban en el orden guardado) quedan en su lugar de origen, al final de las conocidas
  secs.map((s, i) => ({ s, i, p: pos.has(keyOf(s)) ? pos.get(keyOf(s)) : 1000 + i }))
    .sort((a, b) => a.p - b.p)
    .forEach(({ s }) => grid.appendChild(s));
}

export function resetCfgOrder() { P.set('cfgOrder', []); }

export function bindCfgSort(grid, rerender) {
  applyCfgOrder(grid);
  let hold = null, drag = null;
  const cancelHold = () => { if (hold) { clearTimeout(hold.t); hold.sec.classList.remove('w-hold'); hold = null; } };

  grid.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || P.get('layoutLock')) return;
    const h3 = e.target.closest('.cfgsec > h3'); if (!h3 || e.target.closest('.tipi,button,input,a')) return;
    const sec = h3.parentElement;
    hold = { sec, x: e.clientX, y: e.clientY, t: setTimeout(() => begin(e), HOLD_MS) };
    sec.classList.add('w-hold');
  });
  const begin = (e) => {
    const sec = hold.sec; cancelHold();
    const r = sec.getBoundingClientRect();
    const ghost = document.createElement('div');
    ghost.className = 'w-ghost';
    ghost.innerHTML = `<b>${sec.querySelector('h3').textContent.trim()}</b><span>soltala donde quieras que quede</span>`;
    Object.assign(ghost.style, { width: Math.min(r.width, 420) + 'px', height: Math.min(r.height, 160) + 'px', left: r.left + 'px', top: r.top + 'px' });
    document.body.appendChild(ghost);
    const ph = document.createElement('div');
    ph.className = 'w-place cfgsec-place' + (sec.classList.contains('wide') ? ' wide' : '');
    ph.style.height = Math.min(r.height, 220) + 'px';
    sec.after(ph);
    drag = { sec, ghost, ph, dx: Math.min(e.clientX - r.left, Math.min(r.width, 420) - 20), dy: Math.min(e.clientY - r.top, 40) };
    sec.classList.add('w-dragging', 'cfg-dragging');
    document.body.classList.add('win-drag');
    move(e);
  };
  const move = (e) => {
    if (hold && !drag) { if (Math.hypot(e.clientX - hold.x, e.clientY - hold.y) > MOVE_TOL) cancelHold(); return; }
    if (!drag) return;
    e.preventDefault();
    drag.ghost.style.left = e.clientX - drag.dx + 'px';
    drag.ghost.style.top = e.clientY - drag.dy + 'px';
    // sección bajo el puntero: el lugar va antes o después según la mitad en la que esté
    const under = document.elementsFromPoint(e.clientX, e.clientY).map((el) => el.closest && el.closest('.cfgsec')).find((s) => s && s !== drag.sec && s.parentElement === grid);
    if (under) {
      const b = under.getBoundingClientRect();
      const after = under.classList.contains('wide') ? e.clientY > b.top + b.height / 2 : (e.clientX > b.left + b.width / 2 || e.clientY > b.bottom - 30);
      after ? under.after(drag.ph) : under.before(drag.ph);
    }
    // si el puntero llega al borde, la página de ajustes se desplaza sola
    const sc = grid.closest('#cfgBody') || grid.parentElement, sr = sc.getBoundingClientRect();
    if (e.clientY < sr.top + 50) sc.scrollTop -= 18; else if (e.clientY > sr.bottom - 50) sc.scrollTop += 18;
  };
  const end = (cancel) => {
    cancelHold();
    if (!drag) return;
    const d = drag; drag = null;
    d.ghost.remove();
    document.body.classList.remove('win-drag'); d.sec.classList.remove('w-dragging', 'cfg-dragging');
    if (!cancel) d.ph.replaceWith(d.sec); else d.ph.remove();
    if (cancel) return;
    const order = [...grid.querySelectorAll(':scope > .cfgsec')].map(keyOf);
    P.set('cfgOrder', order);
    if (!P.get('cfgSortTip')) { P.set('cfgSortTip', 1); toast('orden de ajustes guardado', { sub: 'restablecelo en tema → ventanas', ms: 2600 }); }
  };
  const up = () => end(false), cancel = () => end(true), esc = (e) => { if (e.key === 'Escape' && drag) { e.stopPropagation(); end(true); } };
  addEventListener('pointermove', move, { passive: false });
  addEventListener('pointerup', up);
  addEventListener('pointercancel', cancel);
  addEventListener('keydown', esc, true);
  // ajustes se vuelve a dibujar seguido: devolver cómo sacar los oyentes globales para no acumularlos
  return () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', cancel); removeEventListener('keydown', esc, true); };
}
