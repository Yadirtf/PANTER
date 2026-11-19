/**
 * Rasterizado y PNG sin dependencias, para que la web y la app registren los íconos como
 * imágenes del mapa sin canvas ni librerías nativas de SVG.
 */

export type Point = readonly [number, number];

export type Shape =
  | { kind: 'circle'; cx: number; cy: number; r: number; fill: string }
  | { kind: 'polygon'; points: readonly Point[]; fill: string };

/** Imagen RGBA sin premultiplicar: el formato de `map.addImage(id, { width, height, data })`. */
export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8Array;
}

function parseHex(color: string): [number, number, number] {
  const match = /^#([0-9a-f]{6})$/i.exec(color);
  if (!match?.[1]) throw new Error(`Color no soportado (usa #rrggbb): ${color}`);
  const n = parseInt(match[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function inPolygon(x: number, y: number, points: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i]!;
    const [xj, yj] = points[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function contains(shape: Shape, x: number, y: number): boolean {
  if (shape.kind === 'circle') {
    const dx = x - shape.cx;
    const dy = y - shape.cy;
    return dx * dx + dy * dy <= shape.r * shape.r;
  }
  return inPolygon(x, y, shape.points);
}

/** Pinta las figuras en orden (la última queda encima), con 4×4 submuestras por píxel. */
export function rasterize(
  shapes: readonly Shape[],
  size: number,
  pixelRatio: number,
  samples = 4,
): RgbaImage {
  const width = Math.round(size * pixelRatio);
  const height = width;
  const data = new Uint8Array(width * height * 4);
  const colors = shapes.map((s) => parseHex(s.fill));
  const scale = size / width;
  const total = samples * samples;

  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let hits = 0;
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const x = (px + (sx + 0.5) / samples) * scale;
          const y = (py + (sy + 0.5) / samples) * scale;
          for (let i = shapes.length - 1; i >= 0; i--) {
            if (contains(shapes[i]!, x, y)) {
              const c = colors[i]!;
              r += c[0];
              g += c[1];
              b += c[2];
              hits++;
              break;
            }
          }
        }
      }
      if (hits === 0) continue;
      const o = (py * width + px) * 4;
      data[o] = Math.round(r / hits);
      data[o + 1] = Math.round(g / hits);
      data[o + 2] = Math.round(b / hits);
      data[o + 3] = Math.round((hits / total) * 255);
    }
  }
  return { width, height, data };
}

/** SVG equivalente a las figuras (mismo orden de pintado). */
export function toSvg(shapes: readonly Shape[], size: number): string {
  const fmt = (n: number) => String(Math.round(n * 100) / 100);
  const body = shapes
    .map((s) =>
      s.kind === 'circle'
        ? `<circle cx="${fmt(s.cx)}" cy="${fmt(s.cy)}" r="${fmt(s.r)}" fill="${s.fill}"/>`
        : `<polygon points="${s.points.map(([x, y]) => `${fmt(x)},${fmt(y)}`).join(' ')}" fill="${s.fill}"/>`,
    )
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${body}</svg>`;
}

// --- PNG (zlib con bloques sin comprimir: los íconos pesan pocos KB) ------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (const byte of bytes) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function u32(n: number): number[] {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
}

function chunk(type: string, data: Uint8Array): number[] {
  const typed = new Uint8Array(4 + data.length);
  for (let i = 0; i < 4; i++) typed[i] = type.charCodeAt(i);
  typed.set(data, 4);
  return [...u32(data.length), ...typed, ...u32(crc32(typed))];
}

function zlibStored(raw: Uint8Array): Uint8Array {
  const out: number[] = [0x78, 0x01];
  const MAX = 65535;
  let pos = 0;
  do {
    const len = Math.min(MAX, raw.length - pos);
    const last = pos + len >= raw.length ? 1 : 0;
    out.push(last, len & 255, len >> 8, ~len & 255, (~len >> 8) & 255);
    for (let i = 0; i < len; i++) out.push(raw[pos + i]!);
    pos += len;
  } while (pos < raw.length);
  out.push(...u32(adler32(raw)));
  return Uint8Array.from(out);
}

/** Codifica una imagen RGBA como PNG (8 bits por canal, sin entrelazado). */
export function encodePng(image: RgbaImage): Uint8Array {
  const { width, height, data } = image;
  const raw = new Uint8Array((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filtro None
    raw.set(data.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
  }
  const ihdr = Uint8Array.from([...u32(width), ...u32(height), 8, 6, 0, 0, 0]);
  return Uint8Array.from([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...chunk('IHDR', ihdr),
    ...chunk('IDAT', zlibStored(raw)),
    ...chunk('IEND', new Uint8Array(0)),
  ]);
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Base64 estándar sin depender de btoa ni Buffer (Hermes, navegador y Node). */
export function toBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]!;
    out += b === undefined ? '=' : B64[(n >> 6) & 63]!;
    out += c === undefined ? '=' : B64[n & 63]!;
  }
  return out;
}
