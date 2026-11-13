BEGIN;
CREATE FUNCTION platform_grants() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$SELECT CASE WHEN is_platform_operator() THEN coalesce((SELECT jsonb_agg(jsonb_build_object('id',g.id,'clubId',g.club_id,'clubName',c.name,'units',g.units,'used',(SELECT count(*) FROM credit_redemptions r WHERE r.grant_id=g.id),'reason',g.reason,'revoked',g.revoked_at IS NOT NULL,'expiresAt',g.expires_at)) FROM credit_grants g JOIN clubs c ON c.id=g.club_id),'[]'::jsonb) ELSE NULL END$$;
REVOKE ALL ON FUNCTION platform_grants() FROM PUBLIC;GRANT EXECUTE ON FUNCTION platform_grants() TO msn_runtime;
COMMIT;
