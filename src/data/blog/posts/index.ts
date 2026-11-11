/* The nine sample blog posts. scripts/seed-blog.ts inserts or updates them by slug and publishes them
 * through the blog service, so the claim guard and the copy lint run on this content too (P10).
 * The seed spreads publication dates three days apart with the FIRST post here as the newest, so post 1 leads the blog. */
import type { SeedPost } from "../build";
import { POST_DAY_28 } from "./01-day-28";
import { POST_APPEND_PRUNE } from "./02-append-and-prune";
import { POST_ENGINE_SWAP } from "./03-engine-swap";
import { POST_BLIND_BIDS } from "./04-blind-bids";
import { POST_DEADLINES } from "./05-deadlines";
import { POST_AI_GUARDRAILS } from "./06-ai-guardrails";
import { POST_AGENT_BUYS } from "./07-agent-buys";
import { POST_RECONCILE } from "./08-reconcile";
import { POST_RED_TEAM } from "./09-red-team";

export type { SeedPost } from "../build";

export const POSTS: SeedPost[] = [
  POST_DAY_28,
  POST_APPEND_PRUNE,
  POST_ENGINE_SWAP,
  POST_BLIND_BIDS,
  POST_DEADLINES,
  POST_AI_GUARDRAILS,
  POST_AGENT_BUYS,
  POST_RECONCILE,
  POST_RED_TEAM,
];
