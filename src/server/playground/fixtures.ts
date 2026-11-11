/**
 * F5.08 chaos injector fixtures: test files generated in code, so the playground needs no binary assets.
 *  · jpegWithGps(lat, lng): a valid 1×1 baseline JPEG with an EXIF APP1 segment carrying GPS latitude/longitude and a DateTime.
 *  · minimalPdf(lines): a one-page PDF with correct xref offsets.
 *  · fileFor(kind): one file per proof-spec artifact kind (IMAGE, PDF, LINK, LOG, VIDEO, SIGNATURE).
 * EXIF/GPS is a signal, not proof (F3.04 correction): these files exist to show that the signal is read and checked.
 */
import type { ProofSpec } from "@/db/schema";

export interface SimFile { name: string; type: string; bytes: Buffer; exif?: Record<string, unknown> }

/** The demo workshop / site every physical scenario uses (Pune, India). */
export const SITE = { lat: 18.5204, lng: 73.8567, label: "Workshop, Pune (simulated site)" } as const;

const R_EARTH_M = 6_371_000;
const rad = (d: number) => (d * Math.PI) / 180, deg = (r: number) => (r * 180) / Math.PI;

/** Great-circle distance in metres. */
export function haversineM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R_EARTH_M * Math.asin(Math.sqrt(h));
}

/** The point `distanceM` metres from `from` along `bearingDeg`. */
export function destination(from: { lat: number; lng: number }, distanceM: number, bearingDeg: number): { lat: number; lng: number } {
  const d = distanceM / R_EARTH_M, b = rad(bearingDeg), la1 = rad(from.lat), lo1 = rad(from.lng);
  const la2 = Math.asin(Math.sin(la1) * Math.cos(d) + Math.cos(la1) * Math.sin(d) * Math.cos(b));
  const lo2 = lo1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(la1), Math.cos(d) - Math.sin(la1) * Math.sin(la2));
  return { lat: Number(deg(la2).toFixed(6)), lng: Number(deg(lo2).toFixed(6)) };
}

/** A point 85 km north-east of the site: the spoofed photo of scenario S2. */
export const SPOOF_POINT = destination(SITE, 85_000, 45);
/** A point 40 m from the site: the valid photo. */
export const VALID_POINT = destination(SITE, 40, 120);

/* ── JPEG with EXIF GPS ── */

function seg(marker: number, body: Buffer): Buffer {
  const h = Buffer.alloc(4); h.writeUInt16BE(marker, 0); h.writeUInt16BE(body.length + 2, 2);
  return Buffer.concat([h, body]);
}

/** Degrees → three EXIF rationals (deg/1, min/1, sec×10000/10000), big-endian. */
function dms(x: number): Buffer {
  const a = Math.abs(x), d = Math.floor(a), mf = (a - d) * 60, m = Math.floor(mf), s = Math.round((mf - m) * 60 * 10_000);
  const b = Buffer.alloc(24);
  b.writeUInt32BE(d, 0); b.writeUInt32BE(1, 4); b.writeUInt32BE(m, 8); b.writeUInt32BE(1, 12); b.writeUInt32BE(s, 16); b.writeUInt32BE(10_000, 20);
  return b;
}

function entry(tag: number, type: number, count: number, value: Buffer | number): Buffer {
  const e = Buffer.alloc(12);
  e.writeUInt16BE(tag, 0); e.writeUInt16BE(type, 2); e.writeUInt32BE(count, 4);
  if (typeof value === "number") e.writeUInt32BE(value, 8); else value.copy(e, 8, 0, Math.min(4, value.length));
  return e;
}

/** EXIF APP1 payload ("Exif\0\0" + big-endian TIFF) with IFD0 { DateTime, GPSInfo } and a GPS IFD. */
function exifApp1(lat: number, lng: number, when: Date): Buffer {
  // offsets are relative to the TIFF header
  const IFD0 = 8, IFD0_LEN = 2 + 2 * 12 + 4, DT = IFD0 + IFD0_LEN, DT_LEN = 20, GPS = DT + DT_LEN, GPS_LEN = 2 + 5 * 12 + 4, LAT = GPS + GPS_LEN, LNG = LAT + 24;
  const tiff = Buffer.from([0x4d, 0x4d, 0x00, 0x2a, 0, 0, 0, IFD0]);
  const n2 = (n: number) => { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b; };
  const p = (n: number) => String(n).padStart(2, "0");
  const dt = Buffer.alloc(DT_LEN); dt.write(`${when.getUTCFullYear()}:${p(when.getUTCMonth() + 1)}:${p(when.getUTCDate())} ${p(when.getUTCHours())}:${p(when.getUTCMinutes())}:${p(when.getUTCSeconds())}`, "ascii");
  const ifd0 = Buffer.concat([n2(2), entry(0x0132, 2, DT_LEN, DT), entry(0x8825, 4, 1, GPS), Buffer.alloc(4)]);
  const gps = Buffer.concat([
    n2(5),
    entry(0x0000, 1, 4, Buffer.from([2, 2, 0, 0])),
    entry(0x0001, 2, 2, Buffer.from(lat >= 0 ? "N\0" : "S\0", "ascii")),
    entry(0x0002, 5, 3, LAT),
    entry(0x0003, 2, 2, Buffer.from(lng >= 0 ? "E\0" : "W\0", "ascii")),
    entry(0x0004, 5, 3, LNG),
    Buffer.alloc(4),
  ]);
  return Buffer.concat([Buffer.from("Exif\0\0", "binary"), tiff, ifd0, dt, gps, dms(lat), dms(lng)]);
}

/** A decodable 1×1 grey baseline JPEG; with GPS when lat/lng are given. `label` goes into a COM segment so every photo hashes differently. */
export function jpegWithGps(lat?: number, lng?: number, when: Date = new Date(), label = ""): Buffer {
  const dqt = seg(0xffdb, Buffer.concat([Buffer.from([0x00]), Buffer.alloc(64, 1)]));
  const sof = seg(0xffc0, Buffer.from([8, 0, 1, 0, 1, 1, 1, 0x11, 0]));
  const huff = (cls: number) => Buffer.concat([Buffer.from([cls << 4]), Buffer.from([1, ...new Array(15).fill(0)]), Buffer.from([0])]);
  const dht = seg(0xffc4, Buffer.concat([huff(0), huff(1)]));
  const sos = seg(0xffda, Buffer.from([1, 1, 0x00, 0, 63, 0]));
  const app1 = lat !== undefined && lng !== undefined ? seg(0xffe1, exifApp1(lat, lng, when)) : Buffer.alloc(0);
  const com = label ? seg(0xfffe, Buffer.from(label.slice(0, 200), "latin1")) : Buffer.alloc(0);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app1, com, dqt, sof, dht, sos, Buffer.from([0x3f]), Buffer.from([0xff, 0xd9])]);
}

/** Reads GPS back out of a JPEG built by jpegWithGps (and any big- or little-endian EXIF). Used by tests and the wire log. */
export function readJpegGps(buf: Buffer): { lat: number; lng: number } | null {
  let i = 2;
  while (i + 4 <= buf.length && buf[i] === 0xff) {
    const marker = buf.readUInt16BE(i), len = buf.readUInt16BE(i + 2);
    if (marker === 0xffe1 && buf.toString("binary", i + 4, i + 10) === "Exif\0\0") {
      const t = i + 10, le = buf.toString("binary", t, t + 2) === "II";
      const u16 = (o: number) => (le ? buf.readUInt16LE(t + o) : buf.readUInt16BE(t + o));
      const u32 = (o: number) => (le ? buf.readUInt32LE(t + o) : buf.readUInt32BE(t + o));
      const ifd = (o: number) => { const n = u16(o); return Array.from({ length: n }, (_, k) => ({ tag: u16(o + 2 + k * 12), at: o + 2 + k * 12 })); };
      const gpsPtr = ifd(u32(4)).find((e) => e.tag === 0x8825);
      if (!gpsPtr) return null;
      const g = ifd(u32(gpsPtr.at + 8));
      const ref = (tag: number) => String.fromCharCode(buf[t + (g.find((e) => e.tag === tag)?.at ?? 0) + 8]);
      const val = (tag: number) => { const e = g.find((x) => x.tag === tag); if (!e) return NaN; const o = u32(e.at + 8); const r = (k: number) => u32(o + k * 8) / u32(o + k * 8 + 4); return r(0) + r(1) / 60 + r(2) / 3600; };
      const lat = val(0x0002) * (ref(0x0001) === "S" ? -1 : 1), lng = val(0x0004) * (ref(0x0003) === "W" ? -1 : 1);
      return Number.isFinite(lat) && Number.isFinite(lng) ? { lat: Number(lat.toFixed(6)), lng: Number(lng.toFixed(6)) } : null;
    }
    if (marker === 0xffda) break;
    i += 2 + len;
  }
  return null;
}

/* ── PDF ── */

/** A one-page PDF (Helvetica text) with a correct cross-reference table. */
export function minimalPdf(lines: string[]): Buffer {
  const esc = (s: string) => s.replace(/[\\()]/g, (c) => "\\" + c).replace(/[^\x20-\x7e]/g, "?");
  const text = lines.map((l, k) => `BT /F1 12 Tf 56 ${760 - k * 18} Td (${esc(l)}) Tj ET`).join("\n");
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(text, "latin1")} >>\nstream\n${text}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n%\xe2\xe3\xcf\xd3\n";
  const offs: number[] = [];
  objs.forEach((o, k) => { offs.push(Buffer.byteLength(out, "latin1")); out += `${k + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("")}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

/* ── one file per proof kind ── */

/** A minimal MP4 header (ftyp) plus a `free` box carrying a label, so each video hashes differently. */
function mp4(label: string): Buffer {
  const ftyp = Buffer.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 2, 0, 0x69, 0x73, 0x6f, 0x6d, 0x69, 0x73, 0x6f, 0x32]);
  const body = Buffer.from(label.slice(0, 200), "latin1");
  const free = Buffer.alloc(8); free.writeUInt32BE(8 + body.length, 0); free.write("free", 4, "latin1");
  return Buffer.concat([ftyp, free, body]);
}

export function gpsExif(lat: number, lng: number, when: Date) { return { lat, lng, takenAt: when.toISOString().slice(0, 19) }; }

export function photo(point: { lat: number; lng: number } | null, name: string, when: Date): SimFile {
  const bytes = point ? jpegWithGps(point.lat, point.lng, when, name) : jpegWithGps(undefined, undefined, when, name);
  return { name, type: "image/jpeg", bytes, exif: point ? gpsExif(point.lat, point.lng, when) : undefined };
}

/** One file for an uploadable artifact kind (IMAGE, PDF, VIDEO, LOG). LINK, SIGNATURE and ORACLE live in the note instead. */
export function fileFor(kind: ProofSpec["artifacts"][number]["kind"], code: string, n: number, note: string | undefined, when: Date, point: { lat: number; lng: number } | null = null): SimFile | null {
  const label = `${code} · ${note ?? kind} · simulated file ${n}`;
  const c = code.toLowerCase();
  switch (kind) {
    case "IMAGE": return photo(point, `${c}-photo-${n}.jpg`, when);
    case "PDF": return { name: `${c}-document-${n}.pdf`, type: "application/pdf", bytes: minimalPdf(["PaySettle Judge Playground - simulated document", label, `Generated ${when.toISOString()}`]) };
    case "LOG": return { name: `${c}-log-${n}.txt`, type: "text/plain", bytes: Buffer.from(`# ${label}\n[ok] 42 tests passed, 0 failed\n[ok] build green at ${when.toISOString()}\n`) };
    case "VIDEO": return { name: `${c}-walkthrough-${n}.mp4`, type: "video/mp4", bytes: mp4(label) };
    default: return null;
  }
}

/** Every file a proof spec asks for (each uploadable artifact × its minimum count). Photos carry GPS at `point` when given. */
export function filesForSpec(spec: ProofSpec, code: string, when: Date, point: { lat: number; lng: number } | null = SITE): SimFile[] {
  const out: SimFile[] = [];
  let k = 0;
  for (const a of spec.artifacts) for (let n = 1; n <= Math.max(1, a.min); n++) { const f = fileFor(a.kind, code, ++k, a.note, when, point); if (f) out.push(f); }
  return out;
}

/**
 * The submission note: the text, one demo URL per LINK required, and confirmation markers for SIGNATURE and ORACLE
 * artifacts (the evidence module's upload form writes the same `[confirmed:KIND]` markers when the provider ticks the boxes).
 */
export function noteForSpec(spec: ProofSpec, code: string, text: string): string {
  const links: string[] = [], marks = new Set<string>();
  for (const a of spec.artifacts) {
    if (a.kind === "LINK") for (let n = 1; n <= Math.max(1, a.min); n++) links.push(`https://staging.example.com/${code.toLowerCase()}/${links.length + 1}`);
    if (a.kind === "SIGNATURE" || a.kind === "ORACLE") marks.add(`[confirmed:${a.kind}]`);
  }
  return [text, ...links, [...marks].join(" ")].filter(Boolean).join("\n");
}
