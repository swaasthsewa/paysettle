/**
 * Evidence: uploads, hashing, signals, submission, client review, approval (→ money.releaseMilestone),
 * remediation, review timers. Requirements: F3.03 (lazy DAG open of the milestone being submitted), F3.04 (upload, hash,
 * MIME, EXIF GPS signals), F3.06 (48 h review, reminders at 24/36 h, rule at 72 h), F3.07 (signed approval → release
 * trigger, exactly once via money's idempotency), F3.09 (soft rejection, 72 h fix window, third rejection → dispute), A3.
 * P3: the AI verifier only advises — its output is stored beside the package and never decides anything here.
 * P4: every release this module triggers carries an HMAC approval signature over (milestoneId + evidence root hash).
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db, type Db, type Tx } from "@/db/client";
import { evidencePackages, tranches, users, workspaces, wsMilestones, type ProofSpec } from "@/db/schema";
import { evidenceNotifications, evidencePhotoHashes, evidenceReviews, sequenceOverrides, workspaceSites, type ReviewDecision } from "@/db/schema-evidence";
import { audit } from "@/lib/audit";
import { canWrite } from "@/lib/rbac";
import { addHours, HOUR, sandboxMode } from "@/lib/clock";
import { milestoneMachine } from "@/lib/fsm";
import { newId, sha256 } from "@/lib/ids";
import { verifyTotp } from "@/lib/identity/totp";
import { offsetFor, workspaceNow } from "../clock";
import { DomainError, NotBuilt, type Actor } from "../types";
import { verifyEvidence } from "../ai";
import { releaseMilestone } from "../money";
import { openDispute } from "../disputes";
import { objectStore } from "./storage";
import { distanceM, parseJpegExif } from "./exif";
import { oracleHook } from "./oracles"; // F3.05 oracle hook
import { duplicateSignal, findPhotoMatch, hashImage, toSigned, type PhotoMatch } from "./photo-hash"; // A7
import {
  MAX_FILE_BYTES, MAX_FILES, MAX_NOTE, blocks, kindOfType, normalizeType, parseNote, sniffType, specSignals, type Signal,
} from "./spec";

export type { Signal } from "./spec";
export const REVIEW_HOURS = 48, REMINDER_HOURS = [24, 36] as const, TIMEOUT_HOURS = 72, FIX_WINDOW_HOURS = 72, MAX_ATTEMPTS = 3;
const SETTLED_STATES = ["RELEASED", "SETTLED_BY_VERDICT", "REFUNDED"];
const FUNDED_TRANCHE = ["HELD", "PARTIALLY_RELEASED"];

/** Refused submission: carries the signals so the upload form can show exactly what is missing. */
export class SpecFailed extends DomainError {
  constructor(readonly signals: Signal[]) {
    super("SPEC_FAILED", "The evidence does not meet the contract's proof spec yet: " + signals.filter((s) => s.level === "fail").map((s) => s.detail).join(" · "));
  }
}

type Ms = typeof wsMilestones.$inferSelect;
type Ws = typeof workspaces.$inferSelect;
type Pkg = typeof evidencePackages.$inferSelect;
const actorOf = (a: Actor) => ({ id: a.id, role: a.role, requestId: a.requestId });
const SYSTEM = { id: null, role: "system" };

/* ── signatures (P4) ── */
function signingKey(): string {
  const k = process.env.SIGNING_KEY;
  if (k) return k;
  if (!sandboxMode()) throw new Error("SIGNING_KEY is not set (P8)");
  // Sandbox only: a key derived from this deployment's database address, so local demos work without setup.
  return sha256("paysettle-sandbox-approval-key:" + (process.env.DATABASE_URL ?? "local"));
}
export const approvalSignature = (milestoneId: string, rootHash: string) => createHmac("sha256", signingKey()).update(milestoneId + rootHash).digest("hex");
/** HMAC with the same deployment key as approvals, for other signed evidence-module consents (F3.03 sequence override). */
export const evidenceHmac = (payload: string) => createHmac("sha256", signingKey()).update(payload).digest("hex");
export function verifyApprovalSignature(milestoneId: string, rootHash: string, sig: string): boolean {
  const want = Buffer.from(approvalSignature(milestoneId, rootHash), "hex"), got = Buffer.from(sig ?? "", "hex");
  return want.length === got.length && timingSafeEqual(want, got);
}

/** Root hash: SHA-256 over the package's file hashes, sorted, joined with no separator. No files → the note's hash stands in. */
export function rootHashOf(fileHashes: string[], note = ""): string {
  const list = [...new Set(fileHashes)].sort();
  return sha256(list.length ? list.join("") : sha256(note));
}

/* ── loading ── */
async function loadContext(milestoneId: string, q: Db | Tx = db): Promise<{ m: Ms; ws: Ws }> {
  const [row] = await q.select({ m: wsMilestones, ws: workspaces }).from(wsMilestones).innerJoin(workspaces, eq(workspaces.id, wsMilestones.workspaceId)).where(eq(wsMilestones.id, milestoneId)).limit(1);
  if (!row) throw new DomainError("NOT_FOUND", "That milestone does not exist.");
  return row;
}
export async function latestPackage(milestoneId: string, q: Db | Tx = db): Promise<Pkg | null> {
  const [p] = await q.select().from(evidencePackages).where(eq(evidencePackages.milestoneId, milestoneId)).orderBy(desc(evidencePackages.attempt)).limit(1);
  return p ?? null;
}
const effectiveOffset = async (wsId: string) => (sandboxMode() ? await offsetFor(wsId) : 0);

async function notify(q: Db | Tx, n: { dedupKey: string; workspaceId: string; milestoneId: string; toUserId?: string | null; toRole?: string; kind: string; title: string; body: string }): Promise<boolean> {
  const r = await q.insert(evidenceNotifications).values({ id: newId("nt"), dedupKey: n.dedupKey, workspaceId: n.workspaceId, milestoneId: n.milestoneId, toUserId: n.toUserId ?? null, toRole: n.toRole ?? null, kind: n.kind, title: n.title, body: n.body })
    .onConflictDoNothing({ target: evidenceNotifications.dedupKey }).returning({ id: evidenceNotifications.id });
  return r.length > 0;
}

/* ── F3.03: open a LOCKED milestone when its tranche is funded and its prerequisites are done ── */
/**
 * Same rule as the money module's unlocker (src/server/money/internal.ts openReady), applied lazily to one milestone at
 * submit time: DAG mode when any milestone in the workspace declares dependsOn (all listed prerequisites settled);
 * otherwise sequential — every active milestone with an earlier target day settled. Settled = RELEASED, SETTLED_BY_VERDICT, REFUNDED.
 */
type MsLite = { id: string; code: string; state: string; targetDay: number; dependsOn: string[] };
/**
 * Pure F3.03 prerequisite rule shared with the milestone page. `all` = the workspace's active milestones.
 * `overridden`: the client signed an out-of-sequence override for this milestone (src/server/evidence/override.ts).
 */
export function prerequisitesSettled(m: MsLite, all: MsLite[], overridden = false): boolean {
  if (overridden) return true;
  return unsettledPrerequisites(m, all).length === 0;
}
/** The prerequisite codes of `m` that are not settled yet (DAG mode: its dependsOn; sequential mode: earlier milestones). */
export function unsettledPrerequisites(m: MsLite, all: MsLite[]): string[] {
  const settled = (s: string) => SETTLED_STATES.includes(s);
  const byCode = new Map(all.map((x) => [x.code, x]));
  return all.some((x) => x.dependsOn.length > 0)
    ? m.dependsOn.filter((c) => { const d = byCode.get(c); return Boolean(d) && !settled(d!.state); })
    : all.filter((o) => o.id !== m.id && o.targetDay < m.targetDay && !settled(o.state)).map((o) => o.code);
}
/** True when the client's signed F3.03 override for this milestone is in force. */
export async function hasSequenceOverride(milestoneId: string, q: Db | Tx = db): Promise<boolean> {
  const [o] = await q.select({ id: sequenceOverrides.id }).from(sequenceOverrides).where(and(eq(sequenceOverrides.milestoneId, milestoneId), eq(sequenceOverrides.status, "GRANTED"))).limit(1);
  return Boolean(o);
}
export async function openIfReady(milestoneId: string, a: Actor | null = null): Promise<boolean> {
  const { m, ws } = await loadContext(milestoneId);
  if (m.state !== "LOCKED" || !m.active || ws.state !== "LOCKED") return false;
  const [t] = await db.select({ state: tranches.state }).from(tranches).where(and(eq(tranches.workspaceId, ws.id), eq(tranches.idx, m.trancheIdx))).limit(1);
  if (!t || !FUNDED_TRANCHE.includes(t.state)) return false;
  const all = await db.select({ id: wsMilestones.id, code: wsMilestones.code, state: wsMilestones.state, targetDay: wsMilestones.targetDay, dependsOn: wsMilestones.dependsOn }).from(wsMilestones).where(and(eq(wsMilestones.workspaceId, ws.id), eq(wsMilestones.active, true)));
  const overridden = !prerequisitesSettled(m, all) && (await hasSequenceOverride(m.id));
  if (!overridden && !prerequisitesSettled(m, all)) return false;
  return db.transaction(async (tx) => {
    const r = await tx.update(wsMilestones).set({ state: milestoneMachine.next("LOCKED", "open") }).where(and(eq(wsMilestones.id, m.id), eq(wsMilestones.state, "LOCKED"))).returning({ id: wsMilestones.id });
    if (!r.length) return false;
    await audit(tx, a ? actorOf(a) : SYSTEM, "evidence.milestone_open", m.id, { code: m.code, tranche: m.trancheIdx, ...(overridden ? { outOfSequence: unsettledPrerequisites(m, all) } : {}) });
    await notify(tx, { dedupKey: `open:${m.id}`, workspaceId: ws.id, milestoneId: m.id, toUserId: ws.providerId, kind: "MILESTONE_OPEN", title: `${m.code} is open for evidence`, body: `${m.title} can now be submitted.` });
    return true;
  });
}

/* ── F3.04 submit ── */
const BAD_NAME = /\.(html?|xhtml|svg|js|mjs|hta|xml)$/i;
function safeName(n: string): string {
  const base = (n || "file").split(/[\\/]/).pop() ?? "file";
  return base.replace(/[\u0000-\u001f\u007f"<>]/g, "").slice(0, 120) || "file";
}

export async function submitEvidence(a: Actor, milestoneId: string, files: { name: string; type: string; bytes: Buffer; exif?: Record<string, unknown> }[], note: string): Promise<{ packageId: string; rootHash: string; signals: { code: string; level: "ok" | "warn" | "fail"; detail: string }[] }> {
  if (!canWrite(a.role, "evidence.submit")) throw new DomainError("FORBIDDEN", "Only the provider of this contract can submit evidence.");
  let { m, ws } = await loadContext(milestoneId);
  if (a.role !== "judge" && a.id !== ws.providerId) throw new DomainError("FORBIDDEN", "Only the provider of this contract can submit evidence.");
  if (ws.state !== "LOCKED") throw new DomainError("NOT_LOCKED", "Evidence can be submitted once both parties have signed and the contract is locked.");
  if (!m.active) throw new DomainError("BAD_STATE", "This milestone was removed from the contract.");
  if (m.state === "LOCKED" && (await openIfReady(milestoneId, a))) ({ m, ws } = await loadContext(milestoneId));
  if (!milestoneMachine.allows(m.state as never, "submit")) throw new DomainError("BAD_STATE", `${m.code} is ${m.state.toLowerCase()}; evidence can be submitted while it is open or a fix was requested.`);
  const attempt = m.attempts + 1;
  if (attempt > MAX_ATTEMPTS) throw new DomainError("TOO_MANY_ATTEMPTS", `${m.code} already had ${MAX_ATTEMPTS} submissions.`);
  const noteStr = note ?? "";
  if (noteStr.length > MAX_NOTE) throw new DomainError("NOTE_TOO_LONG", `The note is limited to ${MAX_NOTE} characters.`);
  if (files.length > MAX_FILES) throw new DomainError("TOO_MANY_FILES", `Up to ${MAX_FILES} files per submission.`);

  const signals: Signal[] = [];
  const seen = new Set<string>();
  const prepared: { name: string; type: string; bytes: Buffer; sha: string; exif?: Record<string, unknown> }[] = [];
  for (const f of files) {
    const bytes = Buffer.isBuffer(f.bytes) ? f.bytes : Buffer.from(f.bytes);
    const name = safeName(f.name);
    if (!bytes.length) throw new DomainError("EMPTY_FILE", `${name} is empty.`);
    if (bytes.length > MAX_FILE_BYTES) throw new DomainError("FILE_TOO_LARGE", `${name} is larger than 15 MB.`);
    if (BAD_NAME.test(name)) throw new DomainError("TYPE_NOT_ALLOWED", `${name}: web pages, scripts and SVG files are not accepted.`);
    const declared = normalizeType(f.type);
    const sniffed = sniffType(bytes);
    if (!sniffed) throw new DomainError("TYPE_NOT_ALLOWED", `${name}: only JPEG, PNG, PDF, plain text and MP4 files are accepted.`);
    /* plain text named .txt/.log keeps whatever label the browser gave it (Windows sends .log as application/dflog or
       text/x-log); a label claiming markup or script is still refused, and binary types keep the strict check */
    const textByName = sniffed === "text/plain" && /\.(txt|log)$/i.test(name) && !/html|xml|javascript|svg/.test(declared);
    const lenient = declared === "" || declared === "application/octet-stream" || textByName || (sniffed === "text/plain" && declared.startsWith("text/") && !/html|xml|javascript/.test(declared));
    if (!lenient && declared !== sniffed) throw new DomainError("TYPE_MISMATCH", `${name} says it is ${declared} but its contents are ${sniffed}.`);
    const sha = sha256(bytes);
    if (seen.has(sha)) { signals.push({ code: "DUPLICATE_FILE", level: "warn", detail: `${name} is identical to another file in this package; counted once.` }); continue; }
    seen.add(sha);
    prepared.push({ name, type: sniffed, bytes, sha, exif: exifFor(sniffed, bytes, f.exif) });
  }

  const now = await workspaceNow(ws.id);
  const parsed = parseNote(noteStr);
  signals.unshift(...specSignals(m.proof, prepared, noteStr));
  signals.push(...(await exifSignals(ws.id, m.proof, prepared, parsed.gpsWaiver, now)));
  const rootHash = rootHashOf(prepared.map((p) => p.sha), noteStr);
  signals.push({ code: "HASH", level: "ok", detail: `Root ${rootHash.slice(0, 12)}… over ${prepared.length} file${prepared.length === 1 ? "" : "s"} (SHA-256).` });
  // A7: duplicate-photo check against other contracts and other milestones (difference hash + SHA-256).
  const photoHashes = prepared.filter((p) => p.type === "image/jpeg" || p.type === "image/png").map((p) => ({ name: p.name, h: hashImage(p.type, p.bytes, p.sha) }));
  const dupes: { file: string; match: PhotoMatch }[] = [];
  for (const ph of photoHashes) {
    if (!ph.h.photographic) continue;
    const match = await findPhotoMatch(db, { workspaceId: ws.id, orgId: ws.orgId, milestoneId: m.id }, ph.h);
    signals.push(duplicateSignal(ph.name, match));
    if (match) dupes.push({ file: ph.name, match });
  }
  if (dupes.length) await audit(db, actorOf(a), "evidence.duplicate_photo", m.id, { attempt, files: dupes.map((d) => ({ file: d.file, matchPackage: d.match.packageId, distance: d.match.distance, exact: d.match.exact, sameContract: d.match.sameContract })) });
  if (blocks(signals)) throw new SpecFailed(signals);
  await oracleHook(signals, { milestoneId: m.id, attempt, rootHash, proof: m.proof, note: noteStr }); // F3.05 oracle hook

  const store = objectStore();
  for (const p of prepared) await store.putObject(p.sha, p.bytes);
  const verifier = await runVerifier(m.proof, prepared, signals);

  const packageId = newId("ev");
  await db.transaction(async (tx) => {
    const r = await tx.update(wsMilestones).set({ state: "SUBMITTED", attempts: attempt, reviewDueAt: addHours(now, REVIEW_HOURS) })
      .where(and(eq(wsMilestones.id, m.id), inArray(wsMilestones.state, ["OPEN", "REMEDIATION"]), eq(wsMilestones.attempts, m.attempts))).returning({ id: wsMilestones.id });
    if (!r.length) throw new DomainError("CONFLICT", "This milestone changed while you were uploading. Reload and try again.");
    await tx.insert(evidencePackages).values({
      id: packageId, milestoneId: m.id, attempt, rootHash, note: noteStr, submittedBy: a.id, state: "SUBMITTED", signals, verifier,
      files: prepared.map((p) => ({ name: p.name, kind: p.type, size: p.bytes.length, sha256: p.sha, url: `/api/evidence/file/${p.sha}`, ...(p.exif ? { exif: p.exif } : {}) })),
    });
    if (photoHashes.length) await tx.insert(evidencePhotoHashes).values(photoHashes.map((ph) => ({ packageId, milestoneId: m.id, workspaceId: ws.id, sha256: ph.h.sha256, name: ph.name, dhash: ph.h.dhash === null ? null : toSigned(ph.h.dhash), photographic: ph.h.photographic, width: ph.h.width, height: ph.h.height }))).onConflictDoNothing();
    await notify(tx, { dedupKey: `submit:${m.id}:${attempt}`, workspaceId: ws.id, milestoneId: m.id, toUserId: ws.clientId, kind: "EVIDENCE_SUBMITTED", title: `${m.code} evidence is ready for review`, body: `Attempt ${attempt}. Review within ${REVIEW_HOURS} hours.` });
    await audit(tx, actorOf(a), "evidence.submit", m.id, { packageId, attempt, rootHash, files: prepared.length, warn: signals.filter((s) => s.level === "warn").length, ai: Boolean(verifier.available), reviewDueAt: addHours(now, REVIEW_HOURS).toISOString() });
  });
  return { packageId, rootHash, signals };
}

function exifFor(type: string, bytes: Buffer, supplied?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (type !== "image/jpeg" && !supplied) return undefined;
  const x = type === "image/jpeg" ? parseJpegExif(bytes) : { hasExif: false };
  const out: Record<string, unknown> = {};
  if (x.lat !== undefined && x.lng !== undefined) { out.lat = x.lat; out.lng = x.lng; out.source = "file"; }
  if (x.takenAt) out.takenAt = x.takenAt;
  if (out.lat === undefined && supplied && typeof supplied.lat === "number" && typeof supplied.lng === "number" && Math.abs(supplied.lat) <= 90 && Math.abs(supplied.lng) <= 180) {
    out.lat = supplied.lat; out.lng = supplied.lng; out.source = "supplied";
  }
  if (!out.takenAt && supplied && typeof supplied.takenAt === "string") out.takenAt = supplied.takenAt.slice(0, 25);
  return Object.keys(out).length ? out : undefined;
}

const HINT = "EXIF signals are a hint, not proof.";
async function exifSignals(wsId: string, proof: ProofSpec, files: { name: string; type: string; exif?: Record<string, unknown> }[], waiver: boolean, now: Date): Promise<Signal[]> {
  const out: Signal[] = [];
  const images = files.filter((f) => kindOfType(f.type) === "IMAGE");
  for (const f of images) {
    const x = f.exif;
    if (!x) { out.push({ code: "EXIF_MISSING", level: "warn", detail: `${f.name}: no EXIF data. ${HINT}` }); continue; }
    if (typeof x.takenAt === "string") {
      const t = Date.parse(x.takenAt.length === 19 ? x.takenAt + "Z" : x.takenAt);
      const ageDays = (now.getTime() - t) / (24 * HOUR);
      const odd = !Number.isFinite(t) || ageDays > 45 || ageDays < -1;
      out.push({ code: "EXIF_TIME", level: odd ? "warn" : "ok", detail: `${f.name}: taken ${x.takenAt.replace("T", " ")}${odd ? " — outside the expected window" : ""}. ${HINT}` });
    }
  }
  if (!proof.gpsRadiusM) return out;
  const [site] = await db.select().from(workspaceSites).where(eq(workspaceSites.workspaceId, wsId)).limit(1);
  if (!site) { out.push({ code: "GPS_SITE_UNSET", level: "warn", detail: "The contract asks for photos within " + proof.gpsRadiusM + " m of the site, but no site location is on file." }); return out; }
  if (!images.length) out.push({ code: "GPS_MISSING", level: "warn", detail: `No photo to check against ${site.label}. ${HINT}` });
  for (const f of images) {
    const x = f.exif;
    if (typeof x?.lat !== "number" || typeof x?.lng !== "number") { out.push({ code: "GPS_MISSING", level: "warn", detail: `${f.name}: no GPS position${waiver ? " (provider waiver noted)" : ""}. ${HINT}` }); continue; }
    const d = Math.round(distanceM({ lat: x.lat, lng: x.lng }, site));
    const far = d > proof.gpsRadiusM;
    const dist = d >= 1000 ? `${(d / 1000).toFixed(1)} km` : `${d} m`;
    out.push({
      code: "GPS_DISTANCE", level: far ? (waiver ? "warn" : "fail") : "ok",
      detail: `${f.name}: ${dist} from ${site.label} (limit ${proof.gpsRadiusM} m)${x.source === "supplied" ? ", position from in-app capture" : ""}${far && waiver ? " — provider waiver noted for the client" : far ? " — retake on site or tick the GPS waiver and explain in the note" : ""}. ${HINT}`,
    });
  }
  return out;
}

async function runVerifier(proof: ProofSpec, files: { name: string; type: string; bytes: Buffer }[], signals: Signal[]): Promise<Record<string, unknown>> {
  const at = new Date().toISOString();
  const input = files.map((f) => ({
    name: f.name, type: f.type,
    text: f.type === "text/plain" ? f.bytes.toString("utf8").slice(0, 20_000) : undefined,
    imageBase64: kindOfType(f.type) === "IMAGE" && f.bytes.length <= 4 * 1024 * 1024 ? f.bytes.toString("base64") : undefined,
    signals: signals.filter((s) => s.detail.startsWith(f.name + ":")),
  }));
  try {
    let timer: NodeJS.Timeout | undefined;
    const r = await Promise.race([
      verifyEvidence(proof, input),
      new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error("timeout")), 45_000); }),
    ]).finally(() => clearTimeout(timer));
    return { ...(r as unknown as Record<string, unknown>), at };
  } catch (e) {
    return { available: false, reason: e instanceof NotBuilt ? "The AI verifier is not switched on in this build." : "The AI verifier did not answer in time.", at };
  }
}

/* ── MFA for approvals (sandbox: optional) ── */
export async function checkMfa(a: Actor, code?: string): Promise<"verified" | "sandbox-skip"> {
  const [u] = await db.select({ secret: users.mfaSecret, last: users.mfaLastStep }).from(users).where(eq(users.id, a.id)).limit(1);
  if (!code?.trim()) {
    if (sandboxMode()) return "sandbox-skip";
    throw new DomainError("MFA_REQUIRED", "Enter the 6-digit code from your authenticator app to approve.");
  }
  if (!u?.secret) {
    if (sandboxMode()) return "sandbox-skip";
    throw new DomainError("MFA_NOT_SET", "Set up two-step sign-in under Account before approving releases.");
  }
  const r = verifyTotp(u.secret, code.trim(), Date.now(), u.last);
  if (!r.ok) throw new DomainError("MFA_WRONG", r.reason === "used" ? "That code was already used. Wait for the next one." : "That code is not right. Try the current one.");
  await db.update(users).set({ mfaLastStep: r.step }).where(eq(users.id, a.id));
  return "verified";
}

/**
 * After a signed approval: ask money to release. GATE milestones go through too (zero amount): money records the signed
 * release, marks the gate RELEASED and opens the next milestones. NotBuilt → stays APPROVED, release queued.
 */
async function triggerRelease(a: Actor, m: Ms, sig: string): Promise<{ queued: boolean }> {
  try {
    await releaseMilestone(a, m.id, { kind: "MILESTONE", approvalSig: sig });
    return { queued: false };
  } catch (e) {
    await audit(db, actorOf(a), "evidence.release_queued", m.id, { reason: e instanceof NotBuilt ? "money module not built" : String((e as Error).message).slice(0, 200) });
    if (e instanceof NotBuilt) return { queued: true };
    throw new DomainError("RELEASE_QUEUED", "Approved and signed. The PayPal release has not gone through yet; it stays queued and will be retried.");
  }
}

/* ── F3.07 approve ── */
export async function approveMilestone(a: Actor, milestoneId: string, rootHash: string, mfaCode?: string): Promise<void> {
  if (!canWrite(a.role, "release.approve")) throw new DomainError("FORBIDDEN", "Only the client of this contract can approve a release.");
  const { m, ws } = await loadContext(milestoneId);
  if (a.role !== "judge" && a.id !== ws.clientId) throw new DomainError("FORBIDDEN", "Only the client of this contract can approve a release.");
  const pkg = await latestPackage(milestoneId);
  if (!pkg) throw new DomainError("NO_EVIDENCE", "There is no evidence to approve yet.");
  if (!rootHash || rootHash !== pkg.rootHash) throw new DomainError("ROOT_MISMATCH", "The evidence changed since you opened it. Reload, inspect the latest package, then approve.");

  if (m.state === "APPROVED") { // signed earlier, release still queued: retry with the stored signature
    const [rev] = await db.select().from(evidenceReviews).where(and(eq(evidenceReviews.packageId, pkg.id), inArray(evidenceReviews.decision, ["APPROVE", "DEEMED_APPROVED"]))).orderBy(desc(evidenceReviews.createdAt)).limit(1);
    if (rev?.signature) { await triggerRelease(a, m, rev.signature); return; }
  }
  if (!milestoneMachine.allows(m.state as never, "approve")) throw new DomainError("BAD_STATE", `${m.code} is ${m.state.toLowerCase()} and cannot be approved now.`);
  const mfa = await checkMfa(a, mfaCode);
  const sig = approvalSignature(m.id, pkg.rootHash);
  await db.transaction(async (tx) => {
    const r = await tx.update(wsMilestones).set({ state: "APPROVED", reviewDueAt: null }).where(and(eq(wsMilestones.id, m.id), inArray(wsMilestones.state, ["SUBMITTED", "ESCALATED"]))).returning({ id: wsMilestones.id });
    if (!r.length) throw new DomainError("CONFLICT", "This milestone changed a moment ago. Reload to see its state.");
    await tx.update(evidencePackages).set({ state: "APPROVED" }).where(eq(evidencePackages.id, pkg.id));
    await tx.insert(evidenceReviews).values({ id: newId("rv"), packageId: pkg.id, milestoneId: m.id, decision: "APPROVE", rootHash: pkg.rootHash, signature: sig, byUser: a.id, mfa });
    await notify(tx, { dedupKey: `approve:${m.id}:${pkg.attempt}`, workspaceId: ws.id, milestoneId: m.id, toUserId: ws.providerId, kind: "APPROVED", title: `${m.code} approved`, body: m.type === "PAY" ? "The client approved the evidence; the release to your PayPal account is under way." : "The client approved this gate." });
    await audit(tx, actorOf(a), "evidence.approve", m.id, { packageId: pkg.id, attempt: pkg.attempt, rootHash: pkg.rootHash, sig: sig.slice(0, 16), mfa });
  });
  await triggerRelease(a, m, sig);
}

/* ── F3.09 request a fix / third rejection ── */
export async function requestFix(a: Actor, milestoneId: string, items: string[]): Promise<void> {
  if (!canWrite(a.role, "release.approve")) throw new DomainError("FORBIDDEN", "Only the client of this contract can request a fix.");
  const { m, ws } = await loadContext(milestoneId);
  if (a.role !== "judge" && a.id !== ws.clientId) throw new DomainError("FORBIDDEN", "Only the client of this contract can request a fix.");
  const list = (items ?? []).map((s) => String(s).trim().slice(0, 500)).filter(Boolean).slice(0, 20);
  if (!list.length) throw new DomainError("ITEMS_REQUIRED", "List at least one thing the provider should fix.");
  if (m.state !== "SUBMITTED") throw new DomainError("BAD_STATE", `${m.code} is ${m.state.toLowerCase()}; a fix can be requested while the evidence is in review.`);
  const pkg = await latestPackage(milestoneId);
  if (!pkg) throw new DomainError("NO_EVIDENCE", "There is no evidence to review yet.");
  const now = await workspaceNow(ws.id);

  if (m.attempts < MAX_ATTEMPTS) {
    const due = addHours(now, FIX_WINDOW_HOURS);
    await db.transaction(async (tx) => {
      const r = await tx.update(wsMilestones).set({ state: milestoneMachine.next("SUBMITTED", "request_fix"), reviewDueAt: due }).where(and(eq(wsMilestones.id, m.id), eq(wsMilestones.state, "SUBMITTED"))).returning({ id: wsMilestones.id });
      if (!r.length) throw new DomainError("CONFLICT", "This milestone changed a moment ago. Reload to see its state.");
      await tx.update(evidencePackages).set({ state: "FIX_REQUESTED" }).where(eq(evidencePackages.id, pkg.id));
      await tx.insert(evidenceReviews).values({ id: newId("rv"), packageId: pkg.id, milestoneId: m.id, decision: "REQUEST_FIX", items: list, rootHash: pkg.rootHash, byUser: a.id });
      await notify(tx, { dedupKey: `fix:${m.id}:${pkg.attempt}`, workspaceId: ws.id, milestoneId: m.id, toUserId: ws.providerId, kind: "FIX_REQUESTED", title: `${m.code}: fix requested`, body: `${list.length} item${list.length === 1 ? "" : "s"} to fix within ${FIX_WINDOW_HOURS} hours (attempt ${pkg.attempt} of ${MAX_ATTEMPTS}).` });
      await audit(tx, actorOf(a), "evidence.request_fix", m.id, { packageId: pkg.id, attempt: pkg.attempt, items: list, fixDueAt: due.toISOString() });
    });
    return;
  }

  // Third rejection → formal dispute (PRD §6.8).
  await db.transaction(async (tx) => {
    await tx.update(evidencePackages).set({ state: "REJECTED" }).where(eq(evidencePackages.id, pkg.id));
    await tx.insert(evidenceReviews).values({ id: newId("rv"), packageId: pkg.id, milestoneId: m.id, decision: "THIRD_REJECTION", items: list, rootHash: pkg.rootHash, byUser: a.id });
    await audit(tx, actorOf(a), "evidence.third_rejection", m.id, { packageId: pkg.id, attempt: pkg.attempt, items: list });
  });
  let disputeId: string | null = null;
  try {
    disputeId = await openDispute(a, m.id, "THIRD_REJECTION", `Third rejection of ${m.code} evidence. Outstanding items: ${list.join("; ")}`);
  } catch (e) {
    if (!(e instanceof NotBuilt)) throw e;
  }
  await db.transaction(async (tx) => {
    const r = await tx.update(wsMilestones).set({ state: "DISPUTED", reviewDueAt: null }).where(and(eq(wsMilestones.id, m.id), inArray(wsMilestones.state, ["SUBMITTED", "REMEDIATION", "ESCALATED"]))).returning({ id: wsMilestones.id });
    await audit(tx, actorOf(a), disputeId ? "evidence.dispute_opened" : "evidence.dispute_queued", m.id, { disputeId, stateSet: r.length > 0 });
    await notify(tx, { dedupKey: `dispute:${m.id}`, workspaceId: ws.id, milestoneId: m.id, toUserId: ws.providerId, kind: "DISPUTED", title: `${m.code} moved to a dispute`, body: "The third rejection opened a formal dispute. The amount stays held in PayPal until it is resolved." });
  });
}

/* ── F3.06 review timers ── */
/**
 * `now` is real (unshifted) time; each workspace's virtual clock offset (playground time travel) is added per workspace.
 * Callers pass `new Date()` — not workspaceNow() — or the offset would be applied twice. Every action fires once.
 */
export async function runReviewTimers(now: Date, workspaceId?: string): Promise<{ actions: { milestoneId: string; action: string }[] }> {
  const actions: { milestoneId: string; action: string }[] = [];
  const rows = await db.select({ m: wsMilestones, ws: workspaces }).from(wsMilestones).innerJoin(workspaces, eq(workspaces.id, wsMilestones.workspaceId))
    .where(and(inArray(wsMilestones.state, ["SUBMITTED", "REMEDIATION"]), isNotNull(wsMilestones.reviewDueAt), workspaceId ? eq(wsMilestones.workspaceId, workspaceId) : undefined));
  const offsets = new Map<string, number>();
  for (const { m, ws } of rows) {
    try {
      if (!offsets.has(ws.id)) offsets.set(ws.id, await effectiveOffset(ws.id));
      const eff = now.getTime() + (offsets.get(ws.id) ?? 0) * HOUR;
      const due = m.reviewDueAt!.getTime();
      if (m.state === "SUBMITTED") {
        const start = due - REVIEW_HOURS * HOUR;
        for (const h of REMINDER_HOURS) {
          if (eff < start + h * HOUR) continue;
          const left = REVIEW_HOURS - h;
          const fired = await notify(db, { dedupKey: `remind:${m.id}:${m.attempts}:${h}`, workspaceId: ws.id, milestoneId: m.id, toUserId: ws.clientId, kind: "REVIEW_REMINDER", title: `${m.code}: ${left} hours left to review`, body: `Evidence was submitted ${h} hours ago. Approve, request a fix, or open a dispute. After ${TIMEOUT_HOURS} hours the contract's rule applies (${ws.reviewTimeoutRule === "DEEMED_APPROVED" ? "deemed approval" : "escalation to Operations"}).` });
          if (fired) { await audit(db, SYSTEM, "evidence.review_reminder", m.id, { hours: h, attempt: m.attempts }); actions.push({ milestoneId: m.id, action: `REMIND_${h}H` }); }
        }
        if (eff >= start + TIMEOUT_HOURS * HOUR) {
          const act = ws.reviewTimeoutRule === "DEEMED_APPROVED" ? await deemApprove(m, ws) : await escalate(m, ws);
          actions.push(...act.map((x) => ({ milestoneId: m.id, action: x })));
        }
      } else if (eff >= due) {
        const fired = await notify(db, { dedupKey: `fixwin:${m.id}:${m.attempts}`, workspaceId: ws.id, milestoneId: m.id, toUserId: ws.providerId, kind: "FIX_WINDOW_PASSED", title: `${m.code}: the ${FIX_WINDOW_HOURS}-hour fix window has passed`, body: "Resubmit the fixed evidence as soon as you can; the client may open a dispute." });
        if (fired) {
          await notify(db, { dedupKey: `fixwin:${m.id}:${m.attempts}:client`, workspaceId: ws.id, milestoneId: m.id, toUserId: ws.clientId, kind: "FIX_WINDOW_PASSED", title: `${m.code}: the fix window has passed`, body: "The provider has not resubmitted. You can open a dispute from the milestone page." });
          await audit(db, SYSTEM, "evidence.fix_window_passed", m.id, { attempt: m.attempts });
          actions.push({ milestoneId: m.id, action: "FIX_WINDOW_PASSED" });
        }
      }
    } catch (e) {
      actions.push({ milestoneId: m.id, action: `ERROR: ${String((e as Error).message).slice(0, 120)}` });
    }
  }
  return { actions };
}

async function escalate(m: Ms, ws: Ws): Promise<string[]> {
  const pkg = await latestPackage(m.id);
  const done = await db.transaction(async (tx) => {
    const r = await tx.update(wsMilestones).set({ state: milestoneMachine.next("SUBMITTED", "timeout_escalate") }).where(and(eq(wsMilestones.id, m.id), eq(wsMilestones.state, "SUBMITTED"))).returning({ id: wsMilestones.id });
    if (!r.length) return false;
    if (pkg) await tx.insert(evidenceReviews).values({ id: newId("rv"), packageId: pkg.id, milestoneId: m.id, decision: "ESCALATED" as ReviewDecision, rootHash: pkg.rootHash, mfa: "system" });
    await notify(tx, { dedupKey: `esc:${m.id}:${m.attempts}:ops`, workspaceId: ws.id, milestoneId: m.id, toRole: "ops", kind: "REVIEW_ESCALATED", title: `${ws.title} · ${m.code}: client review timed out`, body: `No decision after ${TIMEOUT_HOURS} hours. The contract says escalate to Operations.` });
    await notify(tx, { dedupKey: `esc:${m.id}:${m.attempts}:client`, workspaceId: ws.id, milestoneId: m.id, toUserId: ws.clientId, kind: "REVIEW_ESCALATED", title: `${m.code} was escalated to Operations`, body: "You can still approve or open a dispute." });
    await audit(tx, SYSTEM, "evidence.review_escalated", m.id, { attempt: m.attempts, rule: "ESCALATE" });
    return true;
  });
  return done ? ["ESCALATED"] : [];
}

async function deemApprove(m: Ms, ws: Ws): Promise<string[]> {
  const pkg = await latestPackage(m.id);
  if (!pkg) return [];
  const sig = approvalSignature(m.id, pkg.rootHash);
  const done = await db.transaction(async (tx) => {
    const r = await tx.update(wsMilestones).set({ state: milestoneMachine.next("SUBMITTED", "timeout_deemed"), reviewDueAt: null }).where(and(eq(wsMilestones.id, m.id), eq(wsMilestones.state, "SUBMITTED"))).returning({ id: wsMilestones.id });
    if (!r.length) return false;
    await tx.update(evidencePackages).set({ state: "APPROVED" }).where(eq(evidencePackages.id, pkg.id));
    await tx.insert(evidenceReviews).values({ id: newId("rv"), packageId: pkg.id, milestoneId: m.id, decision: "DEEMED_APPROVED", rootHash: pkg.rootHash, signature: sig, mfa: "system" });
    await notify(tx, { dedupKey: `deemed:${m.id}:${m.attempts}`, workspaceId: ws.id, milestoneId: m.id, toUserId: ws.clientId, kind: "DEEMED_APPROVED", title: `${m.code} was deemed approved`, body: `No decision after ${TIMEOUT_HOURS} hours; the contract's deemed-approval rule applied.` });
    await audit(tx, SYSTEM, "evidence.deemed_approved", m.id, { packageId: pkg.id, rootHash: pkg.rootHash, sig: sig.slice(0, 16), rule: "DEEMED_APPROVED" });
    return true;
  });
  if (!done) return [];
  // The client signed the deemed-approval rule into the contract; the release runs under that signed rule.
  const actor: Actor = { id: ws.clientId, role: "client", name: "Deemed approval (contract rule)", requestId: `deemed:${m.id}:${m.attempts}` };
  try { const r = await triggerRelease(actor, m, sig); return r.queued ? ["DEEMED_APPROVED", "RELEASE_QUEUED"] : ["DEEMED_APPROVED"]; }
  catch { return ["DEEMED_APPROVED", "RELEASE_QUEUED"]; }
}

/* ── reads used by the page and the file route ── */
export async function setWorkspaceSite(a: Actor, workspaceId: string, site: { lat: number; lng: number; label?: string }): Promise<void> {
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
  if (!ws) throw new DomainError("NOT_FOUND", "That contract does not exist.");
  if (a.id !== ws.clientId && a.role !== "ops" && a.role !== "judge") throw new DomainError("FORBIDDEN", "Only the client or Operations can set the site location.");
  if (!(Math.abs(site.lat) <= 90 && Math.abs(site.lng) <= 180)) throw new DomainError("BAD_INPUT", "That is not a valid position.");
  await db.insert(workspaceSites).values({ workspaceId, lat: site.lat, lng: site.lng, label: site.label?.slice(0, 80) || "Site" })
    .onConflictDoUpdate({ target: workspaceSites.workspaceId, set: { lat: site.lat, lng: site.lng, label: site.label?.slice(0, 80) || "Site" } });
  await audit(db, actorOf(a), "evidence.site_set", workspaceId, { lat: site.lat, lng: site.lng });
}

export const STAFF_ROLES = ["ops", "admin", "mediator", "finance"] as const;
/** P11 file access: parties of the workspace that holds the file, staff roles, and the judge in sandbox. */
export async function fileAccess(v: { id: string; role: string }, sha: string): Promise<{ name: string; type: string; size: number } | null> {
  const rows = await db.select({ files: evidencePackages.files, clientId: workspaces.clientId, providerId: workspaces.providerId })
    .from(evidencePackages).innerJoin(wsMilestones, eq(wsMilestones.id, evidencePackages.milestoneId)).innerJoin(workspaces, eq(workspaces.id, wsMilestones.workspaceId))
    .where(arrayHasSha(sha));
  const staff = (STAFF_ROLES as readonly string[]).includes(v.role) || (v.role === "judge" && sandboxMode());
  for (const r of rows) {
    if (!staff && v.id !== r.clientId && v.id !== r.providerId) continue;
    const f = r.files.find((x) => x.sha256 === sha);
    if (f) return { name: f.name, type: f.kind, size: f.size };
  }
  return null;
}
const arrayHasSha = (sha: string) => sql`${evidencePackages.files} @> ${JSON.stringify([{ sha256: sha }])}::jsonb`;
