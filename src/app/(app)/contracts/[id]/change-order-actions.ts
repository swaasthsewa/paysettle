"use server";
/**
 * F2.12 — change order server actions for the contract room. The propose form posts the room's current values; this
 * action keeps only what the person changed (compared with the contract as stored now) and sends it to the service,
 * which re-plans everything server-side. Sign and decline carry the change order id and the hash the person saw.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { parseDollarsToCents } from "@/server/contracts";
import { changeOrderRoom, declineChangeOrder, proposeChangeOrder, signChangeOrder } from "@/server/contracts/change-orders";
import type { CoItem } from "@/server/contracts/change-core";
import { createContinuation } from "@/server/contracts/continuation";
import { currentActor, domainMessage } from "@/server/contracts/web";
import { db } from "@/db/client";
import { changeOrders } from "@/db/schema-amend";
import { eq } from "drizzle-orm";
import type { ProofSpec } from "@/db/schema";
import { DomainError } from "@/server/types";

const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const intOf = (v: string) => (/^\d{1,6}$/.test(v) ? Number(v) : NaN);
const lines = (v: string) => v.split(/\r?\n/).map((x) => x.trim()).filter(Boolean).slice(0, 20);
const KINDS = ["IMAGE", "VIDEO", "PDF", "LOG", "LINK", "SIGNATURE", "ORACLE"] as const;
type Kind = (typeof KINDS)[number];

/** "2 × IMAGE — before and after photos" (also "2 x image - …") → artifact; null when a line does not read. */
async function parseProofLines(text: string): Promise<ProofSpec["artifacts"] | null> {
  const out: ProofSpec["artifacts"] = [];
  for (const l of lines(text)) {
    const m = /^(\d{1,2})\s*[x×*]\s*([A-Za-z]+)\s*(?:[—–-]\s*(.*))?$/.exec(l);
    if (!m || !KINDS.includes(m[2].toUpperCase() as Kind)) return null;
    out.push({ kind: m[2].toUpperCase() as Kind, min: Number(m[1]), ...(m[3]?.trim() ? { note: m[3].trim().slice(0, 200) } : {}) });
  }
  return out;
}

export async function proposeChangeOrderAction(f: FormData) {
  const id = s(f, "wsId");
  if (!/^ws_[a-z0-9]{1,40}$/.test(id)) redirect("/client/contracts");
  const path = `/contracts/${id}`;
  const { a } = await currentActor(["client", "provider"]);
  let msg: string | null = null;
  try {
    const room = await changeOrderRoom(a, id);
    const items: CoItem[] = [];
    for (const m of room.milestones.filter((x) => !x.frozen)) {
      if (!f.has(`day_${m.code}`)) continue;
      if (f.get(`remove_${m.code}`)) { items.push({ action: "REMOVE", milestoneCode: m.code }); continue; }
      const e: Extract<CoItem, { action: "EDIT" }> = { action: "EDIT", milestoneCode: m.code };
      const title = s(f, `title_${m.code}`);
      if (title && title !== m.title) e.title = title;
      const day = intOf(s(f, `day_${m.code}`));
      if (!Number.isFinite(day)) throw new DomainError("INVALID_INPUT", `${m.code}: the due day must be a whole number.`);
      if (day !== m.day) e.day = day;
      if (m.type === "PAY") {
        const cents = parseDollarsToCents(s(f, `amount_${m.code}`));
        if (cents === null) throw new DomainError("INVALID_INPUT", `${m.code}: enter the amount in dollars, for example 1,200 or 1200.50.`);
        if (cents !== m.amountCents) e.amountCents = cents;
      }
      const artifacts = await parseProofLines(s(f, `proof_${m.code}`));
      if (!artifacts) throw new DomainError("INVALID_INPUT", `${m.code}: write each proof line as “count × kind — what it shows”, for example “2 × IMAGE — before and after photos”.`);
      const criteria = lines(s(f, `criteria_${m.code}`));
      if (JSON.stringify(artifacts) !== JSON.stringify(m.proof.artifacts) || JSON.stringify(criteria) !== JSON.stringify(m.proof.criteria)) e.proof = { ...m.proof, artifacts, criteria };
      if (Object.keys(e).length > 2) items.push(e);
    }
    for (const n of [1, 2]) {
      const title = s(f, `new${n}_title`);
      if (!title) continue;
      const type = s(f, `new${n}_type`) === "GATE" ? "GATE" : "PAY";
      const day = intOf(s(f, `new${n}_day`));
      const cents = type === "GATE" ? 0 : parseDollarsToCents(s(f, `new${n}_amount`));
      if (!Number.isFinite(day)) throw new DomainError("INVALID_INPUT", `New milestone ${n}: the due day must be a whole number.`);
      if (cents === null) throw new DomainError("INVALID_INPUT", `New milestone ${n}: enter the amount in dollars, for example 1,200.`);
      const kind = s(f, `new${n}_artifact`).toUpperCase() as Kind;
      const min = intOf(s(f, `new${n}_min`) || "1");
      items.push({ action: "ADD", milestone: { title, type, day, amountCents: cents, lockRule: s(f, `new${n}_lock`), disputeRule: s(f, `new${n}_dispute`),
        proof: { artifacts: KINDS.includes(kind) && Number.isFinite(min) && min > 0 ? [{ kind, min }] : [], criteria: lines(s(f, `new${n}_criteria`)) } } });
    }
    if (!items.length) throw new DomainError("INVALID_INPUT", "Nothing changed. Edit, remove or add at least one milestone.");
    const rev = intOf(s(f, "rev"));
    await proposeChangeOrder(a, id, { items, note: s(f, "note"), expectedRev: Number.isFinite(rev) ? rev : undefined });
  } catch (e) { msg = domainMessage(e); }
  revalidatePath(path);
  redirect(msg ? `${path}?err=${encodeURIComponent(msg)}#co` : `${path}?ok=co_proposed#co`);
}

async function coPath(coId: string): Promise<string> {
  if (!/^co_[a-z0-9]{1,40}$/.test(coId)) redirect("/client/contracts");
  const [co] = await db.select({ ws: changeOrders.workspaceId }).from(changeOrders).where(eq(changeOrders.id, coId)).limit(1);
  if (!co) redirect("/client/contracts");
  return `/contracts/${co.ws}`;
}

export async function signChangeOrderAction(f: FormData) {
  const coId = s(f, "coId");
  const path = await coPath(coId);
  const { a } = await currentActor(["client", "provider"]);
  let msg: string | null = null, state = "";
  try { state = (await signChangeOrder(a, coId, s(f, "hash"), s(f, "mfa") || undefined)).state; } catch (e) { msg = domainMessage(e); }
  revalidatePath(path);
  redirect(msg ? `${path}?err=${encodeURIComponent(msg)}#co` : `${path}?ok=co_${state.toLowerCase()}#co`);
}

export async function declineChangeOrderAction(f: FormData) {
  const coId = s(f, "coId");
  const path = await coPath(coId);
  const { a } = await currentActor(["client", "provider"]);
  let msg: string | null = null;
  try { await declineChangeOrder(a, coId, s(f, "note")); } catch (e) { msg = domainMessage(e); }
  revalidatePath(path);
  redirect(msg ? `${path}?err=${encodeURIComponent(msg)}#co` : `${path}?ok=co_closed#co`);
}

/** F2.13 continue a locked contract into its next period (a new draft linked to this one). */
export async function continueAction(f: FormData) {
  const id = s(f, "wsId");
  if (!/^ws_[a-z0-9]{1,40}$/.test(id)) redirect("/client/contracts");
  const { a } = await currentActor(["client", "provider"]);
  let msg: string | null = null, next = "";
  try { next = (await createContinuation(a, id, { title: s(f, "title") || undefined, repeat: Boolean(f.get("repeat")), carry: f.getAll("carry").map((x) => String(x)), note: s(f, "note") || undefined })).workspaceId; }
  catch (e) { msg = domainMessage(e); }
  revalidatePath(`/contracts/${id}`);
  redirect(msg ? `/contracts/${id}?err=${encodeURIComponent(msg)}#next-period` : `/contracts/${next}?ok=continued`);
}
