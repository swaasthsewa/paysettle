-- Immutability guards (P5). Applied after drizzle push: npm run db:guards
CREATE OR REPLACE FUNCTION ps_refuse_change() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'PaySettle: % is append-only', TG_TABLE_NAME; END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_chain_immutable ON audit_chain;
CREATE TRIGGER audit_chain_immutable BEFORE UPDATE OR DELETE ON audit_chain FOR EACH ROW EXECUTE FUNCTION ps_refuse_change();
DROP TRIGGER IF EXISTS revisions_immutable ON revisions;
CREATE TRIGGER revisions_immutable BEFORE UPDATE OR DELETE ON revisions FOR EACH ROW EXECUTE FUNCTION ps_refuse_change();
DROP TRIGGER IF EXISTS verdicts_immutable ON verdicts;
CREATE TRIGGER verdicts_immutable BEFORE DELETE ON verdicts FOR EACH ROW EXECUTE FUNCTION ps_refuse_change();
-- Verdicts (F4.06 F4.08): the signed terms are final once inserted. Only the execution legs move in place (PENDING,
-- IN_FLIGHT, FAILED until DONE; DONE and SKIPPED are final) and the co-signer is set once (src/server/disputes/index.ts).
CREATE OR REPLACE FUNCTION ps_verdict_final() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.dispute_id IS DISTINCT FROM OLD.dispute_id OR NEW.origin IS DISTINCT FROM OLD.origin
     OR NEW.mediator_id IS DISTINCT FROM OLD.mediator_id OR NEW.provider_share_bps IS DISTINCT FROM OLD.provider_share_bps
     OR NEW.refund_cents IS DISTINCT FROM OLD.refund_cents OR NEW.release_cents IS DISTINCT FROM OLD.release_cents
     OR NEW.findings IS DISTINCT FROM OLD.findings OR NEW.root_cause IS DISTINCT FROM OLD.root_cause
     OR NEW.disposition IS DISTINCT FROM OLD.disposition OR NEW.fault IS DISTINCT FROM OLD.fault
     OR NEW.signature IS DISTINCT FROM OLD.signature OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'PaySettle: a verdict''s terms are final once signed';
  END IF;
  IF OLD.cosigner_id IS NOT NULL AND NEW.cosigner_id IS DISTINCT FROM OLD.cosigner_id THEN
    RAISE EXCEPTION 'PaySettle: a verdict''s co-signer is final once recorded';
  END IF;
  IF (OLD.leg1 IN ('DONE', 'SKIPPED') AND NEW.leg1 IS DISTINCT FROM OLD.leg1) OR (OLD.leg2 IN ('DONE', 'SKIPPED') AND NEW.leg2 IS DISTINCT FROM OLD.leg2) THEN
    RAISE EXCEPTION 'PaySettle: a finished verdict leg is final';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS verdicts_final ON verdicts;
CREATE TRIGGER verdicts_final BEFORE UPDATE ON verdicts FOR EACH ROW EXECUTE FUNCTION ps_verdict_final();
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

-- Change orders (F2.13): signatures are append-only; a change order's content (items, document, hash, money plan) is
-- final once proposed. Only the state, the decision fields and the return statuses may move; rows are never deleted.
DROP TRIGGER IF EXISTS change_order_signatures_immutable ON change_order_signatures;
CREATE TRIGGER change_order_signatures_immutable BEFORE UPDATE OR DELETE ON change_order_signatures FOR EACH ROW EXECUTE FUNCTION ps_refuse_change();
CREATE OR REPLACE FUNCTION ps_change_order_final() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'PaySettle: change_orders rows are final'; END IF;
  IF NEW.workspace_id IS DISTINCT FROM OLD.workspace_id OR NEW.no IS DISTINCT FROM OLD.no OR NEW.base_rev_no IS DISTINCT FROM OLD.base_rev_no
     OR NEW.base_hash IS DISTINCT FROM OLD.base_hash OR NEW.rev_no IS DISTINCT FROM OLD.rev_no OR NEW.items IS DISTINCT FROM OLD.items
     OR NEW.canonical IS DISTINCT FROM OLD.canonical OR NEW.hash IS DISTINCT FROM OLD.hash OR NEW.money IS DISTINCT FROM OLD.money
     OR NEW.proposed_by IS DISTINCT FROM OLD.proposed_by OR NEW.total_from_cents IS DISTINCT FROM OLD.total_from_cents
     OR NEW.total_to_cents IS DISTINCT FROM OLD.total_to_cents THEN
    RAISE EXCEPTION 'PaySettle: a change order''s content is final once proposed';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS change_orders_final ON change_orders;
CREATE TRIGGER change_orders_final BEFORE UPDATE OR DELETE ON change_orders FOR EACH ROW EXECUTE FUNCTION ps_change_order_final();
