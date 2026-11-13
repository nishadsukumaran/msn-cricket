BEGIN;
ALTER TABLE clubs ADD COLUMN status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','SUSPENDED'));
ALTER TABLE orders ADD COLUMN last_reconciled_at timestamptz;
CREATE TABLE job_runs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),kind text NOT NULL,status text NOT NULL CHECK(status IN ('RUNNING','SUCCEEDED','FAILED')),summary jsonb NOT NULL DEFAULT '{}',started_at timestamptz NOT NULL DEFAULT now(),finished_at timestamptz);
CREATE TABLE operations_alerts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),club_id uuid REFERENCES clubs,kind text NOT NULL,details jsonb NOT NULL DEFAULT '{}',resolved_at timestamptz,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE support_access(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),club_id uuid NOT NULL REFERENCES clubs,actor_id uuid NOT NULL REFERENCES users,reason text NOT NULL CHECK(length(trim(reason))>=3),expires_at timestamptz NOT NULL,revoked_at timestamptz,created_at timestamptz NOT NULL DEFAULT now());
CREATE FUNCTION active_support(cid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$SELECT EXISTS(SELECT 1 FROM support_access s JOIN platform_operators p ON p.user_id=s.actor_id AND p.enabled WHERE s.club_id=cid AND s.actor_id=nullif(current_setting('app.actor_id',true),'')::uuid AND s.expires_at>now() AND s.revoked_at IS NULL)$$;
CREATE OR REPLACE FUNCTION actor_club(auction uuid) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$SELECT a.club_id FROM auctions a WHERE a.id=auction AND (EXISTS(SELECT 1 FROM memberships m WHERE m.club_id=a.club_id AND m.user_id=nullif(current_setting('app.actor_id',true),'')::uuid) OR active_support(a.club_id))$$;
CREATE FUNCTION platform_overview() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT CASE WHEN is_platform_operator() THEN jsonb_build_object('clubs',coalesce((SELECT jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'status',c.status)) FROM clubs c),'[]'::jsonb),'orders',coalesce((SELECT jsonb_agg(jsonb_build_object('id',o.id,'clubId',o.club_id,'amountMinor',o.amount_minor,'currency',o.currency,'status',o.status,'reference',o.provider_reference)) FROM orders o),'[]'::jsonb),'alerts',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'kind',kind,'details',details,'createdAt',created_at)) FROM operations_alerts WHERE resolved_at IS NULL),'[]'::jsonb),'jobs',coalesce((SELECT jsonb_agg(j) FROM (SELECT id,kind,status,started_at,finished_at,summary FROM job_runs ORDER BY started_at DESC LIMIT 20) j),'[]'::jsonb),'pendingOutbox',(SELECT count(*) FROM outbox WHERE delivered_at IS NULL)) ELSE NULL END
$$;
CREATE FUNCTION club_metrics(cid uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT CASE WHEN EXISTS(SELECT 1 FROM memberships WHERE club_id=cid AND user_id=nullif(current_setting('app.actor_id',true),'')::uuid AND role IN ('OWNER','ADMIN')) THEN jsonb_build_object('acceptedBids',(SELECT count(*) FROM bids WHERE club_id=cid),'pendingOutbox',(SELECT count(*) FROM outbox o JOIN auction_events e ON e.id=o.event_id WHERE e.club_id=cid AND o.delivered_at IS NULL),'oldestOutboxSeconds',(SELECT coalesce(max(extract(epoch from now()-e.occurred_at)),0) FROM outbox o JOIN auction_events e ON e.id=o.event_id WHERE e.club_id=cid AND o.delivered_at IS NULL),'alerts',coalesce((SELECT jsonb_agg(jsonb_build_object('kind',kind,'details',details)) FROM operations_alerts WHERE club_id=cid AND resolved_at IS NULL),'[]'::jsonb)) ELSE NULL END
$$;
REVOKE ALL ON FUNCTION active_support(uuid),platform_overview(),club_metrics(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION active_support(uuid),platform_overview(),club_metrics(uuid) TO msn_runtime;
GRANT SELECT,INSERT,UPDATE ON job_runs,operations_alerts,support_access TO msn_runtime;
GRANT INSERT,UPDATE ON credit_products TO msn_runtime;
GRANT SELECT,UPDATE ON image_objects TO msn_worker;
CREATE POLICY cleanup_images ON image_objects TO msn_worker USING(true);
GRANT SELECT ON player_profiles,registrations,clubs,teams TO msn_worker;
CREATE POLICY worker_profile_refs ON player_profiles TO msn_worker USING(true);
CREATE POLICY worker_registration_refs ON registrations TO msn_worker USING(true);
CREATE POLICY worker_club_refs ON clubs TO msn_worker USING(true);
CREATE POLICY worker_team_refs ON teams TO msn_worker USING(true);
GRANT SELECT,INSERT,UPDATE ON job_runs,operations_alerts TO msn_worker;
GRANT SELECT,DELETE ON sessions TO msn_worker;
COMMIT;
