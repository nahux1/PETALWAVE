// cuánta gente baja Petalwave: suma las descargas de cada versión publicada en GitHub (sin rastrear a nadie)
// uso: node tools/descargas.js   (o doble clic en tools\descargas.bat)
const REPO = 'nahux1/PETALWAVE';
(async () => {
  const all = [];
  for (let page = 1; page < 10; page++) {
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=100&page=${page}`, { headers: { 'User-Agent': 'petalwave-descargas', Accept: 'application/vnd.github+json' } });
    if (!r.ok) throw new Error('GitHub respondió ' + r.status + (r.status === 403 ? ' (muchas consultas seguidas: probá en un rato)' : ''));
    const list = await r.json();
    all.push(...list);
    if (list.length < 100) break;
  }
  const n = (rel, re) => rel.assets.filter((a) => re.test(a.name)).reduce((s, a) => s + a.download_count, 0);
  let tw = 0, ta = 0, tu = 0;
  console.log('\n  versión      Windows (nueva)   Android   actualizaciones');
  console.log('  ' + '─'.repeat(56));
  for (const rel of all) {
    const w = n(rel, /windows\.zip$/i), a = n(rel, /\.apk$/i), u = n(rel, /update\.zip$/i);
    tw += w; ta += a; tu += u;
    console.log('  ' + rel.tag_name.padEnd(13) + String(w).padStart(10) + String(a).padStart(14) + String(u).padStart(14) + '   ' + (rel.published_at || '').slice(0, 10));
  }
  console.log('  ' + '─'.repeat(56));
  console.log('  ' + 'total'.padEnd(13) + String(tw).padStart(10) + String(ta).padStart(14) + String(tu).padStart(14));
  console.log('\n  Windows (nueva) = gente que la bajó entera · Android = APK · actualizaciones = PCs que se actualizaron solas');
  console.log('  (incluye tus propias descargas y pruebas)\n');
})().catch((e) => { console.log('\n  No se pudo consultar GitHub: ' + e.message + '\n'); process.exitCode = 1; });
