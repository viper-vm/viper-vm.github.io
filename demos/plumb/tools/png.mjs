// Tiny PNG encoder + DXF preview renderer (debug aid, Node only).
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
export function writePNG(path, W, H, rgb) {
  const raw = Buffer.alloc((W * 3 + 1) * H);
  for (let y = 0; y < H; y++) { raw[y * (W * 3 + 1)] = 0; rgb.copy(raw, y * (W * 3 + 1) + 1, (H - 1 - y) * W * 3, (H - y) * W * 3); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  writeFileSync(path, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}
/** Canvas: world box → W×H image; draw segments with colours. */
export class Canvas {
  constructor(x0, y0, x1, y1, W) {
    this.x0 = x0; this.y0 = y0; this.s = W / (x1 - x0); this.W = W; this.H = Math.ceil((y1 - y0) * this.s);
    this.px = Buffer.alloc(this.W * this.H * 3, 255);
  }
  dot(i, j, c) { if (i < 0 || j < 0 || i >= this.W || j >= this.H) return; const k = (j * this.W + i) * 3; this.px[k] = c[0]; this.px[k + 1] = c[1]; this.px[k + 2] = c[2]; }
  line(x1, y1, x2, y2, c) {
    const a = (x1 - this.x0) * this.s, b = (y1 - this.y0) * this.s, e = (x2 - this.x0) * this.s, f = (y2 - this.y0) * this.s;
    const n = Math.max(1, Math.ceil(Math.hypot(e - a, f - b)));
    for (let k = 0; k <= n; k++) this.dot(Math.round(a + ((e - a) * k) / n), Math.round(b + ((f - b) * k) / n), c);
  }
  fill(x, y, c) { this.dot(Math.round((x - this.x0) * this.s), Math.round((y - this.y0) * this.s), c); }
  save(path) { writePNG(path, this.W, this.H, this.px); }
}
