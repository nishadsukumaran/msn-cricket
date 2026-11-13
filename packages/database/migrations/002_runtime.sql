BEGIN;
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='msn_runtime') THEN CREATE ROLE msn_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='msn_worker') THEN CREATE ROLE msn_worker NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS; END IF; END $$;
ALTER TABLE allocations ADD COLUMN created_at timestamptz NOT NULL DEFAULT clock_timestamp();
CREATE TABLE sessions (token_hash text PRIMARY KEY,user_id uuid NOT NULL REFERENCES users,expires_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE rehearsal_fixtures (id uuid PRIMARY KEY,fixture jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE FUNCTION actor_club(auction uuid) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT a.club_id FROM auctions a WHERE a.id=auction AND EXISTS(SELECT 1 FROM memberships m WHERE m.club_id=a.club_id AND m.user_id=nullif(current_setting('app.actor_id',true),'')::uuid)
$$;
CREATE FUNCTION session_actor(hash text) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$SELECT user_id FROM sessions WHERE token_hash=hash AND expires_at>now()$$;
CREATE FUNCTION identity_user(subject text,verified_email text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE uid uuid;
BEGIN
 INSERT INTO users(identity_subject,email) VALUES(subject,verified_email) ON CONFLICT(identity_subject) DO UPDATE SET email=excluded.email RETURNING id INTO uid;RETURN uid;
END $$;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_user ON users USING(id=nullif(current_setting('app.actor_id',true),'')::uuid);
ALTER TABLE player_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_profile ON player_profiles USING(user_id=nullif(current_setting('app.actor_id',true),'')::uuid) WITH CHECK(user_id=nullif(current_setting('app.actor_id',true),'')::uuid);
CREATE FUNCTION public_auction(auction uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT jsonb_build_object('id',a.id,'name',a.name,'status',a.status,'sequence',a.sequence,'rules',a.rules,'clubName',c.name,
 'teams',coalesce((SELECT jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,'code',t.code,'remainingPurse',t.remaining_purse)) FROM teams t WHERE t.auction_id=a.id),'[]'::jsonb),
 'players',coalesce((SELECT jsonb_agg(jsonb_build_object('id',r.id,'name',r.profile_snapshot->>'name','role',r.profile_snapshot->>'role','location',r.profile_snapshot->>'location','base',r.effective_base)) FROM registrations r WHERE r.auction_id=a.id AND r.status='APPROVED'),'[]'::jsonb),
 'lots',coalesce((SELECT jsonb_agg(jsonb_build_object('id',l.id,'registrationId',l.registration_id,'status',l.status,'version',l.version,'base',l.base,'amount',b.amount,'leadingTeamId',b.team_id)) FROM lots l LEFT JOIN bids b ON b.id=l.leading_bid_id WHERE l.auction_id=a.id),'[]'::jsonb),
 'allocations',coalesce((SELECT jsonb_agg(jsonb_build_object('id',x.id,'registrationId',x.registration_id,'teamId',x.team_id,'price',x.price)) FROM allocations x WHERE x.auction_id=a.id AND x.status='ACTIVE'),'[]'::jsonb))
 FROM auctions a JOIN clubs c ON c.id=a.club_id WHERE a.id=auction AND a.public_visible
$$;
GRANT USAGE ON SCHEMA public TO msn_runtime,msn_worker;
GRANT SELECT,INSERT,UPDATE ON users,clubs,memberships,auctions,player_profiles,registrations,teams,manager_applications,team_operators,lots,commands,bids,allocations,purse_ledger,auction_events,credit_grants,credit_redemptions,audit_log TO msn_runtime;
GRANT INSERT ON outbox TO msn_runtime;
GRANT SELECT,UPDATE ON outbox TO msn_worker;
GRANT SELECT ON auction_events TO msn_worker;
CREATE POLICY delivery_events ON auction_events TO msn_worker USING(true);
REVOKE ALL ON FUNCTION actor_club(uuid),session_actor(text),identity_user(text,text),public_auction(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION actor_club(uuid),session_actor(text),identity_user(text,text),public_auction(uuid) TO msn_runtime;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
COMMIT;
