// arma el texto de la Release de GitHub: las notas de la versión + un bloque estándar de descargas y ayuda
// uso: node tools/release-body.js tools/notes/2.17.0.md release/release-body.md   (sin el segundo, lo muestra en pantalla)
const fs = require('fs');
const path = require('path');
const notes = fs.readFileSync(process.argv[2], 'utf8').replace(/^﻿/, '').replace(/<!--[\s\S]*?-->/g, '').trim();
const v = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'version.json'), 'utf8').replace(/^﻿/, '')).version;
const D = 'https://github.com/nahux1/PETALWAVE/releases/latest/download/';
const body = (`${notes}

---

### ⬇️ Descargar

| | |
|---|---|
| 💻 **Windows** (lo más fácil) | **[Instalar-Petalwave.exe](${D}Instalar-Petalwave.exe)**: lo abrís, tocás *Instalar* y listo |
| 💻 Windows sin instalador | [petalwave-windows.zip](${D}petalwave-windows.zip): extraer y abrir \`petalwave.exe\` |
| 📱 **Android** | **[Petalwave-android.apk](${D}Petalwave-android.apk)**: abrir en el celular e instalar |

¿Ya la tenés? Se actualiza sola desde la app con el botón **⬆**.
Si Windows dice *"Windows protegió su PC"*: **Más información → Ejecutar de todas formas** (es nueva y no tiene firma paga).

🌐 [Página web](https://nahux1.github.io/PETALWAVE/) · 🐞 [Avisar un error](https://github.com/nahux1/PETALWAVE/issues/new?template=error.yml) · 💡 [Sugerir algo](https://github.com/nahux1/PETALWAVE/issues/new?template=sugerencia.yml)

<sub>Petalwave ${v} · gratis, sin publicidad y de código abierto.</sub>
`);
// se escribe en UTF-8 sin BOM (con BOM, GitHub no reconoce el primer título)
if (process.argv[3]) fs.writeFileSync(process.argv[3], body, 'utf8'); else process.stdout.write(body);
