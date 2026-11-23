// pruebas automáticas de Petalwave (las corre probar.bat). No toca tus datos: usa una copia aparte en %TEMP%.
// 1) revisa que todo el código se pueda leer (JS y Python)  2) prueba las funciones importantes contra un servidor de prueba
// 3) ataca ese servidor con datos rotos (fuzz.js) y comprueba que no se caiga ni tire errores internos
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const PORT = 3791;
const BASE = `http://127.0.0.1:${PORT}`;
let ok = 0, bad = 0;
const pass = (name) => { ok++; console.log('  ✓ ' + name); };
const fail = (name, why) => { bad++; console.log('  ✗ ' + name + (why ? ' — ' + why : '')); };
const check = (name, cond, why) => (cond ? pass(name) : fail(name, why));

function walk(dir, ext, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'vendor', '__pycache__', 'www', 'build', '.gradle'].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, ext, out); else if (ext.includes(path.extname(e.name))) out.push(p);
  }
  return out;
}

async function req(method, p, body, headers = {}) {
  const r = await fetch(BASE + p, { method, body, headers: { 'Content-Type': 'application/json', ...headers }, signal: AbortSignal.timeout(20000) });
  let j = null; const t = await r.text(); try { j = JSON.parse(t); } catch {}
  return { status: r.status, j, t, h: r.headers };
}

(async () => {
  console.log('\n❀ Petalwave · pruebas automáticas\n');
  // ---------- 1. código ----------
  console.log('1. el código se puede leer');
  const js = [path.join(ROOT, 'server.js'), ...walk(path.join(ROOT, 'src'), ['.js']), ...walk(path.join(ROOT, 'ui', 'js'), ['.js'])];
  const jsBad = js.filter((f) => spawnSync(process.execPath, ['--check', f]).status !== 0);
  check(`${js.length} archivos JavaScript`, !jsBad.length, jsBad.map((f) => path.relative(ROOT, f)).join(', '));
  const py = [path.join(ROOT, 'src', 'ytm_bridge.py'), path.join(ROOT, 'android', 'app', 'src', 'main', 'python', 'petalwave', 'server.py')].filter(fs.existsSync);
  const pyExe = ['python', 'py'].find((x) => spawnSync(x, ['--version']).status === 0);
  if (pyExe) {
    const r = spawnSync(pyExe, ['-c', 'import ast,sys\nfor f in sys.argv[1:]: ast.parse(open(f,encoding="utf-8").read())', ...py], { encoding: 'utf8' });
    check(`${py.length} archivos Python`, r.status === 0, (r.stderr || '').split('\n').slice(-3).join(' '));
  } else console.log('  · Python no está instalado: se salta');
  const ctl = [...js, ...py].filter((f) => /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(fs.readFileSync(f, 'utf8')));
  check('sin caracteres invisibles colados', !ctl.length, ctl.map((f) => path.relative(ROOT, f)).join(', '));

  // ---------- 2. servidor de prueba ----------
  console.log('\n2. funciones importantes (servidor de prueba en una copia aparte)');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'petalwave-prueba-'));
  for (const f of ['server.js', 'index.html', 'version.json']) fs.copyFileSync(path.join(ROOT, f), path.join(tmp, f));
  for (const d of ['src', 'ui', 'build']) fs.cpSync(path.join(ROOT, d), path.join(tmp, d), { recursive: true });
  if (fs.existsSync(path.join(ROOT, 'lib'))) fs.cpSync(path.join(ROOT, 'lib'), path.join(tmp, 'lib'), { recursive: true });
  const srv = spawn(process.execPath, ['server.js', '--no-open'], { cwd: tmp, env: { ...process.env, PORT: String(PORT), PW_UPDATE_MANIFEST: '' }, stdio: 'ignore', windowsHide: true });
  let up = false;
  for (let i = 0; i < 40 && !up; i++) { await new Promise((r) => setTimeout(r, 300)); try { up = (await fetch(BASE + '/api/status')).ok; } catch {} }
  check('el servidor arranca', up);
  if (up) {
    try {
      let r = await req('GET', '/');
      check('la interfaz carga', r.status === 200 && /<html/i.test(r.t));
      check('encabezados de seguridad', /frame-ancestors 'none'/.test(r.h.get('content-security-policy') || '') && r.h.get('x-frame-options') === 'DENY');
      r = await req('POST', '/api/settings', '{"concurrency":3}', { Origin: 'https://evil.example' });
      check('otra página web no puede cambiar ajustes', r.status === 403);
      // fetch no deja cambiar el encabezado Host: se usa http directo (como haría una página con DNS rebinding)
      const hostStatus = await new Promise((ok) => {
        const q = require('http').request({ host: '127.0.0.1', port: PORT, path: '/api/settings', headers: { Host: 'evil.example:' + PORT } }, (res) => { res.resume(); ok(res.statusCode); });
        q.on('error', () => ok(0)); q.end();
      });
      check('DNS rebinding bloqueado', hostStatus === 403, 'respondió ' + hostStatus);
      r = await req('GET', '/ui/..%5c..%5cserver.js');
      check('no se puede leer fuera de la interfaz', r.status === 404 || r.status === 403);
      r = await req('POST', '/api/settings', JSON.stringify({ concurrency: 3 }));
      check('guardar ajustes', r.status === 200 && r.j && r.j.concurrency === 3);
      r = await req('POST', '/api/settings', JSON.stringify({ downloadDir: { a: 1 } }));
      check('carpeta inválida rechazada', r.status === 400);
      r = await req('POST', '/api/playlists', JSON.stringify({ create: { name: 'prueba ❀', tracks: ['yt_dQw4w9WgXcQ'] } }));
      check('crear playlist', r.status === 200 && r.j && r.j.name === 'prueba ❀');
      r = await req('POST', '/api/playlists', JSON.stringify({ like: { id: 'yt_dQw4w9WgXcQ', on: true } }));
      check('me gusta', r.status === 200 && r.j && r.j.id === 'liked' && r.j.tracks.includes('yt_dQw4w9WgXcQ'));
      r = await req('POST', '/api/playlists', JSON.stringify({ id: 'liked', delete: true }));
      check('"Me gusta" no se puede borrar', r.status >= 400);
      r = await req('POST', '/api/taste', JSON.stringify({ events: [{ k: 'play', id: 'x', s: 100, d: 120 }, { k: 'hackeo' }] }));
      check('señales de gustos (solo válidas)', r.status === 200 && r.j && r.j.n === 1);
      r = await req('POST', '/api/recognize', 'hola', { 'Content-Type': 'audio/webm' });
      check('¿qué suena? rechaza grabaciones vacías', r.status === 400);
      r = await req('GET', '/api/recognize/config');
      check('¿qué suena? nunca devuelve la clave', r.status === 200 && !('token' in (r.j || {})));
      r = await req('POST', '/api/settings', 'null');
      check('cuerpo "null" no rompe nada', r.status === 200);
      r = await req('GET', '/api/stats?range=year');
      check('estadísticas del año', r.status === 200 && r.j && r.j.range === 'year');
      // ---------- 3. ataque ----------
      console.log('\n3. ataque con datos rotos (más de 600 pedidos)');
      const f = spawnSync(process.execPath, [path.join(__dirname, 'fuzz.js'), BASE], { encoding: 'utf8', timeout: 300000 });
      const out = f.stdout || '';
      const errs = out.split('\n').filter((l) => /^500 |EL SERVIDOR SE CAYÓ/.test(l));
      check('el servidor no se cae', /servidor vivo al final: true/.test(out), 'revisá la salida de fuzz.js');
      check('sin errores internos (500)', !errs.length, errs.slice(0, 3).join(' | '));
    } catch (e) { fail('las pruebas no pudieron terminar', e.message); }
  }
  try { await fetch(BASE + '/api/quit', { method: 'POST' }); } catch {}
  setTimeout(() => { try { srv.kill(); } catch {} try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} }, 600);
  console.log(`\n${bad ? '✗' : '✓'} ${ok} pruebas bien, ${bad} con problemas\n`);
  setTimeout(() => process.exit(bad ? 1 : 0), 900);
})();
