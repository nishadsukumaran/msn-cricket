BEGIN;
CREATE FUNCTION join_registration(auction uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE cid uuid;uid uuid:=nullif(current_setting('app.actor_id',true),'')::uuid;
BEGIN
 IF uid IS NULL THEN RAISE EXCEPTION 'UNAUTHENTICATED';END IF;
 SELECT club_id INTO cid FROM auctions WHERE id=auction AND public_visible AND status='REGISTRATION_OPEN' AND (registration_deadline IS NULL OR registration_deadline>now());
 IF cid IS NULL THEN RAISE EXCEPTION 'REGISTRATION_CLOSED';END IF;
 INSERT INTO memberships(club_id,user_id,role) VALUES(cid,uid,'MEMBER') ON CONFLICT DO NOTHING;RETURN cid;
END $$;
CREATE FUNCTION my_auctions() RETURNS TABLE(id uuid,name text,status text,club_name text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT a.id,a.name,a.status,c.name FROM auctions a JOIN clubs c ON c.id=a.club_id WHERE EXISTS(SELECT 1 FROM memberships m WHERE m.club_id=a.club_id AND m.user_id=nullif(current_setting('app.actor_id',true),'')::uuid) ORDER BY a.scheduled_at NULLS LAST
$$;
CREATE FUNCTION save_session(hash text,uid uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF uid<>nullif(current_setting('app.actor_id',true),'')::uuid OR uid IS NULL THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(hash,uid,now()+interval '8 hours');
END $$;
CREATE FUNCTION delete_session(hash text) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$DELETE FROM sessions WHERE token_hash=hash$$;
REVOKE ALL ON FUNCTION join_registration(uuid),my_auctions(),save_session(text,uuid),delete_session(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION join_registration(uuid),my_auctions(),save_session(text,uuid),delete_session(text) TO msn_runtime;
CREATE TABLE manager_invites(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),club_id uuid NOT NULL,auction_id uuid NOT NULL,team_id uuid NOT NULL,email text NOT NULL,token_hash text NOT NULL UNIQUE,expires_at timestamptz NOT NULL,accepted_by uuid REFERENCES users,FOREIGN KEY(club_id,auction_id,team_id) REFERENCES teams(club_id,auction_id,id));
ALTER TABLE manager_invites ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON manager_invites USING(club_id=nullif(current_setting('app.club_id',true),'')::uuid) WITH CHECK(club_id=nullif(current_setting('app.club_id',true),'')::uuid);
GRANT SELECT,INSERT,UPDATE ON manager_invites TO msn_runtime;
CREATE FUNCTION invite_scope(hash text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE cid uuid;uid uuid:=nullif(current_setting('app.actor_id',true),'')::uuid;
BEGIN
 SELECT i.club_id INTO cid FROM manager_invites i JOIN users u ON lower(u.email)=lower(i.email) AND u.id=uid WHERE i.token_hash=hash AND i.expires_at>now() AND i.accepted_by IS NULL;
 IF cid IS NULL THEN RAISE EXCEPTION 'INVALID_INVITE';END IF;
 INSERT INTO memberships VALUES(cid,uid,'MEMBER') ON CONFLICT DO NOTHING;RETURN cid;
END $$;
REVOKE ALL ON FUNCTION invite_scope(text) FROM PUBLIC;GRANT EXECUTE ON FUNCTION invite_scope(text) TO msn_runtime;
COMMIT;
