/* P6 P10 P11 — blog renderer unit tests: the inline text format is parsed safely (HTML and script stay text,
 * unsafe links are dropped), every block type renders, moneyFlow math matches src/lib/money, tranche windows match
 * src/lib/policy, case-study amounts add up to the cent, JSON-LD and RSS escape their content. */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Blocks, BLOCK_TYPES, claimProblems, type Block } from "@/lib/blog/blocks";
import { inlineText, parseBody, parseInline, safeHref } from "@/lib/blog/format";
import { articleJsonLd, breadcrumbJsonLd, faqJsonLd, jsonLd, rssXml, xmlEscape } from "@/lib/blog/seo";
import { BPS_FULL, feeFor } from "@/lib/money";
import { RAIL_CAP_DAYS, watchdogPlan } from "@/lib/policy";
import { BlockRenderer, collectSources, headingsOf } from "./BlockRenderer";
import { caseStudyView, moneyFlowParts, tranchePlan } from "./math";
import type { Post } from "@/server/blog";

const html = (blocks: Block[], preview = false) => renderToStaticMarkup(createElement(BlockRenderer, { blocks, preview }));
const SRC = { title: "PayPal Developer — Authorize a payment", url: "https://developer.paypal.com/docs/checkout/standard/customize/authorization/" };

describe("P11 inline text format", () => {
  it("P11 keeps <script> and HTML as literal text, never markup", () => {
    const out = html([{ id: "x1", type: "text", body: `Hello <script>alert("x")</script> <img src=x onerror=alert(1)> &amp; **bold**` }]);
    expect(out).not.toContain("<script>");
    expect(out).not.toContain("<img src=x");
    expect(out).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    expect(out).toContain("&amp;amp;");
    expect(out).toContain("<strong>bold</strong>");
  });

  it("P11 renders bold, italic, internal and external links; drops javascript:, data: and protocol-relative links", () => {
    const nodes = parseInline("A **b** and *i* to [demo](/playground) and [docs](https://developer.paypal.com/x) not [bad](javascript:alert(1)) nor [d](data:text/html,x) nor [p](//evil.example)");
    const links = nodes.filter((n) => n.t === "a");
    expect(links).toHaveLength(2);
    expect(links.map((l) => (l.t === "a" ? [l.href, l.external] : null))).toEqual([["/playground", false], ["https://developer.paypal.com/x", true]]);
    expect(inlineText(nodes)).toContain("[bad](javascript:alert(1))");
    const out = html([{ id: "x2", type: "text", body: "Go to [demo](/playground) or [docs](https://developer.paypal.com/x)." }]);
    expect(out).toContain('href="/playground"');
    expect(out).toContain('href="https://developer.paypal.com/x" rel="noopener noreferrer" target="_blank"');
    expect(out).toContain("(opens in a new tab)");
    expect(out).not.toMatch(/javascript:/);
  });

  it("P11 safeHref accepts only site paths and http(s) URLs", () => {
    expect(safeHref("/blog/x?topic=a#h")).toEqual({ href: "/blog/x?topic=a#h", external: false });
    expect(safeHref("https://example.com/a")?.external).toBe(true);
    for (const bad of ["javascript:alert(1)", "JaVaScRiPt:x", "data:text/html,1", "//evil.com", "vbscript:x", "/a\"onmouseover=x", "ftp://x.y"]) expect(safeHref(bad)).toBeNull();
  });

  it("splits paragraphs on blank lines and turns '- ' lines into a list; unmatched markers stay literal", () => {
    const p = parseBody("One\nline\n\n- a\n- **b**\n\nprice * 2 and **open");
    expect(p.map((x) => x.kind)).toEqual(["p", "ul", "p"]);
    expect(p[0].kind === "p" && inlineText(p[0].inline)).toBe("One line");
    expect(p[1].kind === "ul" && p[1].items.length).toBe(2);
    expect(p[2].kind === "p" && inlineText(p[2].inline)).toBe("price * 2 and **open");
  });
});

describe("P6 live money blocks", () => {
  it("P6 moneyFlow: fee on the released part only, refund carries no fee, parts add up to the cent", () => {
    const f = moneyFlowParts(850_000, 2500, 0, 250);
    expect(f).toMatchObject({ releasedCents: 212_500, feeCents: 5312, providerNetCents: 207_188, refundedCents: 0, stillHeldCents: 637_500 });
    const d = moneyFlowParts(300_000, 6200, 3800, 250);
    expect(d).toMatchObject({ releasedCents: 186_000, feeCents: 4650, providerNetCents: 181_350, refundedCents: 114_000, stillHeldCents: 0 });
    for (const [t, r, rf] of [[100_001, 3333, 3333], [99, 5000, 5000], [1_234_567, 10_000, 0], [777, 0, 10_000]]) {
      const x = moneyFlowParts(t, r, rf, 250);
      expect(x.releasedCents + x.refundedCents + x.stillHeldCents).toBe(t);
      expect(x.feeCents).toBe(feeFor(x.releasedCents, 250));
      expect(x.providerNetCents + x.feeCents).toBe(x.releasedCents);
    }
  });

  it("P6 moneyFlow clamps shares so released + refunded never pass 100%", () => {
    const x = moneyFlowParts(10_000, 8000, 5000, 250);
    expect(x.releasedBps + x.refundedBps + x.heldBps).toBe(BPS_FULL);
    expect(x.refundedBps).toBe(2000);
  });

  it("F2.07 trancheTimeline windows come from trancheOf and respect each rail's cap", () => {
    expect(tranchePlan(60, "A1").tranches.map((t) => [t.fromDay, t.toDay])).toEqual([[1, 26], [27, 52], [53, 60]]);
    expect(tranchePlan(60, "B").tranches.map((t) => [t.fromDay, t.toDay])).toEqual([[1, 25], [26, 50], [51, 60]]);
    expect(tranchePlan(26, "A1").tranches).toHaveLength(1);
    for (const r of ["A1", "A2", "B"] as const) for (const d of [1, 25, 26, 27, 90, 365]) {
      const p = tranchePlan(d, r);
      expect(p.tranches.reduce((a, t) => a + t.days, 0)).toBe(d);
      expect(Math.max(...p.tranches.map((t) => t.days))).toBeLessThanOrEqual(RAIL_CAP_DAYS[r]);
      expect(p.watchdog.map((w) => w.day)).toEqual(watchdogPlan(r).map((w) => w.day));
    }
  });

  it("F2.06 caseStudy lists the blueprint's real milestones and the amounts add up to the total", () => {
    const v = caseStudyView("UC_CLASSIC_CAR", 1_450_000)!;
    expect(v.rows).toHaveLength(20);
    expect(v.payCount).toBe(15);
    expect(v.rows.reduce((a, r) => a + r.amountCents, 0)).toBe(1_450_000);
    expect(v.rows.find((r) => r.code === "M03")?.amountCents).toBe(72_500);
    expect(v.tranches).toBe(1);
    const odd = caseStudyView("UC_WEB_MVP", 100_001)!;
    expect(odd.rows.reduce((a, r) => a + r.amountCents, 0)).toBe(100_001);
    expect(caseStudyView("NO_SUCH_BLUEPRINT", 1000)).toBeNull();
  });
});

const ONE_OF_EACH: Block[] = Blocks.parse([
  { id: "t", type: "tldr", items: ["One", "Two"] },
  { id: "h", type: "heading", text: "Section one" },
  { id: "h3", type: "heading", level: 3, text: "Sub" },
  { id: "p", type: "text", body: "Para with 2.5% fee.", claimStatus: "product", sources: [SRC] },
  { id: "i", type: "image", src: "/blog/three-way-recon.svg", alt: "Three planes", caption: "Cap" },
  { id: "q", type: "quote", text: "Quoted", by: "Someone" },
  { id: "c", type: "callout", tone: "warn", title: "Careful", body: "Body" },
  { id: "s", type: "statRow", stats: [{ value: "26", label: "days" }, { value: "$2,125.00", label: "released" }], claimStatus: "illustrative", anim: "countUp" },
  { id: "sl", type: "stepList", steps: [{ title: "A", body: "a" }, { title: "B", body: "b" }] },
  { id: "f", type: "faq", items: [{ q: "Q?", a: "A." }] },
  { id: "d", type: "divider" },
  { id: "ct", type: "cta", title: "Go", label: "Open", href: "/playground" },
  { id: "cs", type: "caseStudy", blueprintCode: "UC_CLASSIC_CAR", totalCents: 1_450_000, before: "b", after: "a", highlight: ["M06"] },
  { id: "mf", type: "moneyFlow", totalCents: 850_000, releasedBps: 2500 },
  { id: "tt", type: "trancheTimeline", totalDays: 60 },
  { id: "api", type: "apiSnippet", method: "POST", path: "/api/mcp", request: "{\"a\":1}", response: "{\"b\":2}" },
  { id: "tb", type: "compareTable", columns: ["A", "B"], rows: [["x", "y"]] },
]);

describe("renderer", () => {
  it("renders every block type in blocks.ts", () => {
    expect(new Set(ONE_OF_EACH.map((b) => b.type))).toEqual(new Set(BLOCK_TYPES));
    const out = html(ONE_OF_EACH);
    for (const t of BLOCK_TYPES) expect(out).toContain(`data-type="${t}"`);
    expect(out).toContain('<h2 id="h-h" class="bl-h2">Section one</h2>');
    expect(out).toContain('<h3 id="h-h3"');
    expect(out).toContain("$2,071.88");
    expect(out).toContain("$6,375.00");
    expect(out).toContain("Handover");
    expect(out).toContain("$14,500.00");
    expect(out).toContain('type="range"');
    expect(out).toContain("Illustrative");
    expect(out).toContain("How PaySettle works");
  });

  it("P10 numbers sources as footnotes by first appearance and links refs to them", () => {
    const blocks = Blocks.parse([
      { id: "a", type: "text", body: "x", sources: [SRC, { title: "Two", url: "https://developer.paypal.com/two" }] },
      { id: "b", type: "text", body: "y", sources: [SRC] },
    ]);
    const s = collectSources(blocks);
    expect(s.map((x) => [x.n, x.blockIds])).toEqual([[1, ["a", "b"]], [2, ["a"]]]);
    const out = html(blocks, true);
    expect(out).toContain('href="#fn-1"');
    expect(out).toContain('id="fn-2"');
    expect(out).toContain('aria-label="Source 2"');
  });

  it("headings feed the contents list", () => {
    expect(headingsOf(ONE_OF_EACH)).toEqual([{ id: "h-h", text: "Section one", level: 2 }, { id: "h-h3", text: "Sub", level: 3 }]);
  });

  it("P10 the sample blocks above pass the claim guard", () => {
    expect(claimProblems(ONE_OF_EACH)).toEqual([]);
  });
});

describe("SEO", () => {
  const post: Post = { id: "p1", slug: "a-b", title: "Title </script><script>alert(1)</script>", dek: "Dek & more", topic: "explainer", publishedAt: "2026-11-08T10:00:00.000Z", readingMinutes: 5, heroSrc: null, heroAlt: null, status: "PUBLISHED", blocks: ONE_OF_EACH, authorName: "Maya", updatedAt: "2026-11-08T11:00:00.000Z", version: 2, seo: null };

  it("JSON-LD cannot close its script element", () => {
    const s = jsonLd(articleJsonLd(post));
    expect(s).not.toContain("</script>");
    expect(s).not.toContain("<");
    expect(JSON.parse(s).headline).toBe(post.title);
  });

  it("Article, BreadcrumbList and FAQPage structured data", () => {
    const a = articleJsonLd(post);
    expect(a["@type"]).toBe("Article");
    expect(a.datePublished).toBe(post.publishedAt);
    expect((breadcrumbJsonLd(post).itemListElement as unknown[]).length).toBe(4);
    const f = faqJsonLd(post.blocks)!;
    expect(f["@type"]).toBe("FAQPage");
    expect(faqJsonLd([{ id: "x", type: "divider" }])).toBeNull();
  });

  it("RSS escapes text and lists each post once", () => {
    expect(xmlEscape(`<a href="x">&'`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&apos;");
    const x = rssXml([post]);
    expect(x).toContain("<title>Title &lt;/script&gt;&lt;script&gt;alert(1)&lt;/script&gt;</title>");
    expect(x.match(/<item>/g)).toHaveLength(1);
    expect(x).toContain("<pubDate>Sun, 08 Nov 2026 10:00:00 GMT</pubDate>");
  });
});
