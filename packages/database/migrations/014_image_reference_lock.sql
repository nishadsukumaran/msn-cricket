BEGIN;
CREATE FUNCTION lock_owned_image(image_key text,owner uuid) RETURNS SETOF text LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT key FROM image_objects WHERE key=image_key AND owner_id=owner AND owner=nullif(current_setting('app.actor_id',true),'')::uuid AND deleted_at IS NULL FOR SHARE
$$;
REVOKE ALL ON FUNCTION lock_owned_image(text,uuid) FROM PUBLIC;GRANT EXECUTE ON FUNCTION lock_owned_image(text,uuid) TO msn_runtime;
COMMIT;
