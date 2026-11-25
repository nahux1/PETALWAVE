// arma un video vertical corto (1080×1920, ~30 s, sin música) para TikTok / Reels / Shorts con las capturas de docs/capturas
// uso: node tools/promo/make-promo.js [ruta a ffmpeg]   → promo/petalwave-promo.mp4 (la música se agrega en la app de cada red)
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..', '..');
const ffmpeg = process.argv[2] || path.join(root, 'release', 'petalwave', 'bin', 'ffmpeg.exe');
const cap = (f) => path.join(root, 'docs', 'capturas', f);
const out = path.join(root, 'promo');
const tmp = path.join(out, 'tmp');
fs.mkdirSync(tmp, { recursive: true });

const FONT = 'C\\:/Windows/Fonts/segoeuib.ttf', FONT2 = 'C\\:/Windows/Fonts/segoeui.ttf';
const PINK = '0xff7a9a';
// cada texto va en un archivo (así los acentos y signos no se rompen)
let tn = 0;
const txt = (s) => { const f = path.join(tmp, `t${tn++}.txt`); fs.writeFileSync(f, s, 'utf8'); return f.replace(/\\/g, '/').replace(':', '\\:'); };
const draw = (s, size, y, color = 'white', font = FONT) => `drawtext=fontfile='${font}':textfile='${txt(s)}':fontsize=${size}:fontcolor=${color}:x=(w-text_w)/2:y=${y}:shadowcolor=black@0.6:shadowx=0:shadowy=4`;

// diapositivas: imagen, cómo se ubica (phone = vertical, desk = horizontal) y textos
const SLIDES = [
  { img: 'inicio.jpg', kind: 'title', lines: [['Petalwave', 150, 700, 'white'], ['música gratis', 70, 900, PINK], ['sin publicidad · sin cuenta', 52, 1000, 'white']] },
  { img: 'celular-explorar.jpg', kind: 'phone', lines: [['Lo más escuchado', 74, 70, 'white'], ['de tu país, sin cuenta', 52, 160, PINK]] },
  { img: 'celular-reproductor.jpg', kind: 'phone', lines: [['Letras y visualizador', 74, 70, 'white'], ['en el celular y en la PC', 52, 160, PINK]] },
  { img: 'inicio.jpg', kind: 'desk', lines: [['Aprende tus gustos', 80, 330, 'white'], ['recomendaciones con lo que', 54, 1400, PINK], ['escuchás, saltás y te gusta', 54, 1470, PINK]] },
  { img: 'fondos.jpg', kind: 'desk', lines: [['17 fondos', 90, 330, 'white'], ['8 animados que laten', 54, 1400, PINK], ['con la música', 54, 1470, PINK]] },
  { img: 'fondo-animado.jpg', kind: 'desk', lines: [['Fondos que laten', 90, 330, 'white'], ['con la música', 90, 430, 'white'], ['sacudida, pulso y destello', 54, 1400, PINK], ['(se apagan con un toque)', 48, 1470, 'white']] },
  { img: 'ecualizador.jpg', kind: 'desk', crop: 'crop=380:720:1020:50', w: 640, lines: [['Ecualizador', 90, 170, 'white'], ['10 bandas y presets', 54, 1640, PINK]] },
  { img: 'historial.jpg', kind: 'desk', lines: [['Tu historial', 90, 330, 'white'], ['todo lo que escuchaste, por día', 54, 1400, PINK]] },
  { img: 'descargas.jpg', kind: 'desk', lines: [['Bajá tu música', 90, 330, 'white'], ['mp3, m4a, opus o mp4', 54, 1400, PINK], ['para escuchar sin internet', 54, 1470, PINK]] },
  { img: 'que-suena.jpg', kind: 'desk', crop: 'crop=470:490:565:205', w: 820, lines: [['¿Qué suena?', 90, 250, 'white'], ['reconoce la canción', 54, 1560, PINK], ['que suena cerca tuyo', 54, 1630, PINK]] },
  { img: 'celular-inicio.jpg', kind: 'end', lines: [['Petalwave', 130, 650, 'white'], ['gratis para Windows y Android', 58, 830, PINK], ['github.com/nahux1/PETALWAVE', 50, 940, 'white']] },
];

const BG = 'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=28:3,eq=brightness=-0.28:saturation=1.2';
SLIDES.forEach((s, i) => {
  const texts = s.lines.map(([t, size, y, c]) => draw(t, size, y, c, size >= 80 ? FONT : FONT2)).join(',');
  let fc;
  if (s.kind === 'phone') fc = `[0]split[a][b];[a]${BG}[bg];[b]scale=-2:1560[fg];[bg][fg]overlay=(W-w)/2:290,${texts}`;
  else if (s.kind === 'desk') fc = `[0]split[a][b];[a]${BG}[bg];[b]${s.crop ? s.crop + ',' : ''}scale=${s.w || 1020}:-2[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2-40,${texts}`;
  else fc = `[0]${BG},eq=brightness=-0.1,${texts}`;
  execFileSync(ffmpeg, ['-y', '-v', 'error', '-i', cap(s.img), '-filter_complex', fc, '-frames:v', '1', path.join(tmp, `s${i}.png`)]);
  console.log('diapositiva', i + 1, s.img);
});

// video: cada diapositiva 3,2 s con un zoom lento, unidas con fundidos
const D = 3.2, X = 0.45, FPS = 30;
const args = ['-y', '-v', 'error'];
SLIDES.forEach((_, i) => args.push('-loop', '1', '-t', String(D), '-i', path.join(tmp, `s${i}.png`)));
let f = SLIDES.map((_, i) => `[${i}]scale=w='trunc(1080*(1+0.045*t/${D})/2)*2':h=-2:eval=frame,crop=1080:1920,fps=${FPS},format=yuv420p,setsar=1[v${i}]`).join(';');
let prev = 'v0', off = 0;
for (let i = 1; i < SLIDES.length; i++) {
  off += D - X;
  const outL = i === SLIDES.length - 1 ? 'vout' : `x${i}`;
  f += `;[${prev}][v${i}]xfade=transition=${i % 2 ? 'fade' : 'smoothup'}:duration=${X}:offset=${off.toFixed(2)}[${outL}]`;
  prev = outL;
}
const file = path.join(out, 'petalwave-promo.mp4');
args.push('-filter_complex', f, '-map', '[vout]', '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-r', String(FPS), file);
execFileSync(ffmpeg, args, { stdio: 'inherit' });
fs.rmSync(tmp, { recursive: true, force: true });
console.log('listo:', file, Math.round(fs.statSync(file).size / 1024) + ' KB');
