BEGIN;
ALTER TABLE sessions ADD COLUMN mfa_verified boolean NOT NULL DEFAULT false;
CREATE FUNCTION session_context(hash text) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT jsonb_build_object('actor',s.user_id,'mfa',s.mfa_verified,'privileged',EXISTS(SELECT 1 FROM memberships m WHERE m.user_id=s.user_id AND m.role IN ('OWNER','ADMIN')) OR EXISTS(SELECT 1 FROM platform_operators p WHERE p.user_id=s.user_id AND p.enabled)) FROM sessions s WHERE s.token_hash=hash AND s.expires_at>now()
$$;
CREATE FUNCTION save_verified_session(hash text,uid uuid,mfa boolean) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$BEGIN
 IF uid IS DISTINCT FROM nullif(current_setting('app.actor_id',true),'')::uuid OR uid IS NULL THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 INSERT INTO sessions(token_hash,user_id,expires_at,mfa_verified) VALUES(hash,uid,now()+interval '8 hours',mfa);
END $$;
REVOKE ALL ON FUNCTION session_context(text),save_verified_session(text,uuid,boolean) FROM PUBLIC;GRANT EXECUTE ON FUNCTION session_context(text),save_verified_session(text,uuid,boolean) TO msn_runtime;
COMMIT;
