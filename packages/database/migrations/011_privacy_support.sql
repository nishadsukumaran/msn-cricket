BEGIN;
CREATE FUNCTION erase_own_profile() RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE actor uuid:=nullif(current_setting('app.actor_id',true),'')::uuid;
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'UNAUTHENTICATED';END IF;
 IF EXISTS(SELECT 1 FROM memberships m WHERE m.user_id=actor AND m.role='OWNER' AND NOT EXISTS(SELECT 1 FROM memberships n WHERE n.club_id=m.club_id AND n.role='OWNER' AND n.user_id<>actor)) THEN RAISE EXCEPTION 'OWNERSHIP_TRANSFER_REQUIRED';END IF;
 IF EXISTS(SELECT 1 FROM registrations r JOIN player_profiles p ON p.id=r.player_id JOIN auctions a ON a.id=r.auction_id WHERE p.user_id=actor AND a.status IN ('LOCKED','LIVE','PAUSED')) THEN RAISE EXCEPTION 'ACTIVE_EVENT';END IF;
 UPDATE registrations r SET profile_snapshot=jsonb_build_object('name','Deleted player','role',r.profile_snapshot->>'role','location','Removed','battingStyle','Removed','bowlingStyle','Removed'),status=CASE WHEN a.status IN ('DRAFT','REGISTRATION_OPEN','READY') THEN 'WITHDRAWN' ELSE r.status END FROM player_profiles p,auctions a WHERE r.player_id=p.id AND p.user_id=actor AND a.id=r.auction_id;
 UPDATE player_profiles SET name='Deleted player',phone='Removed',location='Removed',birth_date=NULL,batting_style='Removed',bowling_style='Removed',photo_key=NULL WHERE user_id=actor;
 DELETE FROM sessions WHERE user_id=actor;UPDATE users SET email='deleted+'||actor||'@example.invalid',identity_subject='deleted:'||actor WHERE id=actor;
 INSERT INTO audit_log(club_id,actor_id,action,reason) SELECT DISTINCT club_id,actor,'PROFILE_ANONYMIZED','Account holder requested deletion' FROM memberships WHERE user_id=actor;
 UPDATE team_operators SET active=false WHERE user_id=actor;DELETE FROM memberships WHERE user_id=actor;RETURN true;
END $$;
CREATE FUNCTION authorized_asset(auction uuid,team uuid,hash text) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT CASE WHEN team IS NULL THEN c.branding->>'logoKey' ELSE (SELECT logo_key FROM teams WHERE id=team AND auction_id=a.id) END FROM auctions a JOIN clubs c ON c.id=a.club_id WHERE a.id=auction AND (a.public_visible OR EXISTS(SELECT 1 FROM memberships m WHERE m.club_id=a.club_id AND m.user_id=nullif(current_setting('app.actor_id',true),'')::uuid) OR EXISTS(SELECT 1 FROM display_credentials d WHERE d.auction_id=a.id AND d.token_hash=hash AND d.revoked_at IS NULL AND d.expires_at>now()))
$$;
CREATE OR REPLACE FUNCTION profile_review(registration uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT jsonb_build_object('id',r.id,'name',r.profile_snapshot->>'name','phone',p.phone,'birthDate',p.birth_date,'photoKey',r.profile_snapshot->>'photoKey','duplicateFlags',r.duplicate_flags) FROM registrations r JOIN player_profiles p ON p.id=r.player_id WHERE r.id=registration AND (EXISTS(SELECT 1 FROM memberships m WHERE m.club_id=r.club_id AND m.user_id=nullif(current_setting('app.actor_id',true),'')::uuid AND m.role IN ('OWNER','ADMIN')) OR active_support(r.club_id))
$$;
REVOKE ALL ON FUNCTION erase_own_profile(),authorized_asset(uuid,uuid,text) FROM PUBLIC;GRANT EXECUTE ON FUNCTION erase_own_profile(),authorized_asset(uuid,uuid,text) TO msn_runtime;
COMMIT;
