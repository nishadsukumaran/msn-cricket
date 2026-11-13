BEGIN;
CREATE FUNCTION public_club(club_slug text) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT jsonb_build_object('name',c.name,'slug',c.slug,'auctions',coalesce((SELECT jsonb_agg(jsonb_build_object('id',a.id,'name',a.name,'status',a.status,'scheduledAt',a.scheduled_at)) FROM auctions a WHERE a.club_id=c.id AND a.public_visible),'[]'::jsonb)) FROM clubs c WHERE c.slug=club_slug AND EXISTS(SELECT 1 FROM auctions a WHERE a.club_id=c.id AND a.public_visible)
$$;
REVOKE ALL ON FUNCTION public_club(text) FROM PUBLIC;GRANT EXECUTE ON FUNCTION public_club(text) TO msn_runtime;
CREATE OR REPLACE FUNCTION public_auction(auction uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT jsonb_build_object('id',a.id,'name',a.name,'status',a.status,'sequence',a.sequence,'rules',a.rules,'clubName',c.name,'venue',a.venue,'scheduledAt',a.scheduled_at,
 'teams',coalesce((SELECT jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,'code',t.code,'remainingPurse',t.remaining_purse)) FROM teams t WHERE t.auction_id=a.id),'[]'::jsonb),
 'players',coalesce((SELECT jsonb_agg(jsonb_build_object('id',r.id,'name',r.profile_snapshot->>'name','role',r.profile_snapshot->>'role','location',r.profile_snapshot->>'location','base',r.effective_base,'hasPhoto',r.profile_snapshot ? 'photoKey')) FROM registrations r WHERE r.auction_id=a.id AND r.status='APPROVED'),'[]'::jsonb),
 'lots',coalesce((SELECT jsonb_agg(jsonb_build_object('id',l.id,'registrationId',l.registration_id,'status',l.status,'version',l.version,'base',l.base,'amount',b.amount,'leadingTeamId',b.team_id) ORDER BY l.created_at,l.id) FROM lots l LEFT JOIN bids b ON b.id=l.leading_bid_id WHERE l.auction_id=a.id),'[]'::jsonb),
 'allocations',coalesce((SELECT jsonb_agg(jsonb_build_object('id',x.id,'registrationId',x.registration_id,'teamId',x.team_id,'price',x.price)) FROM allocations x WHERE x.auction_id=a.id AND x.status='ACTIVE'),'[]'::jsonb))
 FROM auctions a JOIN clubs c ON c.id=a.club_id WHERE a.id=auction AND a.public_visible
$$;
COMMIT;
