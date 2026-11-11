/**
 * P5 — blog revisions are append-only. Same pattern as src/db/sql/guards.sql (ps_refuse_change on revisions,
 * audit_chain, ledger_entries): a BEFORE UPDATE OR DELETE trigger that raises. drizzle-kit push does not create triggers,
 * so this is applied by scripts/seed-blog.ts and by the blog tests, and the same two statements are requested for
 * src/db/sql/guards.sql so `npm run db:guards` covers it too. Idempotent.
 */
import { sql } from "drizzle-orm";
import type { Db } from "@/db/client";

export const BLOG_GUARDS_SQL = `
CREATE OR REPLACE FUNCTION ps_refuse_change() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'PaySettle: % is append-only', TG_TABLE_NAME; END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS blog_revisions_immutable ON blog_revisions;
CREATE TRIGGER blog_revisions_immutable BEFORE UPDATE OR DELETE ON blog_revisions FOR EACH ROW EXECUTE FUNCTION ps_refuse_change();
`;

/** Apply the blog trigger (serialised with an advisory lock so parallel seeds/tests do not race on DDL). */
export async function ensureBlogGuards(dbx: Db): Promise<void> {
  await dbx.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(4243)`);
    const r = await tx.execute(sql`SELECT 1 FROM pg_trigger WHERE tgname = 'blog_revisions_immutable' AND NOT tgisinternal`);
    if (r.rows.length > 0) return;
    await tx.execute(sql.raw(BLOG_GUARDS_SQL));
  });
}
