/** Blog studio tests (P6, P10): starter blocks, money input, and server-rendered inspector / list / guard markup. */
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Block, BLOCK_TYPES, claimProblems } from "@/lib/blog/blocks";
import { publishProblems } from "@/server/blog/lint";
import { blankBlock, blockIssues, centsToDollars, cloneBlock, dollarsToCents, issuesAt, snippet, toInput } from "./model";
import { Inspector } from "./Inspector";
import { BlockList } from "./BlockList";
import { GuardPanel } from "./GuardPanel";

describe("studio starter blocks", () => {
  it("every block type has a valid starter block with a snippet", () => {
    for (const t of BLOCK_TYPES) {
      const b = blankBlock(t);
      expect(Block.safeParse(b).success, t).toBe(true);
      expect(typeof snippet(b)).toBe("string");
    }
  });
  it("P10 starter blocks with placeholder words or figures cannot be published untouched", () => {
    const blocks = BLOCK_TYPES.map(blankBlock);
    const flagged = new Set(publishProblems({ title: "T", dek: "D", blocks }).map((p) => p.blockId));
    for (const t of ["tldr", "text", "quote", "callout", "statRow", "stepList", "faq", "caseStudy"] as const) expect(flagged.has(blocks.find((b) => b.type === t)!.id), t).toBe(true);
    expect(claimProblems([blankBlock("statRow")]).length).toBe(1);
  });
  it("duplicate gets a fresh id and a deep copy", () => {
    const a = blankBlock("faq"), c = cloneBlock(a);
    expect(c.id).not.toBe(a.id);
    (c as Extract<Block, { type: "faq" }>).items[0].q = "changed";
    expect((a as Extract<Block, { type: "faq" }>).items[0].q).not.toBe("changed");
  });
  it("field issues map to paths", () => {
    const bad = { ...blankBlock("quote"), text: "" };
    expect(issuesAt(blockIssues(bad), "text").length).toBe(1);
    expect(issuesAt(blockIssues(bad), "by")).toEqual([]);
  });
});

describe("P6 dollars to integer cents", () => {
  it("P6 parses plain amounts without floating point and refuses the rest", () => {
    expect(dollarsToCents("14500")).toBe(1_450_000);
    expect(dollarsToCents("14,500.5")).toBe(1_450_050);
    expect(dollarsToCents("$0.07")).toBe(7);
    expect(dollarsToCents("0.1")).toBe(10);
    expect(dollarsToCents("1.005")).toBeNull();
    expect(dollarsToCents("-5")).toBeNull();
    expect(dollarsToCents("abc")).toBeNull();
    expect(centsToDollars(1_450_005)).toBe("14500.05");
  });
  it("toInput turns empty optional fields into null", () => {
    const i = toInput({ id: "p", slug: "s", title: "T", dek: "", topic: "trust", heroSrc: "", heroAlt: "", seoTitle: "", seoDescription: "", blocks: [blankBlock("divider")] });
    expect(i).toMatchObject({ heroSrc: null, heroAlt: null, seo: null });
  });
});

describe("studio markup is labelled", () => {
  it("the inspector renders a labelled form for every block type", () => {
    for (const t of BLOCK_TYPES) {
      const html = renderToStaticMarkup(createElement(Inspector, { block: blankBlock(t), index: 0, total: 1, onChange: () => {}, onDuplicate: () => {}, onRemove: () => {} }));
      expect(html, t).toContain("Animation");
      expect(html, t).toContain("What kind of claim is this?");
      const inputs = (html.match(/<(input|textarea|select)\b[^>]*\bid="([^"]+)"/g) ?? []).map((m) => m.match(/id="([^"]+)"/)![1]);
      for (const id of inputs) expect(html, `${t}: label for ${id}`).toContain(`for="${id}"`);
    }
  });
  it("invalid fields are marked aria-invalid with a described error", () => {
    const html = renderToStaticMarkup(createElement(Inspector, { block: { ...blankBlock("heading"), text: "" } as Block, index: 0, total: 1, onChange: () => {}, onDuplicate: () => {}, onRemove: () => {} }));
    expect(html).toMatch(/aria-invalid="true"[^>]*aria-describedby="[^"]*-err"|aria-describedby="[^"]*-err"[^>]*aria-invalid="true"/);
  });
  it("block list buttons name the block they act on; guard panel counts problems", () => {
    const blocks = [blankBlock("heading"), blankBlock("statRow")];
    const list = renderToStaticMarkup(createElement(BlockList, { blocks, selectedId: blocks[0].id, flagged: new Map([[blocks[1].id, 1]]), onSelect: () => {}, onMove: () => {}, onDuplicate: () => {}, onRemove: () => {}, onAdd: () => {} }));
    expect(list).toContain('aria-label="Move Numbers 2 up"');
    expect(list).toContain('aria-current="true"');
    const problems = publishProblems({ title: "T", dek: "D", blocks });
    const guard = renderToStaticMarkup(createElement(GuardPanel, { problems, invalid: [], serverProblems: null, blocks, onShow: () => {} }));
    expect(guard).toContain(`${problems.length} to fix before publishing`);
  });
});
