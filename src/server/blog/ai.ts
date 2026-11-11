/**
 * P3 · P10 — blog drafting. Advisory by design: the AI (through the one AI gateway, src/lib/ai/gateway.ts) only
 * proposes blocks; the service always saves the result as a DRAFT and a person publishes after the claim guard passes.
 *
 * - AI on (flag ai.enabled and a key configured): structured call validated with the real Blocks zod union; the gateway
 *   retries once with the validation error, then gives up. The answer is sanitised (duplicate ids renamed, case studies
 *   on unknown blueprints and API samples that look like secrets dropped).
 * - AI off, cap reached, provider failed or output invalid: a rule-based outline (tldr + headings + text placeholders, all
 *   marked claimStatus "illustrative") built from the brief. Placeholders carry OUTLINE_MARK, which the publish check refuses.
 * The brief is untrusted input (P11): it goes to the model as an untrusted part and lands in the outline only as plain text.
 */
import { z } from "zod";
import { Blocks, newBlockId, TOPIC_LABEL, type Block, type Topic } from "@/lib/blog/blocks";
import { RAIL_CAP_DAYS, RISK_OPS_THRESHOLD } from "@/lib/policy";
import type { AiGateway } from "@/lib/ai/gateway";
import { BLUEPRINTS } from "@/data/blueprints";
import { BLUEPRINT_CODES, looksSecret, OUTLINE_MARK } from "./lint";

export const BLOG_PROMPT = { id: "WPB.blog_draft", version: "v1" } as const;
export const blogPurpose = `${BLOG_PROMPT.id}@${BLOG_PROMPT.version}`;

export interface Brief { topic: Topic; title: string; angle: string }

export const AiDraft = z.object({ dek: z.string().min(1).max(300), blocks: Blocks });
export type AiDraft = z.infer<typeof AiDraft>;

export function blogSystemPrompt(): string {
  return [
    "You draft articles for the PaySettle blog. PaySettle runs milestone contracts where the client's money is held through PayPal and released milestone by milestone when the client approves agreed evidence, or when a human mediator rules on a dispute.",
    "Facts you may state as product behaviour (mark those blocks claimStatus \"product\"):",
    `- Platform fee: 250 basis points by default, charged only on amounts released to the provider; refunded amounts carry no fee.`,
    `- PayPal holds are split into tranches so no hold outlives its window: rail A tranches cover at most ${RAIL_CAP_DAYS.A1} days, rail B (delayed disbursement) at most ${RAIL_CAP_DAYS.B} days.`,
    "- The client has 48 hours to review evidence, with reminders at 24 and 36 hours; what happens after 72 hours is set in the contract (escalation to Ops by default).",
    "- Contract clauses are never edited after signing: changes append a new clause or prune an unused one, and any change voids both signatures until both parties sign again.",
    `- Contracts with a risk score of ${RISK_OPS_THRESHOLD} or more need an Ops review before funding.`,
    "- AI in PaySettle is advisory: it never signs, approves, releases or refunds money.",
    "Rules for your answer:",
    "- Write plain, calm, specific English for clients, providers and finance teams. Short paragraphs. No hype.",
    "- Never promise outcomes: no \"guaranteed\", \"risk-free\", \"100% irreversible\", \"bank-grade\", \"fully compliant\".",
    "- Every block that states a % or $ figure, and every statRow, needs sources[] (real pages you are sure exist, e.g. developer.paypal.com) or claimStatus \"illustrative\" for a worked example with made-up numbers. If unsure, use \"illustrative\". Never invent a citation.",
    "- Start with one tldr block. Use heading blocks (level 2) for sections, text blocks for paragraphs (inline **bold**, *italic*, [label](/path) only; no HTML). End with one cta block whose href is a path on this site such as /playground or /how-it-works.",
    `- A caseStudy block must use one of these blueprint codes: ${BLUEPRINTS.filter((b) => b.depth === "full").map((b) => b.code).join(", ")}.`,
    "- apiSnippet blocks never contain keys or tokens; use placeholders like <ACCESS_TOKEN>.",
    "- Give each block a short unique id (letters and digits). 12 to 30 blocks.",
  ].join("\n");
}

/** Make an AI answer safe to store: unique ids, no case study on an unknown blueprint, no secret-looking API sample. */
export function sanitizeAiBlocks(blocks: Block[]): Block[] {
  const seen = new Set<string>();
  const out: Block[] = [];
  for (const b of blocks) {
    if (b.type === "caseStudy" && !BLUEPRINT_CODES.has(b.blueprintCode)) continue;
    if (b.type === "apiSnippet" && looksSecret(`${b.path} ${b.request ?? ""} ${b.response ?? ""} ${b.note ?? ""}`)) continue;
    let id = b.id;
    while (seen.has(id)) id = newBlockId();
    seen.add(id);
    out.push(id === b.id ? b : { ...b, id });
  }
  return out;
}

const SECTIONS: Record<Topic, [string, string][]> = {
  explainer: [["The problem", "what goes wrong today, for whom, and what it costs them"], ["How it works", "the mechanism step by step, in plain words"], ["A worked example", "one job with real-looking numbers, labelled Illustrative"], ["What to check", "what a reader should look for before they sign or pay"]],
  product: [["What it does", "the feature in one paragraph and who it is for"], ["How to use it", "the steps in the app, screen by screen"], ["What it does not do", "the limits and the human decisions that stay human"], ["Try it", "where to see it in the playground"]],
  "case-study": [["The job", "the client, the provider and what was agreed"], ["The milestones", "how the money was split and what evidence each step needed"], ["What happened", "the review, any dispute, and where the money went at each step"], ["What we learned", "what the parties would do the same or differently"]],
  trust: [["The concern", "the risk in the reader's own words"], ["Our answer", "what PaySettle does about it today"], ["How you can check", "the screen, export or log that shows it"], ["What is still open", "what we have not solved yet and when we will report back"]],
  finance: [["The numbers you need", "which figures finance teams ask for and why"], ["Where the money sits", "hold, release, fee and refund at each step"], ["Reconciling", "how the three records are matched to the cent"], ["Exports", "which exports exist and what each one proves"]],
};

const clip = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`);

/** Rule-based outline when AI is off or its answer is unusable. Always valid against Blocks; never publishable as is. */
export function outlineDraft(brief: Brief): AiDraft {
  const angle = brief.angle.replace(/\s+/g, " ").trim();
  const sentences = angle.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s.length > 3).slice(0, 3);
  const items = (sentences.length ? sentences : [angle || brief.title]).map((s) => clip(`${OUTLINE_MARK} ${s}`, 240));
  const blocks: Block[] = [
    { id: newBlockId(), type: "tldr", title: "In short", items, claimStatus: "illustrative" },
  ];
  for (const [heading, hint] of SECTIONS[brief.topic]) {
    blocks.push({ id: newBlockId(), type: "heading", level: 2, text: heading });
    blocks.push({
      id: newBlockId(), type: "text", claimStatus: "illustrative",
      body: clip(`${OUTLINE_MARK} Write this section: ${hint}.\n\nBrief: ${angle || brief.title}\n\nEvery figure needs a source, or keep the Illustrative label.`, 6000),
    });
  }
  blocks.push({ id: newBlockId(), type: "cta", title: "See it with simulated money", body: "Run the scenario in the Judge Playground.", label: "Open the playground", href: "/playground" });
  return { dek: clip(`${TOPIC_LABEL[brief.topic]}: ${angle || brief.title}`, 300), blocks };
}

export type DraftOutcome = { usedAi: true; draft: AiDraft; model: string } | { usedAi: false; draft: AiDraft; reason: string };

/** Ask the model for a draft; fall back to the outline on any failure. `aiAllowed` is the admin switch (flag ai.enabled). */
export async function draftBlocks(gw: AiGateway, brief: Brief, aiAllowed: boolean): Promise<DraftOutcome> {
  if (!aiAllowed) return { usedAi: false, draft: outlineDraft(brief), reason: "AI assistance is switched off by an admin. A rule-based outline was created instead." };
  const out = await gw.structured({
    purpose: blogPurpose, system: blogSystemPrompt(), schema: AiDraft, maxTokens: 6_000,
    parts: [
      { kind: "text", text: `Topic: ${TOPIC_LABEL[brief.topic]} (${brief.topic}).` },
      { kind: "untrusted", source: "author's working title", text: brief.title },
      { kind: "untrusted", source: "author's brief", text: brief.angle },
    ],
  });
  if (!out.ok) return { usedAi: false, draft: outlineDraft(brief), reason: `${out.reason} A rule-based outline was created instead.` };
  const blocks = sanitizeAiBlocks(out.data.blocks);
  const parsed = Blocks.safeParse(blocks);
  if (!parsed.success) return { usedAi: false, draft: outlineDraft(brief), reason: "The AI draft had no usable blocks after safety checks. A rule-based outline was created instead." };
  return { usedAi: true, draft: { dek: out.data.dek, blocks: parsed.data }, model: out.model };
}
