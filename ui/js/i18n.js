// idioma de la interfaz: español (como está escrito el código), inglés o portugués.
// Los textos se traducen al mostrarse (mismo recorrido que la mayúscula inicial, ver caps.js), así que nunca se tocan
// tus canciones, artistas, playlists, letras ni lo que escribís. Si un texto no está en el diccionario, queda en español.
import DATA from './i18n-data.js';

export const LANGS = [['es', 'Español'], ['en', 'English'], ['pt', 'Português']];
let lang = null, col = 0;
const map = new Map();
let prefixes = null;

function current() {
  if (lang) return lang;
  let v = null;
  try { v = JSON.parse(localStorage.getItem('pw-lang') || 'null'); } catch {}
  if (!v) { const n = String(navigator.language || 'es').slice(0, 2).toLowerCase(); v = n === 'en' || n === 'pt' ? n : 'es'; }
  lang = ['es', 'en', 'pt'].includes(v) ? v : 'es';
  col = { es: 0, en: 1, pt: 2 }[lang];
  if (col) {
    for (const r of DATA) map.set(r[0].replace(/\s+/g, ' ').trim().toLowerCase(), r);
    document.documentElement.lang = lang;
  }
  return lang;
}
export const getLang = () => current();
export function setLang(v) {
  try { localStorage.setItem('pw-lang', JSON.stringify(v)); } catch {}
  location.reload();
}

// textos con números o nombres que cambian ("12 canciones", "conectado como juan")
const NUM = [
  [/^(\d+) canciones$/, ['$1 songs', '$1 músicas']],
  [/^1 canción$/, ['1 song', '1 música']],
  [/^(\d+) artistas$/, ['$1 artists', '$1 artistas']],
  [/^(\d+) álbumes$/, ['$1 albums', '$1 álbuns']],
  [/^(\d+) min$/, ['$1 min', '$1 min']],
  [/^hace (\d+) min$/, ['$1 min ago', 'há $1 min']],
  [/^hace (\d+) h$/, ['$1 h ago', 'há $1 h']],
  [/^hace (\d+) días?$/, ['$1 days ago', 'há $1 dias']],
  [/^(\d+) en cola ⇣$/, ['$1 queued ⇣', '$1 na fila ⇣']],
  [/^(\d+) descargas en cola ⇣$/, ['$1 downloads queued ⇣', '$1 downloads na fila ⇣']],
  [/^(\d+) canciones guardadas · (.+)$/, ['$1 saved songs · $2', '$1 músicas salvas · $2']],
  [/^próxima: (.+) · en (.+)$/, ['next: $1 · in $2', 'próxima: $1 · em $2']],
  [/^repetir: no$/, ['repeat: off', 'repetir: não']],
  [/^repetir: toda la cola$/, ['repeat: whole queue', 'repetir: toda a fila']],
  [/^repetir: esta canción$/, ['repeat: this song', 'repetir: esta música']],
  [/^aleatorio: sí$/, ['shuffle: on', 'aleatório: sim']],
  [/^aleatorio: no$/, ['shuffle: off', 'aleatório: não']],
  [/^se detiene en (\d+) min ⏾$/, ['stops in $1 min ⏾', 'para em $1 min ⏾']],
  [/^(\d+) minutos$/, ['$1 minutes', '$1 minutos']],
  [/^descargar (\d+) a mi PC$/, ['download $1 to my PC', 'baixar $1 no meu PC']],
  [/^descargar las (\d+) online$/, ['download the $1 online', 'baixar as $1 online']],
  [/^(\d+) canciones van a sonar después$/, ['$1 songs will play next', '$1 músicas vão tocar em seguida']],
  [/^vuelve a sonar en (\d+) min ⏰$/, ['rings again in $1 min ⏰', 'toca de novo em $1 min ⏰']],
  [/^posponer (\d+) min$/, ['snooze $1 min', 'adiar $1 min']],
  [/^(\d+) canciones · (.+)$/, ['$1 songs · $2', '$1 músicas · $2']],
  [/^❀ Tu (\d{4}) en Petalwave$/, ['❀ Your $1 in Petalwave', '❀ Seu $1 no Petalwave']],
  [/^hay una versión nueva: (\S+) \(tenés (\S+)\)$/, ["there's a new version: $1 (you have $2)", 'há uma versão nova: $1 (você tem $2)']],
  [/^desde las (\d+) h · desde las (\d+) h$/, ['from $1:00 · from $2:00', 'das $1 h · das $2 h']],
  [/^memoria de Petalwave · RAM del sistema: (.+)$/, ['Petalwave memory · system RAM: $1', 'memória do Petalwave · RAM do sistema: $1']],
  // con una parte que también se traduce
  [/^ordenar por (.+)$/i, (m) => ['Sort by ', 'Ordenar por '][col - 1] + (look(m[1]) || m[1])],
  [/^escuchado \((.+)\)$/i, (m) => ['Listened (', 'Ouvido ('][col - 1] + (look(m[1]) || m[1]) + ')'],
  [/^rendimiento: (\S+) \(clic para cambiar\)$/i, (m) => ['Performance: ', 'Desempenho: '][col - 1] + (look(m[1]) || m[1]) + [' (click to change)', ' (clique para mudar)'][col - 1]],
  [/^ventana (.+) · datos en$/i, (m) => ['Window ', 'Janela '][col - 1] + (look(m[1]) || m[1]) + [' · data in', ' · dados em'][col - 1]],
  [/^Petalwave completo: /, (m, core) => core.replace('Petalwave completo', ['Petalwave total', 'Petalwave completo'][col - 1]).replace('RAM del sistema', ['system RAM', 'RAM do sistema'][col - 1]).replace('heap de JavaScript', ['JavaScript heap', 'heap do JavaScript'][col - 1])],
];
// "texto conocido: algo" o "texto conocido como/de/en… algo": la parte conocida se traduce y el resto queda igual
const JOIN = /(:| como| a| de| en| por| para| desde| con| al| del)$/;
const DAYS = { 'dom': ['sun', 'dom'], 'lun': ['mon', 'seg'], 'mar': ['tue', 'ter'], 'mié': ['wed', 'qua'], 'jue': ['thu', 'qui'], 'vie': ['fri', 'sex'], 'sáb': ['sat', 'sáb'] };

const keep = (src, t) => (/^\p{Lu}/u.test(src) && /^\p{Ll}/u.test(t) ? t[0].toUpperCase() + t.slice(1) : t);
function look(core) {
  const r = map.get(core.toLowerCase());
  if (r) return keep(core, r[col]);
  const d = DAYS[core.toLowerCase()];
  if (d) return keep(core, d[col - 1]);
  for (const [re, out] of NUM) { const mm = re.exec(core); if (mm) return typeof out === 'function' ? out(mm, core) : core.replace(re, out[col - 1]); }
  // "texto conocido: algo" o "texto conocido algo" (p. ej. "conectado como juan", "las descargas van a C:\…")
  if (core.length < 240) {
    if (!prefixes) prefixes = [...map.keys()].filter((k) => k.length >= 6 && JOIN.test(k)).sort((a, b) => b.length - a.length);
    const low = core.toLowerCase();
    for (const k of prefixes) {
      if (low.length > k.length && low.startsWith(k) && /\s/.test(low[k.length])) return keep(core, map.get(k)[col]) + core.slice(k.length);
    }
  }
  return null;
}

// traducir un texto tal como está en la pantalla (respeta espacios del principio y del final)
export function tr(v) {
  if (current() === 'es' || !v) return v;
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(v);
  const core = m[2].replace(/\s+/g, ' ');
  if (!core || !/\p{L}{2}/u.test(core)) return v;
  const t = look(core);
  return t == null ? v : m[1] + t + m[3];
}
// para textos que el código arma y no pasan por la pantalla (avisos del sistema, etc.)
export const T_ = (s) => tr(s);
