BEGIN;
ALTER TABLE auctions ADD COLUMN team_capacity integer NOT NULL DEFAULT 20 CHECK(team_capacity BETWEEN 2 AND 20);
ALTER TABLE auctions ADD COLUMN selection_mode text NOT NULL DEFAULT 'MANUAL' CHECK(selection_mode IN ('MANUAL','RANDOM','BOTH'));
ALTER TABLE registrations ADD COLUMN duplicate_flags jsonb NOT NULL DEFAULT '[]';
CREATE TABLE display_credentials(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),club_id uuid NOT NULL,auction_id uuid NOT NULL,token_hash text NOT NULL UNIQUE,expires_at timestamptz NOT NULL,revoked_at timestamptz,created_by uuid NOT NULL REFERENCES users,created_at timestamptz NOT NULL DEFAULT now(),FOREIGN KEY(club_id,auction_id) REFERENCES auctions(club_id,id));
ALTER TABLE display_credentials ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON display_credentials USING(club_id=nullif(current_setting('app.club_id',true),'')::uuid) WITH CHECK(club_id=nullif(current_setting('app.club_id',true),'')::uuid);
GRANT SELECT,INSERT,UPDATE ON display_credentials TO msn_runtime;
CREATE FUNCTION lookup_staff_user(email_address text) RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE uid uuid;cnt int;
BEGIN
 SELECT count(*),(array_agg(id))[1] INTO cnt,uid FROM users WHERE lower(email)=lower(email_address);
 IF cnt<>1 THEN RAISE EXCEPTION 'USER_NOT_UNIQUE';END IF;RETURN uid;
END $$;
CREATE FUNCTION club_staff(cid uuid) RETURNS TABLE(user_id uuid,email text,role text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT m.user_id,u.email,m.role FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.club_id=cid AND EXISTS(SELECT 1 FROM memberships a WHERE a.club_id=cid AND a.user_id=nullif(current_setting('app.actor_id',true),'')::uuid AND a.role IN ('OWNER','ADMIN')) ORDER BY u.email,m.role
$$;
CREATE FUNCTION redacted_auction(auction uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT jsonb_build_object('id',a.id,'name',a.name,'status',a.status,'sequence',a.sequence,'rules',a.rules,'clubName',c.name,'venue',a.venue,'scheduledAt',a.scheduled_at,
 'teams',coalesce((SELECT jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,'code',t.code,'remainingPurse',t.remaining_purse)) FROM teams t WHERE t.auction_id=a.id),'[]'::jsonb),
 'players',coalesce((SELECT jsonb_agg(jsonb_build_object('id',r.id,'name',r.profile_snapshot->>'name','role',r.profile_snapshot->>'role','location',r.profile_snapshot->>'location','base',r.effective_base,'hasPhoto',r.profile_snapshot ? 'photoKey')) FROM registrations r WHERE r.auction_id=a.id AND r.status='APPROVED'),'[]'::jsonb),
 'lots',coalesce((SELECT jsonb_agg(jsonb_build_object('id',l.id,'registrationId',l.registration_id,'status',l.status,'version',l.version,'base',l.base,'amount',b.amount,'leadingTeamId',b.team_id) ORDER BY l.created_at,l.id) FROM lots l LEFT JOIN bids b ON b.id=l.leading_bid_id WHERE l.auction_id=a.id),'[]'::jsonb),
 'allocations',coalesce((SELECT jsonb_agg(jsonb_build_object('id',x.id,'registrationId',x.registration_id,'teamId',x.team_id,'price',x.price)) FROM allocations x WHERE x.auction_id=a.id AND x.status='ACTIVE'),'[]'::jsonb))
 FROM auctions a JOIN clubs c ON c.id=a.club_id WHERE a.id=auction
$$;
CREATE OR REPLACE FUNCTION public_auction(auction uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$SELECT redacted_auction(id) FROM auctions WHERE id=auction AND public_visible$$;
CREATE FUNCTION display_snapshot(hash text) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$SELECT redacted_auction(auction_id) FROM display_credentials WHERE token_hash=hash AND revoked_at IS NULL AND expires_at>now()$$;
CREATE FUNCTION accessible_photo(registration uuid,hash text) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT r.profile_snapshot->>'photoKey' FROM registrations r JOIN auctions a ON a.id=r.auction_id WHERE r.id=registration AND (
 (r.status='APPROVED' AND (a.public_visible OR EXISTS(SELECT 1 FROM display_credentials d WHERE d.auction_id=a.id AND d.token_hash=hash AND d.revoked_at IS NULL AND d.expires_at>now())))
 OR EXISTS(SELECT 1 FROM player_profiles p WHERE p.id=r.player_id AND p.user_id=nullif(current_setting('app.actor_id',true),'')::uuid)
 OR EXISTS(SELECT 1 FROM memberships m WHERE m.club_id=a.club_id AND m.user_id=nullif(current_setting('app.actor_id',true),'')::uuid AND (r.status='APPROVED' OR m.role IN ('OWNER','ADMIN'))))
$$;
REVOKE ALL ON FUNCTION lookup_staff_user(text),club_staff(uuid),redacted_auction(uuid),display_snapshot(text),accessible_photo(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION lookup_staff_user(text),club_staff(uuid),display_snapshot(text),accessible_photo(uuid,text) TO msn_runtime;
CREATE TABLE image_objects(key text PRIMARY KEY,owner_id uuid NOT NULL REFERENCES users,created_at timestamptz NOT NULL DEFAULT now(),deleted_at timestamptz);
ALTER TABLE image_objects ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_image ON image_objects USING(owner_id=nullif(current_setting('app.actor_id',true),'')::uuid) WITH CHECK(owner_id=nullif(current_setting('app.actor_id',true),'')::uuid);
GRANT SELECT,INSERT ON image_objects TO msn_runtime;
CREATE FUNCTION profile_review(registration uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT jsonb_build_object('id',r.id,'name',p.name,'phone',p.phone,'birthDate',p.birth_date,'photoKey',r.profile_snapshot->>'photoKey','duplicateFlags',r.duplicate_flags) FROM registrations r JOIN player_profiles p ON p.id=r.player_id WHERE r.id=registration AND EXISTS(SELECT 1 FROM memberships m WHERE m.club_id=r.club_id AND m.user_id=nullif(current_setting('app.actor_id',true),'')::uuid AND m.role IN ('OWNER','ADMIN'))
$$;
CREATE FUNCTION registration_duplicates(auction uuid,phone_number text,person_name text,actor uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('registrationId',r.id,'samePhone',regexp_replace(p.phone,'[^0-9]','','g')=regexp_replace(phone_number,'[^0-9]','','g'),'sameName',lower(r.profile_snapshot->>'name')=lower(person_name))),'[]'::jsonb) FROM registrations r JOIN player_profiles p ON p.id=r.player_id WHERE r.auction_id=auction AND p.user_id<>actor AND (regexp_replace(p.phone,'[^0-9]','','g')=regexp_replace(phone_number,'[^0-9]','','g') OR lower(r.profile_snapshot->>'name')=lower(person_name))
$$;
REVOKE ALL ON FUNCTION profile_review(uuid),registration_duplicates(uuid,text,text,uuid) FROM PUBLIC;GRANT EXECUTE ON FUNCTION profile_review(uuid),registration_duplicates(uuid,text,text,uuid) TO msn_runtime;
COMMIT;
