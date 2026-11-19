// genera release/latest.json para la Release: versión, notas, el paquete de Windows (tamaño y SHA-256) y el APK de Android
// uso: node tools/make-manifest.js <notas.md> [versión del APK] [base de URL para pruebas]
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const root = path.join(__dirname, '..');
const [notesFile, apkVersion, baseOverride] = process.argv.slice(2);
const v = JSON.parse(fs.readFileSync(path.join(root, 'version.json'), 'utf8').replace(/^﻿/, '')).version;
const rel = path.join(root, 'release');
const info = (name) => { const b = fs.readFileSync(path.join(rel, name)); return { size: b.length, sha256: crypto.createHash('sha256').update(b).digest('hex') }; };
const base = baseOverride || `https://github.com/nahux1/PETALWAVE/releases/download/v${v}/`;
const u = info('petalwave-update.zip');
const m = {
  version: v,
  title: 'petalwave ' + v,
  date: new Date().toISOString(),
  page: 'https://github.com/nahux1/PETALWAVE/releases/latest',
  notes: fs.readFileSync(notesFile, 'utf8').replace(/^﻿/, ''),
  update: { url: base + 'petalwave-update.zip', size: u.size, sha256: u.sha256 },
  full: { url: base + 'petalwave-windows.zip', size: fs.statSync(path.join(rel, 'petalwave-windows.zip')).size },
};
if (apkVersion) {
  const name = `Petalwave-android-${apkVersion}.apk`;
  const a = info(name);
  m.android = { version: apkVersion, url: base + name, size: a.size, sha256: a.sha256 };
}
fs.writeFileSync(path.join(rel, 'latest.json'), JSON.stringify(m, null, 2));
console.log('latest.json', v, '·', (u.size / 1048576).toFixed(1), 'MB', m.android ? '· android ' + m.android.version : '');
