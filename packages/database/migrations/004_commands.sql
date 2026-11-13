BEGIN;
CREATE OR REPLACE FUNCTION save_session(hash text,uid uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF uid IS DISTINCT FROM nullif(current_setting('app.actor_id',true),'')::uuid OR uid IS NULL THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(hash,uid,now()+interval '8 hours');
END $$;
CREATE FUNCTION command_outcome(actor uuid,command uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$SELECT outcome FROM commands WHERE actor_id=actor AND command_id=command$$;
REVOKE ALL ON FUNCTION command_outcome(uuid,uuid) FROM PUBLIC;GRANT EXECUTE ON FUNCTION command_outcome(uuid,uuid) TO msn_runtime;
COMMIT;
