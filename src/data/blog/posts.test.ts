/* P10 P11 — the nine sample posts are publishable as written: each validates against Blocks, passes the claim
 * guard (claimProblems) and the blog service's publish checks (copy lint, structure), has 900–1,500 words, cites PayPal only
 * to developer.paypal.com, links only to pages that exist, and quotes the same money figures the live blocks compute. */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Blocks, TOPICS, claimProblems, plainText, type Block } from "@/lib/blog/blocks";
import { parseBody, wordCount, type Inline } from "@/lib/blog/format";
import { formatCents } from "@/lib/money";
import { publishProblems } from "@/server/blog/lint";
import { moneyFlowParts } from "@/components/blog/math";
import { POSTS } from "./posts";

/** Every reader-facing word of a post: plainText() plus headings, captions, titles and button text. */
function allWords(p: (typeof POSTS)[number]): string {
  const extra = p.blocks.flatMap((b: Block) => {
    switch (b.type) {
      case "heading": return [b.text];
      case "callout": return [];
      case "image": return [b.caption ?? ""];
      case "cta": return [b.title, b.body ?? ""];
      case "moneyFlow": case "trancheTimeline": return [b.caption ?? ""];
      case "apiSnippet": return [b.note ?? ""];
      case "compareTable": return b.columns;
      default: return [];
    }
  });
  return [p.title, p.dek, plainText(p.blocks), ...extra].join("\n");
}
const BANNED = (() => {
  const src = readFileSync(path.resolve(process.cwd(), "tools/copy-lint.mjs"), "utf8");
  const m = /const BANNED = \[([^\n]*?)\];/.exec(src);
  if (!m) throw new Error("could not read BANNED from tools/copy-lint.mjs");
  return [...m[1].matchAll(/\/((?:\\\/|[^/])+)\/([a-z]*)/g)].map((x) => new RegExp(x[1], x[2]));
})();
const internalLinks = (p: (typeof POSTS)[number]) => {
  const out: string[] = [];
  for (const b of p.blocks) {
    if (b.type === "cta") out.push(b.href);
    const bodies = b.type === "text" ? [b.body] : b.type === "callout" ? [b.body] : b.type === "faq" ? b.items.map((i) => i.a) : [];
    for (const body of bodies) for (const para of parseBody(body)) {
      const walk = (ns: Inline[]): void => { for (const n of ns) { if (n.t === "a" && !n.external) out.push(n.href); if (n.t !== "text") walk(n.c); } };
      walk(para.kind === "p" ? para.inline : para.items.flat());
    }
  }
  return out;
};
const routeExists = (href: string) => {
  const p = href.split(/[?#]/)[0].replace(/\/$/, "") || "/";
  const app = path.resolve(process.cwd(), "src/app");
  const segs = p.split("/").filter(Boolean).join("/");
  return ["(site)", "(app)", "(auth)", ""].some((g) => existsSync(path.join(app, g, segs, "page.tsx")));
};

describe("P10 sample posts", () => {
  it("there are nine posts with unique slugs, unique block ids and known topics", () => {
    expect(POSTS).toHaveLength(9);
    expect(new Set(POSTS.map((p) => p.slug)).size).toBe(9);
    for (const p of POSTS) {
      expect(p.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(TOPICS).toContain(p.topic);
      expect(new Set(p.blocks.map((b) => b.id)).size, p.slug).toBe(p.blocks.length);
    }
  });

  for (const p of POSTS) {
    describe(p.slug, () => {
      it("P11 validates against the Blocks schema unchanged", () => {
        const r = Blocks.safeParse(p.blocks);
        expect(r.success, r.success ? "" : JSON.stringify(r.error.issues.slice(0, 3))).toBe(true);
        expect(r.data).toEqual(p.blocks);
      });
      it("P10 passes the claim guard and the publish checks", () => {
        expect(claimProblems(p.blocks)).toEqual([]);
        expect(publishProblems({ title: p.title, dek: p.dek, blocks: p.blocks, heroSrc: p.heroSrc ?? null, heroAlt: p.heroAlt ?? null, seo: null })).toEqual([]);
      });
      it("P10 uses no banned guarantee language anywhere (same list as tools/copy-lint.mjs)", () => {
        const all = JSON.stringify(p);
        for (const re of BANNED) expect(re.test(all), `${re} in ${p.slug}`).toBe(false);
        expect(/\bguarantee/i.test(allWords(p)), "no guarantee wording").toBe(false);
      });
      it("is 900–1,500 words", () => {
        const n = wordCount(allWords(p));
        expect(n, `${p.slug}: ${n} words`).toBeGreaterThanOrEqual(900);
        expect(n, `${p.slug}: ${n} words`).toBeLessThanOrEqual(1500);
      });
      it("P10 every block with a figure carries a source or a label, and PayPal facts cite developer.paypal.com", () => {
        for (const b of p.blocks) {
          const t = plainText([b]);
          if (/\d/.test(t) && b.type !== "heading") expect(Boolean(b.sources?.length || b.claimStatus), `${p.slug}/${b.id}`).toBe(true);
          for (const s of b.sources ?? []) if (/paypal/i.test(s.title)) expect(s.url.startsWith("https://developer.paypal.com/"), s.url).toBe(true);
        }
      });
      it("internal links point at pages that exist", () => {
        for (const href of internalLinks(p)) expect(routeExists(href), href).toBe(true);
      });
      it("P6 money figures quoted near a moneyFlow block match what the block computes", () => {
        for (const b of p.blocks) {
          if (b.type !== "moneyFlow") continue;
          const f = moneyFlowParts(b.totalCents, b.releasedBps, b.refundedBps, b.feeBps);
          const text = plainText(p.blocks);
          for (const c of [f.releasedCents, f.feeCents, f.providerNetCents].filter((x) => x > 0)) expect(text, `${p.slug}/${b.id} should quote ${formatCents(c)}`).toContain(formatCents(c));
        }
      });
    });
  }
});
