/**
 * Blog service tests: P5 revision trail, P10 claim guard + copy lint, RBAC, AI-off draft path.
 * Runs against paysettle_test (shared with other agents): every row created here has a unique run tag and the posts are
 * removed in afterAll. Revisions stay (append-only by design) under post ids nobody else uses.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { auditChain } from "@/db/schema";
import { blogPosts, blogRevisions } from "@/db/schema-blog";
import { Blocks, type Block } from "@/lib/blog/blocks";
import { configFromEnv } from "@/lib/ai/config";
import { AiGateway, memoryStore } from "@/lib/ai/gateway";
import { fakeLlm } from "@/lib/ai/testing/fake-llm";
import { setGateway } from "@/server/ai/store";
import { DomainError, type Actor } from "@/server/types";
import { createPost, deletePost, draftWithAi, getById, getPublishedBySlug, listAll, listPublished, listRelated, listRevisions, setStatus, updatePost } from "./index";
import { ClaimGuardError, getStudioPost } from "./service";
import { ensureBlogGuards } from "./guards";
import { COPY_LINT_BANNED, publishProblems } from "./lint";
import { nthSlug, slugify } from "./slug";
import { diffBlocks } from "./diff";
import { draftBlocks, outlineDraft } from "./ai";
import { GET } from "@/app/api/blog/route";

const RUN = `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const mkt: Actor = { id: "u_mkt", role: "marketing", name: "Maya Lopez" };
const admin: Actor = { id: "u_admin", role: "admin" };
const client: Actor = { id: "u_priya", role: "client" };
const judge: Actor = { id: "u_judge", role: "judge" };
const created: string[] = [];

const text = (id: string, body: string, extra: Partial<Block> = {}): Block => ({ id, type: "text", body, ...extra } as Block);
const good = (): Block[] => [
  { id: "h1", type: "heading", level: 2, text: "Why holds expire" },
  text("t1", "A PayPal authorization does not last forever, so long jobs need a plan for the hold window."),
  { id: "s1", type: "statRow", stats: [{ value: "26 days", label: "Rail A tranche cap" }, { value: "25 days", label: "Rail B tranche cap" }], claimStatus: "product" },
];
const input = (title: string, blocks: Block[] = good(), extra: Record<string, unknown> = {}) => ({ title: `${title} ${RUN}`, dek: "How PaySettle splits long jobs into hold windows.", topic: "explainer" as const, blocks, ...extra });
async function make(title: string, blocks?: Block[], extra?: Record<string, unknown>) { const id = await createPost(mkt, input(title, blocks, extra)); created.push(id); return id; }
async function code(p: Promise<unknown>): Promise<string> { try { await p; return "OK"; } catch (e) { return e instanceof DomainError ? e.code : `THROW:${(e as Error).message}`; } }

beforeAll(async () => { await ensureBlogGuards(db); });
afterEach(() => setGateway(null));
afterAll(async () => { if (created.length) await db.delete(blogPosts).where(inArray(blogPosts.id, created)); });

describe("block validation on every write", () => {
  it("a valid post is stored as DRAFT version 1 with reading time, revision 1 and an audit row", async () => {
    const id = await make("Valid post");
    const p = await getById(mkt, id);
    expect(p).toMatchObject({ status: "DRAFT", version: 1, topic: "explainer", authorName: "Maya Lopez", readingMinutes: 1 });
    expect(Blocks.safeParse(p!.blocks).success).toBe(true);
    expect((await listRevisions(mkt, id)).map((r) => r.version)).toEqual([1]);
    const [a] = await db.select().from(auditChain).where(and(eq(auditChain.target, id), eq(auditChain.action, "blog.create")));
    expect(a?.actorId).toBe("u_mkt");
    expect(JSON.stringify(a?.detail)).not.toContain("hold window");
  });

  it("invalid blocks, duplicate ids, unknown blueprints and secret-looking API samples are refused (BAD_INPUT)", async () => {
    expect(await code(createPost(mkt, input("Empty text", [text("x", "")])))).toBe("BAD_INPUT");
    expect(await code(createPost(mkt, input("No blocks", [])))).toBe("BAD_INPUT");
    expect(await code(createPost(mkt, input("Bad type", [{ id: "z", type: "video", src: "x" } as unknown as Block])))).toBe("BAD_INPUT");
    expect(await code(createPost(mkt, input("External link", [{ id: "c", type: "cta", title: "Go", label: "Go", href: "https://evil.example" } as Block])))).toBe("BAD_INPUT");
    expect(await code(createPost(mkt, input("Dup ids", [text("a", "One."), text("a", "Two.")])))).toBe("BAD_INPUT");
    expect(await code(createPost(mkt, input("Ghost blueprint", [{ id: "cs", type: "caseStudy", blueprintCode: "UC_NOPE", totalCents: 100, before: "b", after: "a" } as Block])))).toBe("BAD_INPUT");
    expect(await code(createPost(mkt, input("Secret", [{ id: "api", type: "apiSnippet", method: "POST", path: "/v1/oauth2/token", request: "Authorization: Bearer A21AAabcdefghijklmnopqrstuvwxyz" } as Block])))).toBe("BAD_INPUT");
    expect(await code(createPost(mkt, input("Hero without alt", good(), { heroSrc: "/blog/hero.svg" })))).toBe("BAD_INPUT");
    const ok = await code(createPost(mkt, input("Case study real", [{ id: "cs", type: "caseStudy", blueprintCode: "UC_CLASSIC_CAR", totalCents: 1_450_000, before: "Paid half up front.", after: "Paid per checked milestone.", claimStatus: "illustrative" } as Block])).then((id) => created.push(id)));
    expect(ok).toBe("OK");
  });

  it("BlogInputError names the block and field", async () => {
    try { await createPost(mkt, input("Path", [text("a", "ok"), { id: "q", type: "quote", text: "", by: "Ops" } as Block])); expect.unreachable(); }
    catch (e) { expect((e as DomainError).message).toMatch(/Block 2 › text/); }
  });
});

describe("slugs", () => {
  it("slugify and nthSlug are readable and bounded", () => {
    expect(slugify("Why escrow breaks at day 28 — and how tranches fix it")).toBe("why-escrow-breaks-at-day-28-and-how-tranches-fix-it");
    expect(slugify("Café & crème’s $5,000 plan")).toBe("cafe-and-cremes-5-000-plan");
    expect(slugify("!!!")).toBe("post");
    expect(slugify("x".repeat(200)).length).toBeLessThanOrEqual(80);
    expect(nthSlug("abc", 0)).toBe("abc");
    expect(nthSlug("abc", 1)).toBe("abc-2");
    expect(nthSlug("abc", 47, 1_800_000_000_000)).toBe(`abc-${(1_800_000_000_000).toString(36)}`);
    expect(nthSlug("a".repeat(80), 5).length).toBeLessThanOrEqual(80);
  });

  it("same title gets a unique slug, also under concurrent creates; an explicit taken slug is refused", async () => {
    const ids = await Promise.all([0, 1, 2].map(() => make("Same title")));
    const slugs = (await Promise.all(ids.map((id) => getById(mkt, id)))).map((p) => p!.slug);
    expect(new Set(slugs).size).toBe(3);
    expect(slugs.sort()[0]).toBe(slugify(`Same title ${RUN}`));
    expect(await code(createPost(mkt, input("Other", good(), { slug: slugs[0] })))).toBe("SLUG_TAKEN");
    const other = await make("Another");
    const p = (await getById(mkt, other))!;
    expect(await code(updatePost(mkt, other, { ...input("Another"), slug: slugs[1] }, p.version))).toBe("SLUG_TAKEN");
    expect(await code(updatePost(mkt, other, { ...input("Another"), slug: "Not A Slug!" }, p.version))).toBe("BAD_INPUT");
  });
});

describe("optimistic versions and the revision trail (P5)", () => {
  it("update bumps the version and appends a revision; a stale version is refused; a no-op writes nothing", async () => {
    const id = await make("Versioned");
    const v2 = await updatePost(mkt, id, input("Versioned", [...good(), text("t2", "A second paragraph.")]), 1);
    expect(v2.version).toBe(2);
    expect(await code(updatePost(admin, id, input("Versioned", good()), 1))).toBe("STALE");
    const same = await updatePost(mkt, id, input("Versioned", [...good(), text("t2", "A second paragraph.")]), 2);
    expect(same.version).toBe(2);
    const v3 = await updatePost(admin, id, input("Versioned edited", good()), 2);
    expect(v3.version).toBe(3);
    const revs = await listRevisions(mkt, id);
    expect(revs.map((r) => r.version)).toEqual([3, 2, 1]);
    expect(revs[0].title).toBe(`Versioned edited ${RUN}`);
    expect(revs[1].blocks.map((b) => b.id)).toContain("t2");
    expect(diffBlocks(revs[1], revs[0])).toMatchObject({ removed: ["t2"], added: [], changed: [], titleChanged: true });
  });

  it("P5 revision rows cannot be updated or deleted (trigger blog_revisions_immutable)", async () => {
    const id = await make("Immutable");
    await expect(db.execute(sql`UPDATE blog_revisions SET title = 'tampered' WHERE post_id = ${id}`)).rejects.toThrow(/append-only|blog_revisions/);
    await expect(db.execute(sql`DELETE FROM blog_revisions WHERE post_id = ${id}`)).rejects.toThrow(/append-only|blog_revisions/);
    const [r] = await db.select().from(blogRevisions).where(eq(blogRevisions.postId, id));
    expect(r.title).toBe(`Immutable ${RUN}`);
  });
});

describe("P10 claim guard at publish", () => {
  it("P10 an unsourced statRow or $/% figure blocks publish with CLAIM_GUARD listing the blocks", async () => {
    const id = await make("Unsourced", [text("t1", "Escrow fees run at 3% on most platforms."), { id: "s1", type: "statRow", stats: [{ value: "48 h", label: "review" }, { value: "72 h", label: "rule" }] }]);
    try { await setStatus(mkt, id, "PUBLISHED"); expect.unreachable(); }
    catch (e) {
      expect(e).toBeInstanceOf(ClaimGuardError);
      expect((e as ClaimGuardError).code).toBe("CLAIM_GUARD");
      expect((e as ClaimGuardError).problems.map((p) => p.blockId)).toEqual(["t1", "s1"]);
    }
    expect((await getById(mkt, id))!.status).toBe("DRAFT");
  });

  it("P10 illustrative / product labels or sources let the same figures publish; publishedAt is set once", async () => {
    const id = await make("Labelled", [
      text("t1", "On a $14,500 job, the first tranche holds $7,250.", { claimStatus: "illustrative" }),
      text("t2", "PayPal honours an authorization for up to 29 days, about 100% of a month.", { sources: [{ title: "PayPal: authorize and capture", url: "https://developer.paypal.com/docs/checkout/standard/customize/authorization/" }] }),
      { id: "s1", type: "statRow", stats: [{ value: "250 bps", label: "fee on releases" }, { value: "48 h", label: "review" }], claimStatus: "product" },
    ]);
    await setStatus(mkt, id, "PUBLISHED");
    const p = (await getById(mkt, id))!;
    expect(p.status).toBe("PUBLISHED");
    expect(p.publishedAt).toBeTruthy();
    expect((await getPublishedBySlug(p.slug))?.id).toBe(id);
    await setStatus(mkt, id, "DRAFT");
    expect(await getPublishedBySlug(p.slug)).toBeNull();
    await setStatus(mkt, id, "PUBLISHED");
    expect((await getById(mkt, id))!.publishedAt).toBe(p.publishedAt);
  });

  it("P10 copy-lint phrases, research without sources and outline placeholders block publish", async () => {
    const lint = await make("Lint", [{ id: "h", type: "heading", level: 2, text: "A risk-free way to pay" }]);
    expect(await code(setStatus(mkt, lint, "PUBLISHED"))).toBe("CLAIM_GUARD");
    const research = await make("Research", [text("r", "Most disputes are about scope.", { claimStatus: "research" })]);
    expect(await code(setStatus(mkt, research, "PUBLISHED"))).toBe("CLAIM_GUARD");
    const titleLint = await make("Guaranteed payment for every job", [text("r", "Plain words.")]);
    expect(await code(setStatus(mkt, titleLint, "PUBLISHED"))).toBe("CLAIM_GUARD");
    expect(publishProblems({ title: "x", dek: "y", blocks: outlineDraft({ topic: "trust", title: "Hi", angle: "A brief that says things." }).blocks }).length).toBeGreaterThan(0);
  });

  it("P10 editing a published post re-runs the guard; a clean edit is saved", async () => {
    const id = await make("Published edit");
    await setStatus(mkt, id, "PUBLISHED");
    expect(await code(updatePost(mkt, id, input("Published edit", [text("t", "Save 40% on fees.")]), 1))).toBe("CLAIM_GUARD");
    expect((await getById(mkt, id))!.version).toBe(1);
    expect((await updatePost(mkt, id, input("Published edit", [text("t", "Plain words, no figures.")]), 1)).version).toBe(2);
  });

  it("COPY_LINT_BANNED mirrors tools/copy-lint.mjs", () => {
    const src = readFileSync("tools/copy-lint.mjs", "utf8");
    const list = src.match(/const BANNED = \[([\s\S]*?)\];/)?.[1] ?? "";
    const fromScript = [...list.matchAll(/\/((?:\\\/|[^/])+)\/([a-z]*)/g)].map((m) => `/${m[1]}/${m[2]}`);
    expect(fromScript.length).toBeGreaterThan(0);
    expect(COPY_LINT_BANNED.map(String)).toEqual(fromScript);
  });
});

describe("RBAC and status rules", () => {
  it("a client or judge cannot write, read the studio or publish (FORBIDDEN)", async () => {
    expect(await code(createPost(client, input("Client")))).toBe("FORBIDDEN");
    expect(await code(createPost(judge, input("Judge")))).toBe("FORBIDDEN");
    expect(await code(listAll(client))).toBe("FORBIDDEN");
    const id = await make("RBAC");
    expect(await code(getById(client, id))).toBe("FORBIDDEN");
    expect(await code(updatePost(client, id, input("RBAC x"), 1))).toBe("FORBIDDEN");
    expect(await code(setStatus(client, id, "PUBLISHED"))).toBe("FORBIDDEN");
    expect(await code(deletePost(client, id))).toBe("FORBIDDEN");
    expect(await code(draftWithAi(client, { topic: "trust", title: "Nope", angle: "Should never be created." }))).toBe("FORBIDDEN");
    expect((await listAll(admin)).some((p) => p.id === id)).toBe(true);
  });

  it("status moves follow the table: archived posts go back to draft before publishing", async () => {
    const id = await make("Moves");
    await setStatus(mkt, id, "REVIEW");
    await setStatus(mkt, id, "ARCHIVED");
    expect(await code(setStatus(mkt, id, "PUBLISHED"))).toBe("STATE");
    await setStatus(mkt, id, "DRAFT");
    await setStatus(mkt, id, "PUBLISHED");
    const actions = await db.select({ d: auditChain.detail }).from(auditChain).where(and(eq(auditChain.target, id), eq(auditChain.action, "blog.status")));
    expect(actions.map((a) => (a.d as { to: string }).to)).toEqual(["REVIEW", "ARCHIVED", "DRAFT", "PUBLISHED"]);
  });

  it("only drafts can be deleted; the revision trail stays", async () => {
    const pub = await make("Delete published");
    await setStatus(mkt, pub, "PUBLISHED");
    expect(await code(deletePost(mkt, pub))).toBe("NOT_DRAFT");
    const draft = await make("Delete draft");
    await updatePost(mkt, draft, input("Delete draft", [text("x", "Edited.")]), 1);
    await deletePost(mkt, draft);
    expect(await getById(mkt, draft)).toBeNull();
    expect((await db.select().from(blogRevisions).where(eq(blogRevisions.postId, draft))).length).toBe(2);
    expect(await code(deletePost(mkt, draft))).toBe("NOT_FOUND");
  });
});

describe("public reads", () => {
  it("listPublished filters by status and topic; listRelated fills from other topics and skips the post", async () => {
    const a = await make("Pub explainer");
    const b = await make("Pub trust", good(), { topic: "trust" });
    const c = await make("Still draft");
    await setStatus(mkt, a, "PUBLISHED");
    await setStatus(mkt, b, "PUBLISHED");
    const all = (await listPublished()).map((p) => p.id);
    expect(all).toEqual(expect.arrayContaining([a, b]));
    expect(all).not.toContain(c);
    const trust = await listPublished({ topic: "trust" });
    expect(trust.every((p) => p.topic === "trust")).toBe(true);
    expect(trust.map((p) => p.id)).toContain(b);
    expect(await listPublished({ topic: "nope" as never })).toEqual([]);
    const rel = await listRelated({ id: b, topic: "trust" }, 50);
    expect(rel.map((p) => p.id)).not.toContain(b);
    expect(rel.map((p) => p.id)).toContain(a);
    expect(await getPublishedBySlug("../etc/passwd")).toBeNull();
  });

  it("F2.12 GET /api/blog returns published summaries without author ids; unknown topic → 400", async () => {
    const id = await make("Api post", good(), { topic: "finance" });
    await setStatus(mkt, id, "PUBLISHED");
    const res = await GET(new Request("http://localhost/api/blog?topic=finance"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { posts: { slug: string; url: string }[] };
    const mine = body.posts.find((p) => p.slug === slugify(`Api post ${RUN}`));
    expect(mine?.url).toBe(`/blog/${mine?.slug}`);
    expect(JSON.stringify(body)).not.toContain("u_mkt");
    expect((await GET(new Request("http://localhost/api/blog?topic=<script>"))).status).toBe(400);
  });
});

describe("P3 AI drafting", () => {
  const brief = { topic: "explainer" as const, title: `AI brief ${RUN}`, angle: "Explain why long jobs need tranches. Use the day 26 cap." };

  it("AI off (no key): a rule-based outline is saved as DRAFT, valid, labelled illustrative, and cannot be published as is", async () => {
    setGateway(new AiGateway(configFromEnv({ AI_API_KEY: "" }), { store: memoryStore() }));
    const r = await draftWithAi(mkt, brief);
    created.push(r.id);
    expect(r.usedAi).toBe(false);
    const p = (await getStudioPost(mkt, r.id))!;
    expect(p).toMatchObject({ status: "DRAFT", origin: "OUTLINE", version: 1 });
    expect(Blocks.safeParse(p.blocks).success).toBe(true);
    expect(p.blocks[0].type).toBe("tldr");
    expect(p.blocks.filter((b) => b.type === "heading").length).toBe(4);
    expect(p.blocks.filter((b) => b.type === "text").every((b) => b.claimStatus === "illustrative")).toBe(true);
    expect(await code(setStatus(mkt, r.id, "PUBLISHED"))).toBe("CLAIM_GUARD");
  });

  it("AI switched off by the admin flag never calls the model", async () => {
    const llm = fakeLlm();
    const gw = new AiGateway(configFromEnv({ AI_API_KEY: "k", AI_BASE_URL: "https://llm.test" }), { fetch: llm.fetch, store: memoryStore() });
    const out = await draftBlocks(gw, brief, false);
    expect(out.usedAi).toBe(false);
    expect(llm.requests.length).toBe(0);
  });

  it("AI on: the answer is parsed with Blocks, sanitised and saved as DRAFT (origin AI); invalid output falls back", async () => {
    const answer = { dek: "Why holds need tranches.", blocks: [
      { id: "a", type: "tldr", title: "In short", items: ["Holds expire, tranches keep money held."] },
      { id: "a", type: "text", body: "Duplicate id gets renamed." },
      { id: "c", type: "caseStudy", blueprintCode: "UC_INVENTED", totalCents: 100, before: "x", after: "y" },
      { id: "d", type: "cta", title: "Try it", label: "Open", href: "/playground" },
    ] };
    const llm = fakeLlm().reply(answer);
    setGateway(new AiGateway(configFromEnv({ AI_API_KEY: "k", AI_BASE_URL: "https://llm.test" }), { fetch: llm.fetch, store: memoryStore() }));
    const out = await draftBlocks((await import("@/server/ai/store")).gateway(), brief, true);
    expect(out.usedAi).toBe(true);
    expect(out.draft.blocks.map((b) => b.type)).toEqual(["tldr", "text", "cta"]);
    expect(new Set(out.draft.blocks.map((b) => b.id)).size).toBe(3);
    expect(llm.sentText(0)).toContain("untrusted");

    const bad = fakeLlm().reply({ dek: "x", blocks: [{ type: "video" }] }).reply("not json");
    setGateway(new AiGateway(configFromEnv({ AI_API_KEY: "k", AI_BASE_URL: "https://llm.test" }), { fetch: bad.fetch, store: memoryStore() }));
    const r = await draftWithAi(mkt, { ...brief, title: `AI fallback ${RUN}` });
    created.push(r.id);
    expect(r.usedAi).toBe(false);
    expect((await getStudioPost(mkt, r.id))!.origin).toBe("OUTLINE");
  });

  it("brief is validated", async () => {
    expect(await code(draftWithAi(mkt, { topic: "explainer", title: "x", angle: "short" }))).toBe("BAD_INPUT");
  });
});

describe("block diff", () => {
  it("added, removed, changed and moved ids", () => {
    const a = [text("1", "one"), text("2", "two"), text("3", "three")];
    const b = [text("3", "three"), text("1", "one!"), text("4", "four")];
    expect(diffBlocks({ title: "T", blocks: a }, { title: "T", blocks: b })).toEqual({ added: ["4"], removed: ["2"], changed: ["1"], moved: ["3"], titleChanged: false, dekChanged: false });
    expect(diffBlocks(null, { blocks: a }).added).toEqual(["1", "2", "3"]);
  });
});
