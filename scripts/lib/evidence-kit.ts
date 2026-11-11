/**
 * Seed kit (F3.04, F3.06, F3.07, P4). Demo milestones get their evidence and their approvals the
 * way the product makes them, so every release in the demo data is backed by a recorded, signed approval:
 *  - filesForProof / noteForProof: generated sample files that meet a milestone's proof spec (PNG and PDF from
 *    src/server/evidence/samples.ts, a plain-text log, a minimal MP4 header; links and confirmations go in the note).
 *  - deliver(): the provider submits through the evidence module (submitEvidence).
 *  - deliverAndApprove(): deliver, then the client approves through the evidence module (approveMilestone), which signs
 *    over milestoneId + root hash and asks the money module to release.
 *  - recordPackage(): for seeds that write history directly (no rail call): stores real sample bytes, computes the
 *    signals with the evidence spec functions (specSignals) and, when approved, writes the APPROVE review with the evidence
 *    module's approvalSignature — the same signature the release row must carry.
 */
import { desc, eq } from "drizzle-orm";
import { db, type Tx } from "../../src/db/client";
import { evidencePackages, wsMilestones, type ProofSpec } from "../../src/db/schema";
import { evidenceReviews } from "../../src/db/schema-evidence";
import { sha256 } from "../../src/lib/ids";
import { approvalSignature, approveMilestone, requestFix, rootHashOf, submitEvidence } from "../../src/server/evidence";
import { samplePdf, samplePng } from "../../src/server/evidence/samples";
import { specSignals } from "../../src/server/evidence/spec";
import { objectStore } from "../../src/server/evidence/storage";

export interface SeedFile { name: string; type: string; bytes: Buffer }
type Ms = typeof wsMilestones.$inferSelect;

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "file";
function mp4(label: string): Buffer {
  const ftyp = Buffer.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 2, 0, 0x69, 0x73, 0x6f, 0x6d, 0x69, 0x73, 0x6f, 0x32]);
  const body = Buffer.from(label.slice(0, 200), "latin1");
  const free = Buffer.alloc(8); free.writeUInt32BE(8 + body.length, 0); free.write("free", 4, "latin1");
  return Buffer.concat([ftyp, free, body]);
}

/** Every uploadable artifact the proof spec asks for (kind × minimum), each with distinct bytes. */
export function filesForProof(proof: ProofSpec, code: string, title: string, attempt = 1): SeedFile[] {
  const out: SeedFile[] = [];
  let k = 0;
  for (const a of proof.artifacts ?? []) {
    for (let n = 1; n <= Math.max(1, a.min); n++) {
      k++;
      const what = a.note ?? a.kind.toLowerCase();
      const base = `${code.toLowerCase()}-${slug(what)}${a.min > 1 ? `-${n}` : ""}`;
      const head = `${title} - ${code}: ${what}`;
      switch (a.kind) {
        case "IMAGE": out.push({ name: `${base}.png`, type: "image/png", bytes: samplePng(360, 220, (code.charCodeAt(code.length - 1) * 37 + k * 53 + attempt * 11) % 360) }); break;
        case "PDF": out.push({ name: `${base}.pdf`, type: "application/pdf", bytes: samplePdf(head, [`Attempt ${attempt}.`, `Covers: ${what}.`, ...proof.criteria.map((c) => `Criterion: ${c}`)]) }); break;
        case "LOG": out.push({ name: `${base}.txt`, type: "text/plain", bytes: Buffer.from(`# ${head} (attempt ${attempt})\n[ok] 214 tests passed, 0 failed\n[ok] build green\n`) }); break;
        case "VIDEO": out.push({ name: `${base}.mp4`, type: "video/mp4", bytes: mp4(`${head} · attempt ${attempt}`) }); break;
        default: break; // LINK, SIGNATURE, ORACLE live in the note
      }
    }
  }
  return out;
}

/** The note: text, one demo URL per LINK required, and the upload form's confirmation markers for SIGNATURE and ORACLE. */
export function noteForProof(proof: ProofSpec, code: string, text: string): string {
  const links: string[] = [], marks = new Set<string>();
  for (const a of proof.artifacts ?? []) {
    if (a.kind === "LINK") for (let n = 1; n <= Math.max(1, a.min); n++) links.push(`https://staging.example.com/${code.toLowerCase()}/${links.length + 1}`);
    if (a.kind === "SIGNATURE" || a.kind === "ORACLE") marks.add(`[confirmed:${a.kind}]`);
  }
  return [text, ...links, [...marks].join(" ")].filter(Boolean).join("\n");
}

async function load(milestoneId: string): Promise<Ms> {
  const [m] = await db.select().from(wsMilestones).where(eq(wsMilestones.id, milestoneId)).limit(1);
  if (!m) throw new Error(`milestone ${milestoneId} missing`);
  return m;
}
async function latest(milestoneId: string) {
  const [p] = await db.select().from(evidencePackages).where(eq(evidencePackages.milestoneId, milestoneId)).orderBy(desc(evidencePackages.attempt)).limit(1);
  return p ?? null;
}

export interface Parties { clientId: string; providerId: string; title: string }

/** The provider submits evidence that meets the spec (real evidence module path). Idempotent: a submitted package is reused. */
export async function deliver(w: Parties, milestoneId: string, text?: string): Promise<{ rootHash: string }> {
  const m = await load(milestoneId);
  const have = await latest(m.id);
  if (have && ["SUBMITTED", "APPROVED", "ESCALATED"].includes(m.state)) return { rootHash: have.rootHash };
  const attempt = m.attempts + 1;
  const r = await submitEvidence({ id: w.providerId, role: "provider", name: "seed" }, m.id, filesForProof(m.proof, m.code, w.title, attempt),
    noteForProof(m.proof, m.code, text ?? `${m.code} ${m.title}: delivered as agreed (attempt ${attempt}).`));
  return { rootHash: r.rootHash };
}

/** deliver(), then the client's signed approval (evidence module), which triggers the money module's release. */
export async function deliverAndApprove(w: Parties, milestoneId: string, o: { fixFirst?: string } = {}): Promise<void> {
  let m = await load(milestoneId);
  if (["RELEASED", "SETTLED_BY_VERDICT", "REFUNDED"].includes(m.state)) return;
  const client = { id: w.clientId, role: "client" as const, name: "seed" };
  if (m.state !== "APPROVED") {
    let { rootHash } = await deliver(w, m.id);
    m = await load(milestoneId);
    if (o.fixFirst && m.attempts === 1 && m.state === "SUBMITTED") { // a soft rejection, then the fixed resubmission
      await requestFix(client, m.id, [o.fixFirst]);
      ({ rootHash } = await deliver(w, m.id, `${m.code} ${m.title}: fixed as requested (${o.fixFirst})`));
    }
    await approveMilestone(client, m.id, rootHash);
  } else {
    const p = await latest(m.id);
    if (p) await approveMilestone(client, m.id, p.rootHash); // signed earlier, release queued: retried with the stored signature
  }
}

/**
 * For history written directly (seed-identity, seed-control's drifted contract): one evidence package with real sample
 * bytes in the object store and signals from the evidence spec; with `approve`, the client's APPROVE review signed with
 * approvalSignature. Returns the signature (or null) and the package id. Idempotent per (milestone, attempt).
 */
export async function recordPackage(q: Tx | typeof db, m: Pick<Ms, "id" | "code" | "title" | "proof">, p: {
  title: string; providerId: string; clientId: string; attempt?: number; state: "SUBMITTED" | "APPROVED" | "FIX_REQUESTED" | "REJECTED";
  approve?: boolean; fixItems?: string[]; note?: string; rawNote?: boolean; at?: Date;
}): Promise<{ packageId: string; rootHash: string; signature: string | null }> {
  const attempt = p.attempt ?? 1;
  const files = filesForProof(m.proof, m.code, p.title, attempt);
  const text = p.note ?? `${m.code} ${m.title}: delivered as agreed (attempt ${attempt}).`;
  const note = p.rawNote ? text : noteForProof(m.proof, m.code, text);
  const store = objectStore();
  const shas = files.map((f) => sha256(f.bytes));
  for (let i = 0; i < files.length; i++) await store.putObject(shas[i], files[i].bytes);
  const rootHash = rootHashOf(shas, note);
  const signals = [...specSignals(m.proof, files, note), { code: "HASH", level: "ok" as const, detail: `Root ${rootHash.slice(0, 12)}… over ${files.length} file${files.length === 1 ? "" : "s"} (SHA-256).` }];
  const id = `${m.id}_ev${attempt}`;
  const at = p.at ?? new Date();
  await q.insert(evidencePackages).values({
    id, milestoneId: m.id, attempt, rootHash, note, submittedBy: p.providerId, state: p.state, signals,
    verifier: { available: false, reason: "Seeded history: the AI verifier did not run.", at: at.toISOString() },
    files: files.map((f, i) => ({ name: f.name, kind: f.type, size: f.bytes.length, sha256: shas[i], url: `/api/evidence/file/${shas[i]}` })), createdAt: at,
  }).onConflictDoNothing();
  let signature: string | null = null;
  if (p.approve) {
    signature = approvalSignature(m.id, rootHash);
    await q.insert(evidenceReviews).values({ id: `${id}_rv`, packageId: id, milestoneId: m.id, decision: "APPROVE", rootHash, signature, byUser: p.clientId, mfa: "sandbox-skip", createdAt: at }).onConflictDoNothing();
  } else if (p.fixItems?.length) {
    await q.insert(evidenceReviews).values({ id: `${id}_rv`, packageId: id, milestoneId: m.id, decision: "REQUEST_FIX", items: p.fixItems, rootHash, byUser: p.clientId, createdAt: at }).onConflictDoNothing();
  }
  return { packageId: id, rootHash, signature };
}

