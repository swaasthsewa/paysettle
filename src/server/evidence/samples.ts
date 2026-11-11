/**
 * F3.04 sample evidence files generated in code (no binary fixtures): a minimal valid PNG and a one-page PDF.
 * Used by scripts/seed-evidence.ts, the tests, and available to the playground's scenarios.
 */
import { deflateSync } from "node:zlib";

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(b: Buffer): number { let c = 0xffffffff; for (const x of b) c = CRC_TABLE[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** A small RGB PNG that looks like a wireframe screen (header bar, cards), tinted by `hue` (0–360). */
export function samplePng(width = 320, height = 200, hue = 170): Buffer {
  const [r0, g0, b0] = hsl(hue, 0.55, 0.42), [r1, g1, b1] = hsl(hue, 0.35, 0.92);
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x++) {
      const header = y < 28;
      const card = !header && y > 44 && y < height - 16 && ((x > 16 && x < width / 2 - 8) || (x > width / 2 + 8 && x < width - 16));
      const line = card && (y - 44) % 22 < 4 && y > 60;
      const [r, g, b] = header ? [r0, g0, b0] : line ? [r0, g0, b0] : card ? [255, 255, 255] : [r1, g1, b1];
      const i = row + 1 + x * 3; raw[i] = r; raw[i + 1] = g; raw[i + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
function hsl(h: number, s: number, l: number): [number, number, number] {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => { const k = (n + h / 30) % 12; return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); };
  return [f(0), f(8), f(4)];
}

/** A valid one-page PDF with the given lines of text (Helvetica, ASCII only). */
export function samplePdf(title: string, lines: string[]): Buffer {
  const esc = (s: string) => s.replace(/[^\x20-\x7e]/g, "?").replace(/([\\()])/g, "\\$1");
  const text = [`BT /F1 18 Tf 56 760 Td (${esc(title)}) Tj ET`, ...lines.map((l, i) => `BT /F1 11 Tf 56 ${728 - i * 18} Td (${esc(l)}) Tj ET`)].join("\n");
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(text, "latin1")} >>\nstream\n${text}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => { offsets.push(Buffer.byteLength(out, "latin1")); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

/**
 * A7 test photos: a deterministic "photograph" — soft light blobs over a gradient with fine grain — so the
 * duplicate-photo check sees a photographic image (many colours, real gradients). Different seeds give unrelated images.
 * Returns raw RGBA too, so tests can alter a copy (brightness, a scribble) and re-encode it.
 */
export function photoRgba(seed: number, width = 96, height = 72): { width: number; height: number; data: Buffer } {
  let s = (seed * 2654435761) >>> 0 || 1;
  const rnd = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 0x1_0000_0000; };
  const blobs = Array.from({ length: 6 }, () => ({ x: rnd() * width, y: rnd() * height, r: (0.15 + rnd() * 0.35) * width, c: [rnd() * 255, rnd() * 255, rnd() * 255], w: rnd() > 0.5 ? 1 : -1 }));
  const g0 = [rnd() * 255, rnd() * 255, rnd() * 255], g1 = [rnd() * 255, rnd() * 255, rnd() * 255], ang = rnd() * Math.PI * 2;
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const t = Math.min(1, Math.max(0, 0.5 + ((x / width - 0.5) * Math.cos(ang) + (y / height - 0.5) * Math.sin(ang))));
    const px = [0, 1, 2].map((k) => g0[k] * (1 - t) + g1[k] * t);
    for (const b of blobs) {
      const d = Math.hypot(x - b.x, y - b.y) / b.r;
      if (d < 1) { const f = (1 - d * d) * 0.7 * b.w; for (let k = 0; k < 3; k++) px[k] += (b.c[k] - px[k]) * Math.abs(f) * (f > 0 ? 1 : -0.4); }
    }
    const i = (y * width + x) * 4;
    for (let k = 0; k < 3; k++) data[i + k] = Math.max(0, Math.min(255, Math.round(px[k] + (rnd() - 0.5) * 18)));
    data[i + 3] = 255;
  }
  return { width, height, data };
}

/** PNG encoding of RGBA pixels (colour type 6, no compression filter). */
export function rgbaToPng(img: { width: number; height: number; data: Buffer }): Buffer {
  const raw = Buffer.alloc((img.width * 4 + 1) * img.height);
  for (let y = 0; y < img.height; y++) { raw[y * (img.width * 4 + 1)] = 0; img.data.copy(raw, y * (img.width * 4 + 1) + 1, y * img.width * 4, (y + 1) * img.width * 4); }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(img.width, 0); ihdr.writeUInt32BE(img.height, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

/** A photographic test PNG for a seed. */
export const samplePhotoPng = (seed: number, width = 96, height = 72) => rgbaToPng(photoRgba(seed, width, height));
