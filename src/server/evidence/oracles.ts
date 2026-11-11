/**
 * F3.05 External oracle validator. When a milestone's proof spec names an oracle, submitEvidence calls oracleHook (one line,
 * marked "F3.05 oracle hook") after the spec checks: the oracle runs against the submission note, adds a signal
 * { code: "ORACLE_<ID>", level, detail } and writes a signed, append-only attestation (oracle_attestations).
 *  - GITHUB_CI: latest GitHub Actions run for the repo/branch named by a github.com URL in the note (public REST API,
 *    optional GITHUB_TOKEN). success → ok; failure/cancelled/timed out → fail; still running or no runs → warn.
 *  - CARRIER_TRACKING: "Tracking: <number>" in the note. Simulated carrier check (sandbox only): numbers ending in 0 are
 *    DELIVERED, others IN_TRANSIT. A real carrier adapter is out of scope; production goes straight to manual mode.
 *  - PNR_LOOKUP: "PNR: <6 characters>" in the note. Simulated (sandbox only): CONFIRMED_TICKETED unless it starts with W
 *    (WAITLISTED). Production goes straight to manual mode.
 * Network failure → 3 retries with exponential backoff, then "hybrid manual mode": level warn and Operations can
 * counter-verify (manualVerify, POST /api/oracles/[id]/manual, permission oracle.manual_verify). Oracle signals inform the
 * client's review; they never block a submission, approve or release anything (P3/P4 untouched).
 * P8: attestations are HMAC-signed with SIGNING_KEY (sandbox falls back to a key derived from the database address).
 * P11: the note is untrusted — only the parsed owner/repo/branch, tracking number or PNR is used, never the raw text.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { db, type Db } from "@/db/client";
import { evidencePackages, type ProofSpec } from "@/db/schema";
import { oracleAttestations } from "@/db/schema-identity";
import { audit } from "@/lib/audit";
import { canonical } from "@/lib/canonical";
import { sandboxMode } from "@/lib/clock";
import { canWrite } from "@/lib/rbac";
import { newId, sha256 } from "@/lib/ids";
import { DomainError, type Actor } from "../types";
import type { Signal } from "./spec";

export const ORACLE_IDS = ["GITHUB_CI", "CARRIER_TRACKING", "PNR_LOOKUP"] as const;
export type OracleId = (typeof ORACLE_IDS)[number];
export const isOracle = (s: string | undefined): s is OracleId => !!s && (ORACLE_IDS as readonly string[]).includes(s);
export const ORACLE_LABEL: Record<OracleId, string> = { GITHUB_CI: "GitHub CI status", CARRIER_TRACKING: "Simulated carrier check", PNR_LOOKUP: "Simulated PNR check" };
export const ORACLE_HOWTO: Record<OracleId, string> = {
  GITHUB_CI: "Put the repository URL in the note, e.g. https://github.com/owner/repo/tree/main.",
  CARRIER_TRACKING: "Put the tracking number in the note, e.g. Tracking: 1Z999AA10123456780.",
  PNR_LOOKUP: "Put the booking reference in the note, e.g. PNR: K7Q2LM.",
};
export const RETRIES = 3;
type Level = "ok" | "warn" | "fail";
type Mode = "LIVE" | "SIMULATED" | "MANUAL_PENDING" | "MANUAL";
export interface OracleOutcome { oracle: OracleId; input: Record<string, unknown>; status: string; level: Level; detail: string; mode: Mode; tries: number; source: string }
type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;
export interface OracleDeps { fetch: FetchFn; sleep: (ms: number) => Promise<void>; sandbox: () => boolean; githubToken: () => string | undefined; baseDelayMs: number }
const defaults: OracleDeps = {
  fetch: (u, i) => fetch(u, { ...i, signal: AbortSignal.timeout(6_000) }),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  sandbox: sandboxMode, githubToken: () => process.env.GITHUB_TOKEN || undefined, baseDelayMs: 300,
};
let deps: OracleDeps = defaults;
/** Tests swap the network and the clock; pass nothing to restore the defaults. */
export function setOracleDeps(d?: Partial<OracleDeps>) { deps = d ? { ...defaults, ...d } : defaults; }

/* ── input parsing (P11: extract only the identifiers) ── */
export function parseGithub(note: string): { owner: string; repo: string; branch?: string } | null {
  for (const m of note.matchAll(/https?:\/\/(?:www\.)?github\.com\/[^\s<>"')\]]+/gi)) {
    let u: URL;
    try { u = new URL(m[0]); } catch { continue; }
    const [owner, rawRepo, kind, ...rest] = u.pathname.split("/").filter(Boolean);
    const repo = rawRepo?.replace(/\.git$/, "");
    if (!owner || !repo || !/^[A-Za-z0-9-]{1,39}$/.test(owner) || !/^[A-Za-z0-9._-]{1,100}$/.test(repo)) continue;
    const branch = kind === "tree" && rest.length ? decodeURIComponent(rest.join("/")) : u.searchParams.get("branch") ?? undefined;
    return { owner, repo, ...(branch && /^[A-Za-z0-9._\/-]{1,200}$/.test(branch) ? { branch } : {}) };
  }
  return null;
}
export const parseTracking = (note: string) => note.match(/\btracking(?:\s*(?:number|no\.?|#|id))?\s*[:#]?\s*([A-Z0-9]{8,34})\b/i)?.[1]?.toUpperCase() ?? null;
export const parsePnr = (note: string) => note.match(/\b(?:PNR|booking\s*ref(?:erence)?)\s*[:#]?\s*([A-Z0-9]{6})\b/i)?.[1]?.toUpperCase() ?? null;

/* ── simulators (sandbox only) ── */
export const simulateCarrier = (n: string) => (n.endsWith("0") ? { status: "DELIVERED", level: "ok" as Level } : { status: "IN_TRANSIT", level: "warn" as Level });
export const simulatePnr = (p: string) => (p.startsWith("W") ? { status: "WAITLISTED", level: "fail" as Level } : { status: "CONFIRMED_TICKETED", level: "ok" as Level });

/* ── retry ── */
class Transient extends Error {}
export async function withRetry<T>(fn: () => Promise<T>, retries = RETRIES): Promise<{ value: T; tries: number }> {
  let last: unknown;
  for (let i = 0; i <= retries; i++) {
    try { return { value: await fn(), tries: i + 1 }; } catch (e) {
      last = e;
      if (!(e instanceof Transient) || i === retries) break;
      await deps.sleep(deps.baseDelayMs * 2 ** i);
    }
  }
  throw Object.assign(last instanceof Error ? last : new Error(String(last)), { tries: last instanceof Transient ? retries + 1 : 1 });
}

/* ── GitHub ── */
async function gh(path: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const h: Record<string, string> = { accept: "application/vnd.github+json", "user-agent": "PaySettle-oracle", "x-github-api-version": "2022-11-28" };
  const t = deps.githubToken();
  if (t) h.authorization = `Bearer ${t}`;
  let res: Response;
  try { res = await deps.fetch(`https://api.github.com${path}`, { headers: h }); } catch (e) { throw new Transient(`network error: ${(e as Error).message}`); }
  if (res.status >= 500 || res.status === 429 || (res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0")) throw new Transient(`GitHub answered ${res.status}`);
  let body: Record<string, unknown> = {};
  try { body = (await res.json()) as Record<string, unknown>; } catch { if (res.ok) throw new Transient("GitHub returned an unreadable answer"); }
  return { status: res.status, body };
}
async function githubCi(t: { owner: string; repo: string; branch?: string }): Promise<Omit<OracleOutcome, "oracle" | "input" | "tries" | "mode">> {
  const slug = `${t.owner}/${t.repo}`, src = "api.github.com";
  let branch = t.branch;
  if (!branch) {
    const r = await gh(`/repos/${slug}`);
    if (r.status === 404) return { status: "NOT_FOUND", level: "warn", detail: `GitHub CI: ${slug} was not found or is private (add GITHUB_TOKEN for private repositories).`, source: src };
    if (r.status !== 200) return { status: "ERROR", level: "warn", detail: `GitHub CI: ${slug} could not be read (HTTP ${r.status}).`, source: src };
    branch = String(r.body.default_branch ?? "main");
  }
  const r = await gh(`/repos/${slug}/actions/runs?branch=${encodeURIComponent(branch)}&per_page=1`);
  if (r.status === 404) return { status: "NOT_FOUND", level: "warn", detail: `GitHub CI: ${slug} was not found or is private (add GITHUB_TOKEN for private repositories).`, source: src };
  if (r.status !== 200) return { status: "ERROR", level: "warn", detail: `GitHub CI: ${slug} could not be read (HTTP ${r.status}).`, source: src };
  const run = (Array.isArray(r.body.workflow_runs) ? r.body.workflow_runs[0] : undefined) as Record<string, unknown> | undefined;
  if (!run) return { status: "NO_RUNS", level: "warn", detail: `GitHub CI: no workflow runs on ${slug}@${branch} yet.`, source: src };
  const name = String(run.name ?? "workflow").slice(0, 80), no = Number(run.run_number ?? 0), sha = String(run.head_sha ?? "").slice(0, 7);
  const what = `"${name}" run #${no} on ${slug}@${branch}${sha ? ` (commit ${sha})` : ""}`;
  if (run.status !== "completed") return { status: "RUNNING", level: "warn", detail: `GitHub CI: ${what} is still ${String(run.status ?? "running").replace("_", " ")}.`, source: src };
  const c = String(run.conclusion ?? "");
  if (c === "success") return { status: "PASSED", level: "ok", detail: `GitHub CI: ${what} passed.`, source: src };
  if (["failure", "timed_out", "cancelled", "startup_failure", "action_required"].includes(c)) return { status: "FAILED", level: "fail", detail: `GitHub CI: ${what} ended "${c.replace("_", " ")}". The contract asks for green CI.`, source: src };
  return { status: c.toUpperCase() || "UNKNOWN", level: "warn", detail: `GitHub CI: ${what} ended "${c || "unknown"}".`, source: src };
}

/* ── one oracle run ── */
export async function runOracle(oracle: OracleId, note: string): Promise<OracleOutcome> {
  const missing = (input: Record<string, unknown>, mode: Mode): OracleOutcome => ({ oracle, input, status: "NO_INPUT", level: "warn", detail: `${ORACLE_LABEL[oracle]}: nothing to check in the note. ${ORACLE_HOWTO[oracle]}`, mode, tries: 0, source: "note" });
  const manual = (input: Record<string, unknown>, why: string, tries: number): OracleOutcome => ({ oracle, input, status: "MANUAL_PENDING", level: "warn", detail: `${ORACLE_LABEL[oracle]}: hybrid manual mode — ${why} Operations can counter-verify.`, mode: "MANUAL_PENDING", tries, source: "manual" });
  if (oracle === "GITHUB_CI") {
    const t = parseGithub(note);
    if (!t) return missing({}, "LIVE");
    try {
      const { value, tries } = await withRetry(() => githubCi(t));
      return { oracle, input: t, mode: "LIVE", tries, ...value };
    } catch (e) {
      return manual(t, `GitHub could not be reached after ${RETRIES} retries (${(e as Error).message}).`, (e as { tries?: number }).tries ?? RETRIES + 1);
    }
  }
  if (oracle === "CARRIER_TRACKING") {
    const n = parseTracking(note);
    if (!n) return missing({}, "SIMULATED");
    if (!deps.sandbox()) return manual({ tracking: n }, "no carrier adapter is configured on this deployment.", 0);
    const r = simulateCarrier(n);
    return { oracle, input: { tracking: n }, mode: "SIMULATED", tries: 1, source: "simulator", ...r, detail: `Simulated carrier check: ${n} is ${r.status === "DELIVERED" ? "delivered" : "in transit"}.` };
  }
  const p = parsePnr(note);
  if (!p) return missing({}, "SIMULATED");
  if (!deps.sandbox()) return manual({ pnr: p }, "no airline lookup is configured on this deployment.", 0);
  const r = simulatePnr(p);
  return { oracle, input: { pnr: p }, mode: "SIMULATED", tries: 1, source: "simulator", ...r, detail: `Simulated PNR check: ${p} is ${r.status === "WAITLISTED" ? "waitlisted, not ticketed" : "confirmed and ticketed"}.` };
}

/* ── attestations ── */
function oracleKey(): string {
  const k = process.env.SIGNING_KEY;
  if (k) return k;
  if (!sandboxMode()) throw new Error("SIGNING_KEY is not set (P8)");
  return sha256("paysettle-sandbox-oracle-key:" + (process.env.DATABASE_URL ?? "local"));
}
type AttRow = typeof oracleAttestations.$inferSelect;
const signed = (r: Omit<AttRow, "signature">) => canonical({ ...r, at: r.at.toISOString() });
export const attestationSignature = (r: Omit<AttRow, "signature">) => createHmac("sha256", oracleKey()).update(signed(r)).digest("hex");
export function verifyAttestation(r: AttRow): boolean {
  const { signature, ...rest } = r;
  const want = Buffer.from(attestationSignature(rest), "hex"), got = Buffer.from(signature, "hex");
  return want.length === got.length && timingSafeEqual(want, got);
}
async function insertAttestation(q: Db | Parameters<Parameters<Db["transaction"]>[0]>[0], r: Omit<AttRow, "signature" | "id" | "at">): Promise<AttRow> {
  const row = { ...r, id: newId("orc"), at: new Date(Math.floor(Date.now() / 1000) * 1000) };
  const full = { ...row, signature: attestationSignature(row) };
  await q.insert(oracleAttestations).values(full);
  return full;
}
export const signalOf = (o: { oracle: string; level: Level; detail: string }): Signal => ({ code: `ORACLE_${o.oracle}`, level: o.level, detail: o.detail });

/**
 * Called once from submitEvidence (after the blocking checks). Mutates `signals`: drops the generic ORACLE_PENDING hint and
 * appends the oracle's own signal. Unknown oracle names keep the generic hint (the client confirms by hand).
 */
export async function oracleHook(signals: Signal[], c: { milestoneId: string; attempt: number; rootHash: string; proof: ProofSpec; note: string }): Promise<void> {
  if (!isOracle(c.proof.oracle)) return;
  const o = await runOracle(c.proof.oracle, c.note);
  await insertAttestation(db, { milestoneId: c.milestoneId, attempt: c.attempt, rootHash: c.rootHash, oracle: o.oracle, input: o.input, result: { status: o.status, detail: o.detail, source: o.source }, level: o.level, mode: o.mode, tries: o.tries, supersedes: null, verifiedBy: null });
  const i = signals.findIndex((s) => s.code === "ORACLE_PENDING");
  if (i >= 0) signals.splice(i, 1);
  signals.push(signalOf(o));
}

export interface AttestationView extends AttRow { current: boolean; valid: boolean; needsOps: boolean }
/** Every attestation for a milestone, newest first; `current` = not superseded by a manual counter-verification. */
export async function attestationsFor(milestoneId: string): Promise<AttestationView[]> {
  const rows = await db.select().from(oracleAttestations).where(eq(oracleAttestations.milestoneId, milestoneId)).orderBy(desc(oracleAttestations.attempt), desc(oracleAttestations.at));
  const superseded = new Set(rows.map((r) => r.supersedes).filter(Boolean));
  const latestAttempt = rows[0]?.attempt;
  return rows.map((r) => {
    const current = !superseded.has(r.id) && r.attempt === latestAttempt;
    return { ...r, current, valid: verifyAttestation(r), needsOps: current && r.mode !== "MANUAL" && r.level !== "ok" };
  });
}

/** Ops counter-verification (hybrid manual mode). Appends a MANUAL attestation and updates the package's oracle signal. */
export async function manualVerify(a: Actor, attestationId: string, p: { decision: "CONFIRMED" | "REJECTED"; note: string }): Promise<AttRow> {
  if (!canWrite(a.role, "oracle.manual_verify")) throw new DomainError("FORBIDDEN", "Only Operations can counter-verify an external check.");
  const note = p.note.trim().replace(/\s+/g, " ").slice(0, 300);
  if (note.length < 3) throw new DomainError("NOTE_REQUIRED", "Say what you checked, so the client can see it.");
  const [att] = await db.select().from(oracleAttestations).where(eq(oracleAttestations.id, attestationId)).limit(1);
  if (!att) throw new DomainError("NOT_FOUND", "That external check does not exist.");
  const views = await attestationsFor(att.milestoneId);
  const v = views.find((x) => x.id === att.id);
  if (!v?.current) throw new DomainError("CONFLICT", "A newer result exists for this check. Reload the page.");
  if (!v.needsOps) throw new DomainError("BAD_STATE", "This check does not need a manual decision.");
  const level: Level = p.decision === "CONFIRMED" ? "ok" : "fail";
  const detail = `${ORACLE_LABEL[att.oracle as OracleId] ?? att.oracle}: counter-verified by Operations — ${p.decision === "CONFIRMED" ? "confirmed" : "not confirmed"}. ${note}`;
  return db.transaction(async (tx) => {
    const row = await insertAttestation(tx, { milestoneId: att.milestoneId, attempt: att.attempt, rootHash: att.rootHash, oracle: att.oracle, input: att.input, result: { status: `MANUAL_${p.decision}`, detail, source: "manual" }, level, mode: "MANUAL", tries: 0, supersedes: att.id, verifiedBy: a.id });
    const [pkg] = await tx.select({ id: evidencePackages.id, signals: evidencePackages.signals }).from(evidencePackages).where(and(eq(evidencePackages.milestoneId, att.milestoneId), eq(evidencePackages.attempt, att.attempt))).limit(1);
    if (pkg) {
      const code = `ORACLE_${att.oracle}`;
      await tx.update(evidencePackages).set({ signals: [...pkg.signals.filter((s) => s.code !== code), { code, level, detail }] }).where(eq(evidencePackages.id, pkg.id));
    }
    await audit(tx, { id: a.id, role: a.role, requestId: a.requestId }, "oracle.manual_verify", att.milestoneId, { attestation: row.id, supersedes: att.id, oracle: att.oracle, decision: p.decision, attempt: att.attempt });
    return row;
  });
}
