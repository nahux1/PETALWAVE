// "ataque" de prueba al servidor local de Petalwave: datos rotos en cada pedido, buscando caídas y errores 500
// uso: node fuzz.js <base> [token]
const [base, token] = process.argv.slice(2);
const H = token ? { 'X-Petalwave-Token': token } : {};
const SKIP = new Set(['/api/quit', '/api/update/apply', '/api/open', '/api/downloads']);   // cierran la app / abren ventanas / bajan cosas
const posts = ['/api/settings', '/api/playlists', '/api/library/folders', '/api/library/rescan', '/api/taste', '/api/stats/play', '/api/wallpaper',
  '/api/cookies', '/api/import', '/api/ytm/rate', '/api/spotify/config', '/api/spotify/match', '/api/spotify/url', '/api/sync', '/api/yt/inspect',
  '/api/downloads/history'];
const big = 'A'.repeat(300000);
const bodies = [
  '', 'null', '[]', '"texto"', '{"a":', '{}', '12345678901234567890', '{"__proto__":{"x":1}}', 'true',
  JSON.stringify({ ui: 'no-objeto', concurrency: 'abc', videoDir: 123, downloadDir: { a: 1 }, lyricsOnline: 'si' }),
  JSON.stringify({ ui: { ['a'.repeat(5000)]: big } }),
  JSON.stringify({ create: { name: { x: 1 }, tracks: 'no-lista' } }),
  JSON.stringify({ create: null }), JSON.stringify({ like: null }), JSON.stringify({ like: { id: null } }), JSON.stringify({ like: { id: 'yt_' + 'x'.repeat(11) } }),
  JSON.stringify({ id: 'liked', delete: true }), JSON.stringify({ id: 'liked', rename: 'otro' }), JSON.stringify({ id: 'no-existe', add: ['x'] }),
  JSON.stringify({ id: 'liked', add: [null, 1, {}, 'yt_dQw4w9WgXcQ'], remove: { a: 1 }, set: 'no' }),
  JSON.stringify({ add: { a: 1 } }), JSON.stringify({ add: '..\\..\\..\\Windows' }), JSON.stringify({ remove: null }), JSON.stringify({ add: '' }),
  JSON.stringify({ events: 'no' }), JSON.stringify({ events: [null, 1, 'x', { k: 'play', t: 'mañana', s: 'x' }, { k: 'like', id: { a: 1 } }] }),
  JSON.stringify({ events: Array(5000).fill({ k: 'play', id: 'x', s: 1e308 }) }),
  JSON.stringify({ id: null, seconds: 'x' }), JSON.stringify({ id: 'abc', seconds: 1e308, duration: -5, completed: 'yes' }),
  JSON.stringify({ videoId: null }), JSON.stringify({ videoId: '../../etc', rating: 'DISLIKE' }),
  JSON.stringify({ url: 'file:///C:/Windows/win.ini' }), JSON.stringify({ url: '--exec calc' }), JSON.stringify({ urls: ['-o', '--exec=calc'] }),
  JSON.stringify({ clientId: '../../x' }), JSON.stringify({ sources: 'x', add: { url: 1 } }),
  '# Netscape\n' + big,
];
const results = [];
let n = 0;
async function hit(method, path, body, headers = {}) {
  const t0 = Date.now();
  try {
    const r = await fetch(base + path, { method, body: method === 'GET' || method === 'DELETE' ? undefined : body, headers: { ...H, 'Content-Type': 'application/json', ...headers }, signal: AbortSignal.timeout(20000) });
    const txt = await r.text();
    n++;
    if (r.status >= 500 || Date.now() - t0 > 15000) results.push(`${r.status} ${method} ${path} (${Date.now() - t0} ms) cuerpo=${String(body).slice(0, 60)} → ${txt.slice(0, 160)}`);
  } catch (e) { results.push(`FALLA ${method} ${path} cuerpo=${String(body).slice(0, 60)} → ${e.name}: ${e.message}`); }
}
async function alive() { try { const r = await fetch(base + '/api/status', { headers: H, signal: AbortSignal.timeout(5000) }); return r.ok; } catch { return false; } }
(async () => {
  for (const p of posts) {
    if (SKIP.has(p)) continue;
    for (const b of bodies) {
      await hit('POST', p, b);
      if (!(await alive())) { results.push(`*** EL SERVIDOR SE CAYÓ tras POST ${p} cuerpo=${b.slice(0, 80)}`); console.log(results.join('\n')); process.exit(1); }
    }
  }
  const gets = ['/api/stats?range=zzz', '/api/stats?range=', '/api/ytm/search?q=', '/api/ytm/search?q=' + encodeURIComponent('"\'<script>'), '/api/ytm/search?filter=../&q=a',
    '/api/ytm/songs?ids=', '/api/ytm/songs?ids=' + 'a'.repeat(11) + ',' + '../../aaaaa', '/api/ytm/songs?ids=' + Array(300).fill('dQw4w9WgXcQ').join(','),
    '/api/ytm/radio/aaaaaaaaaaa', '/api/ytm/playlist/' + 'x'.repeat(300), '/api/ytm/album/..', '/media/0000000000000000', '/media/../../server.js', '/cover/zzzz',
    '/cover/0000000000000000?s=zz', '/ytcover/aaaaaaaaaaa?s=m', '/ui/../server.js', '/ui/%2e%2e/server.js', '/ui/..%5cserver.js', '/ui/js/../../server.js',
    '/wallpaper', '/api/lyrics/0000000000000000', '/api/similar/0000000000000000', '/api/library/duplicates', '/api/sync/discover', '/api/spotify/list?id=..',
    '/api/taste', '/api/autoplaylists', '/' + 'x'.repeat(8000), '/api/update'];
  for (const g of gets) { await hit('GET', g); if (!(await alive())) { results.push(`*** EL SERVIDOR SE CAYÓ tras GET ${g}`); break; } }
  for (const d of ['/api/wallpaper', '/api/taste', '/api/downloads/history', '/api/nada']) await hit('DELETE', d);
  // métodos raros y encabezados rotos
  await hit('PUT', '/api/settings', '{}'); await hit('PATCH', '/api/playlists', '{}');
  await hit('POST', '/api/settings', '{}', { 'Content-Length': '99999999' }).catch(() => {});
  console.log(`pedidos hechos: ${n} · problemas: ${results.length}`);
  console.log(results.join('\n'));
  console.log('servidor vivo al final: ' + (await alive()));
})();
