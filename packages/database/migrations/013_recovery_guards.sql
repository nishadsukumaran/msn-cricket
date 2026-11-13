BEGIN;
ALTER TABLE image_objects ADD COLUMN purged_at timestamptz;
CREATE OR REPLACE FUNCTION reconciliation_orders() RETURNS TABLE(id uuid,club_id uuid,provider_reference text,amount_minor bigint,currency text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT o.id,o.club_id,o.provider_reference,o.amount_minor,o.currency FROM orders o WHERE is_platform_operator() AND o.status IN ('PENDING','PAID','BILLING_EXCEPTION') AND o.provider_reference IS NOT NULL AND (o.last_reconciled_at IS NULL OR o.last_reconciled_at<now()-interval '1 minute') ORDER BY o.last_reconciled_at ASC NULLS FIRST,o.id LIMIT 100
$$;
COMMIT;
