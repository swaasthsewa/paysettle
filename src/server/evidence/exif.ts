/**
 * F3.04 minimal JPEG EXIF reader (no packages): APP1 "Exif" → TIFF → IFD0 → Exif IFD (DateTimeOriginal) and GPS IFD
 * (latitude/longitude). Every offset is bounds-checked; malformed input returns what was read so far, never throws.
 * Correction from the PRD: EXIF and GPS are signals, not proof of authenticity — they are trivially editable.
 * craftExifJpeg() builds a tiny valid JPEG with chosen GPS/time (tests and the playground's spoofed-GPS scenario).
 */
export interface ExifInfo { lat?: number; lng?: number; takenAt?: string; hasExif: boolean }

const T_EXIF_IFD = 0x8769, T_GPS_IFD = 0x8825, T_DATETIME = 0x0132, T_DT_ORIGINAL = 0x9003;
const TYPE_SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };

export function parseJpegExif(buf: Buffer): ExifInfo {
  const out: ExifInfo = { hasExif: false };
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return out;
  let p = 2;
  for (let guard = 0; guard < 64 && p + 4 <= buf.length; guard++) {
    if (buf[p] !== 0xff) return out;
    const marker = buf[p + 1];
    if (marker === 0xd9 || marker === 0xda) return out; // end of image / start of scan: no more metadata
    const len = buf.readUInt16BE(p + 2);
    if (len < 2 || p + 2 + len > buf.length) return out;
    if (marker === 0xe1 && len >= 16 && buf.toString("latin1", p + 4, p + 10) === "Exif\0\0") {
      try { readTiff(buf.subarray(p + 10, p + 2 + len), out); } catch { /* malformed: keep partial result */ }
      return out;
    }
    p += 2 + len;
  }
  return out;
}

function readTiff(t: Buffer, out: ExifInfo) {
  if (t.length < 8) return;
  const order = t.toString("latin1", 0, 2);
  const le = order === "II";
  if (!le && order !== "MM") return;
  const u16 = (o: number) => (o + 2 <= t.length ? (le ? t.readUInt16LE(o) : t.readUInt16BE(o)) : NaN);
  const u32 = (o: number) => (o + 4 <= t.length ? (le ? t.readUInt32LE(o) : t.readUInt32BE(o)) : NaN);
  if (u16(2) !== 42) return;
  out.hasExif = true;

  type Entry = { tag: number; type: number; count: number; valueAt: number };
  const ifd = (off: number): Entry[] => {
    const n = u16(off);
    if (!Number.isFinite(n) || n > 512) return [];
    const list: Entry[] = [];
    for (let i = 0; i < n; i++) {
      const e = off + 2 + i * 12;
      if (e + 12 > t.length) break;
      const tag = u16(e), type = u16(e + 2), count = u32(e + 4);
      const size = (TYPE_SIZE[type] ?? 1) * count;
      const valueAt = size <= 4 ? e + 8 : u32(e + 8);
      if (!Number.isFinite(valueAt) || valueAt + Math.min(size, 64) > t.length) continue;
      list.push({ tag, type, count, valueAt });
    }
    return list;
  };
  const ascii = (e: Entry) => t.toString("latin1", e.valueAt, Math.min(t.length, e.valueAt + Math.min(e.count, 64))).replace(/\0.*$/, "");
  const rational = (o: number) => { const n = u32(o), d = u32(o + 4); return d ? n / d : NaN; };
  const dms = (e: Entry) => (e.type === 5 && e.count >= 3 ? rational(e.valueAt) + rational(e.valueAt + 8) / 60 + rational(e.valueAt + 16) / 3600 : NaN);
  const toIso = (s: string) => { const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(s); return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}` : undefined; };

  const ifd0 = ifd(u32(4));
  const ptr = (tag: number) => { const e = ifd0.find((x) => x.tag === tag); return e ? u32(e.valueAt) : NaN; };
  const dt0 = ifd0.find((x) => x.tag === T_DATETIME);
  if (dt0) out.takenAt = toIso(ascii(dt0));
  const exifOff = ptr(T_EXIF_IFD);
  if (Number.isFinite(exifOff)) {
    const dto = ifd(exifOff).find((x) => x.tag === T_DT_ORIGINAL);
    if (dto) out.takenAt = toIso(ascii(dto)) ?? out.takenAt;
  }
  const gpsOff = ptr(T_GPS_IFD);
  if (Number.isFinite(gpsOff)) {
    const g = ifd(gpsOff);
    const get = (tag: number) => g.find((x) => x.tag === tag);
    const latRef = get(1), lat = get(2), lngRef = get(3), lng = get(4);
    if (lat && lng) {
      let la = dms(lat), lo = dms(lng);
      if (latRef && ascii(latRef).startsWith("S")) la = -la;
      if (lngRef && ascii(lngRef).startsWith("W")) lo = -lo;
      if (Number.isFinite(la) && Number.isFinite(lo) && Math.abs(la) <= 90 && Math.abs(lo) <= 180) { out.lat = la; out.lng = lo; }
    }
  }
}

/** Great-circle distance in metres (haversine). */
export function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Build a minimal JPEG (big-endian TIFF) carrying GPS and DateTimeOriginal. Not a viewable photo; enough for the parser. */
export function craftExifJpeg(p: { lat?: number; lng?: number; takenAt?: string } = {}): Buffer {
  const entries: { tag: number; type: number; count: number; data: Buffer }[][] = [[], [], []]; // ifd0, exif, gps
  const be16 = (n: number) => { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b; };
  const be32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0); return b; };
  const rat = (v: number, d: number) => Buffer.concat([be32(Math.round(v * d)), be32(d)]);
  const dmsBuf = (deg: number) => { const a = Math.abs(deg); const d = Math.floor(a); const mf = (a - d) * 60; const m = Math.floor(mf); const s = (mf - m) * 60; return Buffer.concat([rat(d, 1), rat(m, 1), rat(s, 10000)]); };
  const asciiBuf = (s: string) => Buffer.from(s + "\0", "latin1");
  if (p.takenAt) { const s = p.takenAt.replace(/-/g, ":").replace("T", " ").slice(0, 19); entries[1].push({ tag: T_DT_ORIGINAL, type: 2, count: 20, data: asciiBuf(s) }); }
  if (p.lat !== undefined && p.lng !== undefined) {
    entries[2].push({ tag: 1, type: 2, count: 2, data: asciiBuf(p.lat < 0 ? "S" : "N") });
    entries[2].push({ tag: 2, type: 5, count: 3, data: dmsBuf(p.lat) });
    entries[2].push({ tag: 3, type: 2, count: 2, data: asciiBuf(p.lng < 0 ? "W" : "E") });
    entries[2].push({ tag: 4, type: 5, count: 3, data: dmsBuf(p.lng) });
  }
  // layout: header(8) | ifd0 | exif ifd | gps ifd | data area
  const ifdSize = (n: number) => 2 + n * 12 + 4;
  const ifd0Count = 2;
  const off0 = 8, offExif = off0 + ifdSize(ifd0Count), offGps = offExif + ifdSize(entries[1].length);
  let dataOff = offGps + ifdSize(entries[2].length);
  const data: Buffer[] = [];
  const writeIfd = (list: { tag: number; type: number; count: number; data: Buffer }[]) => {
    const parts: Buffer[] = [be16(list.length)];
    for (const e of list) {
      let value: Buffer;
      if (e.data.length <= 4) value = Buffer.concat([e.data, Buffer.alloc(4 - e.data.length)]);
      else { value = be32(dataOff); data.push(e.data); dataOff += e.data.length; }
      parts.push(be16(e.tag), be16(e.type), be32(e.count), value);
    }
    parts.push(be32(0));
    return Buffer.concat(parts);
  };
  const i0 = writeIfd([{ tag: T_EXIF_IFD, type: 4, count: 1, data: be32(offExif) }, { tag: T_GPS_IFD, type: 4, count: 1, data: be32(offGps) }]);
  const i1 = writeIfd(entries[1]);
  const i2 = writeIfd(entries[2]);
  const tiff = Buffer.concat([Buffer.from("MM", "latin1"), be16(42), be32(off0), i0, i1, i2, ...data]);
  const app1Body = Buffer.concat([Buffer.from("Exif\0\0", "latin1"), tiff]);
  return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe1]), be16(app1Body.length + 2), app1Body, Buffer.from([0xff, 0xd9])]);
}
