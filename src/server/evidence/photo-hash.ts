/**
 * A7 duplicate-photo check (F3.04 signals). For every JPEG/PNG in an evidence package:
 *  - exact SHA-256 of the bytes, and
 *  - a 64-bit difference hash (dHash): decode, convert to grey (Rec. 601 luma), box-downscale to 9×8, and set bit (r, c)
 *    when cell (r, c) is brighter than cell (r, c + 1). Re-encoding, resizing or a small brightness change keeps most bits.
 * On submit the package's photos are compared with photos stored for OTHER contracts and for other milestones of the same
 * contract (a resubmission for the same milestone is normal). A match — same SHA-256, or Hamming distance ≤ 6 — gives
 * signal DUPLICATE_PHOTO at level "fail". The other contract is never named: the provider sees "another contract".
 *
 * Only photographs are compared. Screens, wireframes and other flat graphics legitimately look alike across contracts, and a
 * tiny image (under 9×8 pixels) carries no usable gradient; those are hashed and stored but not compared (`photographic`
 * false). The photograph test is a heuristic: at least 64 distinct colours (4 bits per channel) on a sampling grid.
 * Images above the decode limit are compared by SHA-256 only.
 *
 * Comparison scope keeps data worlds apart: real contracts compare with real contracts only; a playground simulation only
 * with itself; an automated-test organisation only with itself (src/lib/sim.ts decides what is sim or test data).
 * P11: bytes are untrusted. Image dimensions are checked from the header before decoding, and decoding is bounded.
 */
import { and, eq, ne, sql } from "drizzle-orm";
import { decode as jpegDecode } from "jpeg-js";
import { PNG } from "pngjs";
import type { Db, Tx } from "@/db/client";
import { workspaces } from "@/db/schema";
import { evidencePhotoHashes } from "@/db/schema-evidence";
import { simWorkspaces } from "@/db/schema-sim";
import { excludeSim, isTestOrgId } from "@/lib/sim";
import type { Signal } from "./spec";

export const DHASH_MAX_DISTANCE = 6;
/** Larger images are not decoded for the check (still stored and compared by SHA-256). 24 MP covers phone cameras. */
export const MAX_DECODE_PIXELS = 24_000_000;
const PHOTO_MIN_COLOURS = 64;
const GRID_W = 9, GRID_H = 8;

export interface ImageHash { sha256: string; dhash: bigint | null; photographic: boolean; width: number; height: number; reason?: string }

/* ── decoding (bounded) ── */

interface Rgba { width: number; height: number; data: Uint8Array }

/** Width and height from the file header, without decoding pixels. */
export function imageSize(type: string, b: Buffer): { width: number; height: number } | null {
  if (type === "image/png") {
    if (b.length < 24 || b.toString("latin1", 12, 16) !== "IHDR") return null;
    return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  }
  if (type === "image/jpeg") {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const marker = b[i + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      if (marker === 0xd9 || marker === 0xda) return null;
      const len = b.readUInt16BE(i + 2);
      if ((marker >= 0xc0 && marker <= 0xcf) && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
      i += 2 + len;
    }
  }
  return null;
}

function decode(type: string, b: Buffer): Rgba {
  if (type === "image/png") {
    const p = PNG.sync.read(b);
    return { width: p.width, height: p.height, data: p.data };
  }
  const j = jpegDecode(b, { useTArray: true, formatAsRGBA: true, maxResolutionInMP: MAX_DECODE_PIXELS / 1_000_000, maxMemoryUsageInMB: 512 });
  return { width: j.width, height: j.height, data: j.data };
}

/* ── hashing (pure) ── */

/** Rec. 601 luma of every pixel of an RGBA buffer (alpha composited on white). */
function luma(img: Rgba): Float64Array {
  const n = img.width * img.height, out = new Float64Array(n), d = img.data;
  for (let i = 0; i < n; i++) {
    const a = d[i * 4 + 3] / 255;
    const r = d[i * 4] * a + 255 * (1 - a), g = d[i * 4 + 1] * a + 255 * (1 - a), bl = d[i * 4 + 2] * a + 255 * (1 - a);
    out[i] = 0.299 * r + 0.587 * g + 0.114 * bl;
  }
  return out;
}

/** Box-filter downscale of a grey image to w×h (each cell is the mean of the source pixels it covers). */
export function downscale(grey: Float64Array, width: number, height: number, w = GRID_W, h = GRID_H): Float64Array {
  const out = new Float64Array(w * h);
  for (let cy = 0; cy < h; cy++) {
    const y0 = Math.floor((cy * height) / h), y1 = Math.max(y0 + 1, Math.floor(((cy + 1) * height) / h));
    for (let cx = 0; cx < w; cx++) {
      const x0 = Math.floor((cx * width) / w), x1 = Math.max(x0 + 1, Math.floor(((cx + 1) * width) / w));
      let s = 0, n = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { s += grey[y * width + x]; n++; }
      out[cy * w + cx] = s / n;
    }
  }
  return out;
}

/** 64-bit dHash of a 9×8 grey grid: bit 63 is row 0 / column 0. Returned as an unsigned bigint. */
const ZERO = BigInt(0), ONE = BigInt(1);
export function dhashOfGrid(grid: Float64Array): bigint {
  let h = ZERO;
  for (let r = 0; r < GRID_H; r++) for (let c = 0; c < GRID_W - 1; c++) h = (h << ONE) | (grid[r * GRID_W + c] > grid[r * GRID_W + c + 1] ? ONE : ZERO);
  return h;
}

/** Distinct colours (4 bits per channel) on a sampling grid of at most ~4,096 points. */
export function colourCount(img: Rgba): number {
  const step = Math.max(1, Math.floor(Math.sqrt((img.width * img.height) / 4096)));
  const seen = new Set<number>();
  for (let y = 0; y < img.height; y += step) for (let x = 0; x < img.width; x += step) {
    const i = (y * img.width + x) * 4;
    seen.add(((img.data[i] >> 4) << 8) | ((img.data[i + 1] >> 4) << 4) | (img.data[i + 2] >> 4));
  }
  return seen.size;
}

export function hamming(a: bigint, b: bigint): number {
  let x = BigInt.asUintN(64, a ^ b), n = 0;
  while (x !== ZERO) { x &= x - ONE; n++; }
  return n;
}

/** dHash + photograph test for one decoded image. */
export function hashPixels(img: Rgba): { dhash: bigint | null; photographic: boolean; reason?: string } {
  if (img.width < GRID_W || img.height < GRID_H) return { dhash: null, photographic: false, reason: "smaller than 9×8 pixels" };
  const dhash = dhashOfGrid(downscale(luma(img), img.width, img.height));
  const photographic = colourCount(img) >= PHOTO_MIN_COLOURS;
  return { dhash, photographic, reason: photographic ? undefined : "flat graphic (few colours)" };
}

/** Hash one uploaded image. Never throws: an image that cannot be decoded is stored by SHA-256 only. */
export function hashImage(type: string, bytes: Buffer, sha256: string): ImageHash {
  const size = imageSize(type, bytes);
  if (!size) return { sha256, dhash: null, photographic: false, width: 0, height: 0, reason: "image size unreadable" };
  // Above the decode limit the file is still compared by SHA-256 (an image that large is a camera photo, not a screen).
  if (size.width * size.height > MAX_DECODE_PIXELS) return { sha256, dhash: null, photographic: true, ...size, reason: "too large for the difference hash; compared by SHA-256 only" };
  try {
    const img = decode(type, bytes);
    return { sha256, ...hashPixels(img), width: img.width, height: img.height };
  } catch {
    return { sha256, dhash: null, photographic: false, ...size, reason: "could not be decoded" };
  }
}

/** bigint ⇄ the signed 64-bit value Postgres stores. */
export const toSigned = (u: bigint) => BigInt.asIntN(64, u);
export const toUnsigned = (s: bigint) => BigInt.asUintN(64, s);
export const dhashHex = (u: bigint) => BigInt.asUintN(64, u).toString(16).padStart(16, "0");

/* ── comparison (database) ── */

export interface PhotoMatch { name: string; sha256: string; distance: number; exact: boolean; sameContract: boolean; milestoneCode: string | null; packageId: string }

/**
 * The closest earlier photo, within the comparison scope, for one hashed image of a submission to `milestoneId`.
 * Exact SHA-256 matches rank first; otherwise the smallest Hamming distance ≤ DHASH_MAX_DISTANCE.
 */
export async function findPhotoMatch(q: Db | Tx, ctx: { workspaceId: string; orgId: string; milestoneId: string }, h: ImageHash): Promise<PhotoMatch | null> {
  if (!h.photographic) return null;
  const [sim] = await q.select({ simId: simWorkspaces.simId }).from(simWorkspaces).where(eq(simWorkspaces.workspaceId, ctx.workspaceId)).limit(1);
  const scope = sim
    ? sql`exists (select 1 from sim_workspaces sw where sw.workspace_id = ${evidencePhotoHashes.workspaceId} and ${sim.simId ? sql`sw.sim_id = ${sim.simId}` : sql`sw.workspace_id = ${ctx.workspaceId}`})`
    : isTestOrgId(ctx.orgId) ? eq(workspaces.orgId, ctx.orgId) : excludeSim(workspaces.id, workspaces.orgId);
  const distance = h.dhash === null ? sql<number>`64` : sql<number>`coalesce(bit_count((${evidencePhotoHashes.dhash} # ${toSigned(h.dhash).toString()}::bigint)::bit(64)), 64)`;
  const near = h.dhash === null ? sql`false` : sql`${distance} <= ${DHASH_MAX_DISTANCE}`;
  const rows = await q.select({
    name: evidencePhotoHashes.name, sha256: evidencePhotoHashes.sha256, packageId: evidencePhotoHashes.packageId, workspaceId: evidencePhotoHashes.workspaceId,
    distance, milestoneCode: sql<string | null>`(select m.code from ws_milestones m where m.id = ${evidencePhotoHashes.milestoneId})`,
  }).from(evidencePhotoHashes).innerJoin(workspaces, eq(workspaces.id, evidencePhotoHashes.workspaceId))
    .where(and(ne(evidencePhotoHashes.milestoneId, ctx.milestoneId), eq(evidencePhotoHashes.photographic, true), scope, sql`(${evidencePhotoHashes.sha256} = ${h.sha256} or ${near})`))
    .orderBy(sql`(${evidencePhotoHashes.sha256} = ${h.sha256}) desc`, distance)
    .limit(1);
  const r = rows[0];
  if (!r) return null;
  const exact = r.sha256 === h.sha256;
  const sameContract = r.workspaceId === ctx.workspaceId;
  return { name: r.name, sha256: r.sha256, packageId: r.packageId, distance: exact ? 0 : Number(r.distance), exact, sameContract, milestoneCode: sameContract ? r.milestoneCode : null };
}

/** The signal for one photo. Another contract is described only as "another contract" (no names, ids or amounts). */
export function duplicateSignal(fileName: string, m: PhotoMatch | null): Signal {
  if (!m) return { code: "DUPLICATE_PHOTO", level: "ok", detail: `${fileName}: not seen before in other contracts or milestones (difference hash and SHA-256).` };
  const where = m.sameContract ? `the photo already submitted for ${m.milestoneCode ?? "another milestone"} of this contract` : "a photo already submitted for another contract";
  const how = m.exact ? "identical file (same SHA-256)" : `${m.distance} of 64 difference-hash bits differ`;
  return { code: "DUPLICATE_PHOTO", level: "fail", detail: `${fileName}: matches ${where} (${how}). Take a new photo of this job and upload that instead.` };
}
