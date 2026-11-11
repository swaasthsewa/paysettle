-- Immutability guards (P5). Applied after drizzle push: npm run db:guards
CREATE OR REPLACE FUNCTION ps_refuse_change() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'PaySettle: % is append-only', TG_TABLE_NAME; END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_chain_immutable ON audit_chain;
CREATE TRIGGER audit_chain_immutable BEFORE UPDATE OR DELETE ON audit_chain FOR EACH ROW EXECUTE FUNCTION ps_refuse_change();
DROP TRIGGER IF EXISTS revisions_immutable ON revisions;
CREATE TRIGGER revisions_immutable BEFORE UPDATE OR DELETE ON revisions FOR EACH ROW EXECUTE FUNCTION ps_refuse_change();
DROP TRIGGER IF EXISTS verdicts_immutable ON verdicts;
CREATE TRIGGER verdicts_immutable BEFORE DELETE ON verdicts FOR EACH ROW EXECUTE FUNCTION ps_refuse_change();
DROP TRIGGER IF EXISTS ledger_immutable ON ledger_entries;
CREATE TRIGGER ledger_immutable BEFORE UPDATE OR DELETE ON ledger_entries FOR EACH ROW EXECUTE FUNCTION ps_refuse_change();

CREATE OR REPLACE FUNCTION ps_release_final() RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'COMPLETED' THEN RAISE EXCEPTION 'PaySettle: release % is final', OLD.id; END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS releases_final ON releases;
CREATE TRIGGER releases_final BEFORE UPDATE OR DELETE ON releases FOR EACH ROW EXECUTE FUNCTION ps_release_final();

-- four-eyes and system-clause CHECK constraints now live in src/db/schema.ts (survive drizzle push)

-- Blog revisions are append-only (P5)
DROP TRIGGER IF EXISTS blog_revisions_immutable ON blog_revisions;
CREATE TRIGGER blog_revisions_immutable BEFORE UPDATE OR DELETE ON blog_revisions FOR EACH ROW EXECUTE FUNCTION ps_refuse_change();

-- Release adjustments: amounts and times are final once stored (P2/P5); only deduction_status may move
CREATE OR REPLACE FUNCTION ps_adjustment_final() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'release_adjustments rows are final'; END IF;
  IF NEW.base_cents IS DISTINCT FROM OLD.base_cents OR NEW.deduction_cents IS DISTINCT FROM OLD.deduction_cents
     OR NEW.bonus_cents IS DISTINCT FROM OLD.bonus_cents OR NEW.released_cents IS DISTINCT FROM OLD.released_cents
     OR NEW.due_at IS DISTINCT FROM OLD.due_at OR NEW.accepted_at IS DISTINCT FROM OLD.accepted_at THEN
    RAISE EXCEPTION 'release_adjustments amounts and times are final';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS release_adjustments_final ON release_adjustments;
CREATE TRIGGER release_adjustments_final BEFORE UPDATE OR DELETE ON release_adjustments FOR EACH ROW EXECUTE FUNCTION ps_adjustment_final();
