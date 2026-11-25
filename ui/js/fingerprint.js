// ❀ huella de audio para "¿qué suena?" (implementación propia, inspirada en SongRec: https://github.com/marin-m/songrec)
// De unos segundos de audio (16 kHz, mono) saca los picos del espectro y arma una "firma" chiquita (unos KB).
// Lo único que sale del equipo es esa firma: no se puede volver a escuchar el audio a partir de ella.
// Funciona igual en la interfaz (PC y Android) y en Node (para las pruebas).

const N = 2048, BINS = 1025, RING = 256, RATE = 16000;
const HANN = new Float64Array(N);
for (let i = 0; i < N; i++) HANN[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * (i + 1)) / 2049);

// FFT de 2048 puntos (radix 2), con tablas precalculadas
const REV = new Uint16Array(N), COS = new Float64Array(N / 2), SIN = new Float64Array(N / 2);
for (let i = 0, bits = Math.log2(N); i < N; i++) { let r = 0; for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b); REV[i] = r; }
for (let i = 0; i < N / 2; i++) { COS[i] = Math.cos((-2 * Math.PI * i) / N); SIN[i] = Math.sin((-2 * Math.PI * i) / N); }
function powerSpectrum(input, out) {
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let i = 0; i < N; i++) re[REV[i]] = input[i];
  for (let size = 2; size <= N; size <<= 1) {
    const half = size >> 1, step = N / size;
    for (let s = 0; s < N; s += size) {
      for (let k = 0; k < half; k++) {
        const a = s + k, b = a + half, c = COS[k * step], d = SIN[k * step];
        const tr = re[b] * c - im[b] * d, ti = re[b] * d + im[b] * c;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
      }
    }
  }
  for (let i = 0; i < BINS; i++) out[i] = Math.max((re[i] * re[i] + im[i] * im[i]) / (1 << 17), 1e-10);
}

const mod = (x) => ((x % RING) + RING) % RING;
const ring = () => ({ buf: Array.from({ length: RING }, () => new Float64Array(BINS)), pos: 0, n: 0 });
const NEIGHBORS = [-10, -7, -4, -3, 1, 2, 5, 8];
const OTHERS = [-53, -45, 165, 172, 179, 186, 193, 200, 214, 221, 228, 235, 242, 249];
const mag = (v) => Math.log(Math.max(1 / 64, v)) * 1477.3 + 6144;

// samples: enteros de 16 bits (Int16Array o números), 16 kHz mono → { bytes, samplems }
export function signature(samples) {
  const ffts = ring(), spread = ring();
  const win = new Float64Array(N), ringS = new Float64Array(N);
  let sPos = 0;
  const bands = [[], [], [], []];
  const total = samples.length - (samples.length % 128);
  for (let c = 0; c < total; c += 128) {
    // 1) FFT de los últimos 2048 samples
    for (let i = 0; i < 128; i++) ringS[(sPos + i) % N] = samples[c + i];
    sPos = (sPos + 128) % N;
    for (let i = 0; i < N; i++) win[i] = ringS[(sPos + i) % N] * HANN[i];
    const cur = ffts.buf[ffts.pos];
    powerSpectrum(win, cur);
    ffts.pos = (ffts.pos + 1) % RING; ffts.n++;
    // 2) "esparcir" los picos hacia los vecinos (en frecuencia y en tiempo)
    const last = Float64Array.from(cur);
    for (let p = 0; p < BINS; p++) {
      if (p < 1023) last[p] = Math.max(last[p], last[p + 1], last[p + 2]);
      let mx = last[p];
      for (const f of [-1, -3, -6]) { const o = spread.buf[mod(spread.pos + f)]; o[p] = mx = Math.max(o[p], mx); }
    }
    spread.buf[spread.pos] = last; spread.pos = (spread.pos + 1) % RING; spread.n++;
    if (spread.n < 46) continue;
    // 3) picos: más fuertes que sus vecinos de antes y de después
    const f46 = ffts.buf[mod(ffts.pos - 46)], s49 = spread.buf[mod(spread.pos - 49)];
    for (let b = 10; b < 1015; b++) {
      const v = f46[b];
      if (v < 1 / 64 || v < s49[b - 1]) continue;
      let mx = 0;
      for (const o of NEIGHBORS) mx = Math.max(mx, s49[b + o]);
      if (v <= mx) continue;
      for (const o of OTHERS) mx = Math.max(mx, spread.buf[mod(spread.pos + o)][b - 1]);
      if (v <= mx) continue;
      const m = mag(v), before = mag(f46[b - 1]), after = mag(f46[b + 1]);
      const v1 = m * 2 - before - after;
      if (!(v1 > 0)) continue;
      const bin = b * 64 + ((after - before) * 32) / v1;
      const hz = bin * (RATE / 2 / 1024 / 64);
      const band = hz > 250 && hz < 520 ? 0 : hz > 520 && hz < 1450 ? 1 : hz > 1450 && hz < 3500 ? 2 : hz > 3500 && hz <= 5500 ? 3 : -1;
      if (band < 0) continue;
      bands[band].push({ t: spread.n - 46, m: Math.trunc(m), bin: Math.trunc(bin) });
    }
  }
  return { bytes: encode(bands, total), samplems: Math.round((total / RATE) * 1000) };
}

// formato binario de la firma
function encode(bands, nSamples) {
  const parts = [];
  for (let band = 0; band < 4; band++) {
    const peaks = bands[band];
    if (!peaks.length) continue;
    const pb = [];
    let last = 0;
    for (const p of peaks) {
      if (p.t - last >= 255) { pb.push(0xff, p.t & 255, (p.t >> 8) & 255, (p.t >> 16) & 255, (p.t >>> 24) & 255); last = p.t; }
      pb.push(p.t - last, p.m & 255, (p.m >> 8) & 255, p.bin & 255, (p.bin >> 8) & 255);
      last = p.t;
    }
    while (pb.length % 4) pb.push(0);
    parts.push({ id: 0x60030040 + band, len: pb.length, data: pb });
  }
  const content = parts.reduce((a, p) => a + 8 + p.len, 0);
  const buf = new Uint8Array(48 + 8 + content);
  const dv = new DataView(buf.buffer);
  const u32 = (o, v) => dv.setUint32(o, v >>> 0, true);
  u32(0, 0xcafe2580); u32(8, content + 8); u32(12, 0x94119c00);
  u32(28, 3 << 27);                                    // 16 kHz
  u32(40, Math.trunc(nSamples + RATE * 0.24)); u32(44, (15 << 19) + 0x40000);
  u32(48, 0x40000000); u32(52, content + 8);
  let o = 56;
  for (const p of parts) { u32(o, p.id); u32(o + 4, p.len); buf.set(p.data, o + 8); o += 8 + p.len; }
  u32(4, crc32(buf.subarray(8)));
  return buf;
}

let CRC;
function crc32(b) {
  if (!CRC) { CRC = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC[n] = c >>> 0; } }
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return typeof btoa === 'function' ? btoa(s) : Buffer.from(bytes).toString('base64');
}

// audio grabado (Blob) → samples de 16 kHz mono en enteros de 16 bits
export async function blobTo16k(blob) {
  const ab = await blob.arrayBuffer();
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const tmp = new Ctx();
  let decoded;
  try { decoded = await tmp.decodeAudioData(ab); } finally { tmp.close().catch(() => {}); }
  const len = Math.ceil(decoded.duration * RATE);
  const off = new OfflineAudioContext(1, len, RATE);
  const src = off.createBufferSource(); src.buffer = decoded; src.connect(off.destination); src.start();
  const out = (await off.startRendering()).getChannelData(0);
  const s = new Int16Array(out.length);
  for (let i = 0; i < out.length; i++) s[i] = Math.max(-32768, Math.min(32767, Math.round(out[i] * 32767)));
  return s;
}
