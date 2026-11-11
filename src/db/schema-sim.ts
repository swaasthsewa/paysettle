/**
 * F5.06 judge playground, P9: every workspace the playground creates is recorded here, so the real
 * demo personas' screens (overviews, contract lists, receipts, payouts, mediator queue, analytics, recon, radar) can leave
 * simulated contracts out. Additive only; the playground screen still shows its own sims. See src/lib/sim.ts.
 */
import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { workspaces } from "./schema";

export const simWorkspaces = pgTable("sim_workspaces", {
  workspaceId: text("workspace_id").primaryKey().references(() => workspaces.id, { onDelete: "cascade" }),
  simId: text("sim_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("sim_workspaces_sim").on(t.simId)]);
