-- Draft schema: requires PostgreSQL execution/integration verification before deployment.
BEGIN;
CREATE TABLE users (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), identity_subject text NOT NULL UNIQUE,
 email text NOT NULL, language text NOT NULL DEFAULT 'en' CHECK(language IN ('en','ml'))
);
CREATE TABLE clubs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), slug text NOT NULL UNIQUE,
 name text NOT NULL, branding jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE memberships (
 club_id uuid NOT NULL REFERENCES clubs, user_id uuid NOT NULL REFERENCES users,
 role text NOT NULL CHECK(role IN ('OWNER','ADMIN','AUCTIONEER','MEMBER')), PRIMARY KEY(club_id,user_id,role)
);
CREATE TABLE auctions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), club_id uuid NOT NULL REFERENCES clubs,
 name text NOT NULL, venue text, scheduled_at timestamptz, registration_deadline timestamptz,
 status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','REGISTRATION_OPEN','READY','LOCKED','LIVE','PAUSED','COMPLETED','ARCHIVED','CANCELLED')),
 rules jsonb NOT NULL, version bigint NOT NULL DEFAULT 1 CHECK(version>0),
 sequence bigint NOT NULL DEFAULT 0 CHECK(sequence>=0), rehearsal boolean NOT NULL DEFAULT false,
 public_visible boolean NOT NULL DEFAULT false, locked_at timestamptz, started_at timestamptz,
 UNIQUE(club_id,id)
);
CREATE TABLE player_profiles (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users,
 name text NOT NULL, birth_date date, phone text NOT NULL, location text NOT NULL,
 role text NOT NULL CHECK(role IN ('BATTER','BOWLER','ALL_ROUNDER','KEEPER')),
 batting_style text NOT NULL, bowling_style text NOT NULL, photo_key text, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE registrations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),club_id uuid NOT NULL, auction_id uuid NOT NULL,
 player_id uuid NOT NULL REFERENCES player_profiles, profile_snapshot jsonb NOT NULL,
 requested_base bigint CHECK(requested_base BETWEEN 0 AND 9007199254740991),
 effective_base bigint CHECK(effective_base BETWEEN 1 AND 9007199254740991),
 status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('DRAFT','PENDING','APPROVED','REJECTED','CHANGES_REQUESTED','WITHDRAWN')),
 display_consent_at timestamptz NOT NULL,reviewed_by uuid REFERENCES users,review_reason text,
 CHECK(status<>'APPROVED' OR effective_base IS NOT NULL),
 FOREIGN KEY(club_id,auction_id) REFERENCES auctions(club_id,id),
 UNIQUE(auction_id,player_id), UNIQUE(club_id,auction_id,id)
);
CREATE TABLE teams (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),club_id uuid NOT NULL,auction_id uuid NOT NULL,
 code text NOT NULL,name text NOT NULL,logo_key text,color text,
 initial_purse bigint NOT NULL CHECK(initial_purse BETWEEN 1 AND 9007199254740991),
 remaining_purse bigint NOT NULL CHECK(remaining_purse>=0 AND remaining_purse<=initial_purse),
 FOREIGN KEY(club_id,auction_id) REFERENCES auctions(club_id,id), UNIQUE(auction_id,code),UNIQUE(club_id,auction_id,id)
);
CREATE TABLE manager_applications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),club_id uuid NOT NULL,auction_id uuid NOT NULL,
 user_id uuid NOT NULL REFERENCES users,team_id uuid,
 status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','APPROVED','REJECTED','CHANGES_REQUESTED')),
 reviewed_by uuid REFERENCES users,reason text,
 FOREIGN KEY(club_id,auction_id) REFERENCES auctions(club_id,id),
 FOREIGN KEY(club_id,auction_id,team_id) REFERENCES teams(club_id,auction_id,id),UNIQUE(auction_id,user_id)
);
CREATE TABLE team_operators (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),club_id uuid NOT NULL,auction_id uuid NOT NULL,
 team_id uuid NOT NULL,user_id uuid NOT NULL REFERENCES users,active boolean NOT NULL DEFAULT true,
 FOREIGN KEY(club_id,auction_id,team_id) REFERENCES teams(club_id,auction_id,id)
);
CREATE UNIQUE INDEX one_active_team_operator ON team_operators(team_id) WHERE active;
CREATE UNIQUE INDEX one_active_operator_team_per_auction ON team_operators(auction_id,user_id) WHERE active;
CREATE TABLE lots (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),club_id uuid NOT NULL,auction_id uuid NOT NULL,
 registration_id uuid NOT NULL,attempt integer NOT NULL CHECK(attempt>0),
 status text NOT NULL CHECK(status IN ('PREVIEW','OPEN','PAUSED','CLOSED','SOLD','UNSOLD')),
 base bigint NOT NULL CHECK(base BETWEEN 1 AND 9007199254740991),version bigint NOT NULL DEFAULT 1 CHECK(version>0),
 leading_bid_id uuid,
 FOREIGN KEY(club_id,auction_id,registration_id) REFERENCES registrations(club_id,auction_id,id),
 UNIQUE(registration_id,attempt),UNIQUE(club_id,auction_id,id)
);
CREATE UNIQUE INDEX one_unsettled_lot ON lots(auction_id) WHERE status IN ('PREVIEW','OPEN','PAUSED','CLOSED');
CREATE TABLE commands (
 actor_id uuid NOT NULL REFERENCES users,command_id uuid NOT NULL,club_id uuid NOT NULL,auction_id uuid NOT NULL,
 request_hash text NOT NULL,outcome jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(club_id,auction_id) REFERENCES auctions(club_id,id),PRIMARY KEY(actor_id,command_id)
);
CREATE TABLE bids (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),club_id uuid NOT NULL,auction_id uuid NOT NULL,
 lot_id uuid NOT NULL,team_id uuid NOT NULL,actor_id uuid NOT NULL REFERENCES users,command_id uuid NOT NULL,
 amount bigint NOT NULL CHECK(amount BETWEEN 1 AND 9007199254740991),event_sequence bigint NOT NULL CHECK(event_sequence>0),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(club_id,auction_id,lot_id) REFERENCES lots(club_id,auction_id,id),
 FOREIGN KEY(club_id,auction_id,team_id) REFERENCES teams(club_id,auction_id,id),
 FOREIGN KEY(actor_id,command_id) REFERENCES commands(actor_id,command_id) DEFERRABLE INITIALLY DEFERRED,
 UNIQUE(actor_id,command_id),UNIQUE(auction_id,event_sequence),UNIQUE(club_id,auction_id,lot_id,id)
);
ALTER TABLE lots ADD CONSTRAINT leading_bid_same_lot FOREIGN KEY(club_id,auction_id,id,leading_bid_id) REFERENCES bids(club_id,auction_id,lot_id,id) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE allocations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),club_id uuid NOT NULL,auction_id uuid NOT NULL,
 lot_id uuid NOT NULL,registration_id uuid NOT NULL,team_id uuid NOT NULL,
 price bigint NOT NULL CHECK(price BETWEEN 1 AND 9007199254740991),status text NOT NULL CHECK(status IN ('ACTIVE','REVERSED')),
 FOREIGN KEY(club_id,auction_id,lot_id) REFERENCES lots(club_id,auction_id,id),
 FOREIGN KEY(club_id,auction_id,registration_id) REFERENCES registrations(club_id,auction_id,id),
 FOREIGN KEY(club_id,auction_id,team_id) REFERENCES teams(club_id,auction_id,id),UNIQUE(lot_id),UNIQUE(club_id,auction_id,team_id,id)
);
CREATE UNIQUE INDEX one_active_allocation ON allocations(registration_id) WHERE status='ACTIVE';
CREATE TABLE purse_ledger (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),club_id uuid NOT NULL,auction_id uuid NOT NULL,team_id uuid NOT NULL,
 allocation_id uuid NOT NULL,delta bigint NOT NULL CHECK(delta<>0 AND delta BETWEEN -9007199254740991 AND 9007199254740991),
 reason text NOT NULL CHECK(length(trim(reason))>0),reversal_of uuid UNIQUE,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(club_id,auction_id,team_id,allocation_id) REFERENCES allocations(club_id,auction_id,team_id,id),
 UNIQUE(club_id,auction_id,team_id,id),
 FOREIGN KEY(club_id,auction_id,team_id,reversal_of) REFERENCES purse_ledger(club_id,auction_id,team_id,id)
);
CREATE UNIQUE INDEX one_initial_debit_per_allocation ON purse_ledger(allocation_id) WHERE reversal_of IS NULL;
CREATE TABLE auction_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),club_id uuid NOT NULL,auction_id uuid NOT NULL,
 sequence bigint NOT NULL CHECK(sequence>0),type text NOT NULL,payload jsonb NOT NULL,
 occurred_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(club_id,auction_id) REFERENCES auctions(club_id,id),UNIQUE(auction_id,sequence)
);
CREATE TABLE outbox (
 event_id uuid PRIMARY KEY REFERENCES auction_events(id),attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0),
 delivered_at timestamptz,retry_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE credit_products (
 sku text PRIMARY KEY,units integer NOT NULL CHECK(units>0),amount_minor bigint NOT NULL CHECK(amount_minor>=0),
 currency text NOT NULL CHECK(currency ~ '^[A-Z]{3}$'),validity_days integer CHECK(validity_days>0),active boolean NOT NULL DEFAULT true
);
CREATE TABLE orders (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),club_id uuid NOT NULL REFERENCES clubs,
 product_snapshot jsonb NOT NULL,amount_minor bigint NOT NULL CHECK(amount_minor>=0),currency text NOT NULL,
 provider text NOT NULL,provider_reference text, status text NOT NULL CHECK(status IN ('PENDING','PAID','FAILED','REFUNDED','BILLING_EXCEPTION')),
 UNIQUE(provider,provider_reference),UNIQUE(club_id,id)
);
CREATE TABLE provider_events (
 provider text NOT NULL,external_id text NOT NULL,verified_at timestamptz NOT NULL,
 processed_at timestamptz,payload_hash text NOT NULL,PRIMARY KEY(provider,external_id)
);
CREATE TABLE credit_grants (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),club_id uuid NOT NULL REFERENCES clubs,
 units integer NOT NULL CHECK(units>0),source text NOT NULL CHECK(source IN ('MANUAL','PAYMENT')),
 order_id uuid UNIQUE,granted_by uuid REFERENCES users,reason text NOT NULL CHECK(length(trim(reason))>0),
 expires_at timestamptz,revoked_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(club_id,order_id) REFERENCES orders(club_id,id),UNIQUE(club_id,id),
 CHECK((source='PAYMENT' AND order_id IS NOT NULL) OR (source='MANUAL' AND granted_by IS NOT NULL))
);
CREATE TABLE credit_redemptions (
 club_id uuid NOT NULL,auction_id uuid NOT NULL UNIQUE,grant_id uuid NOT NULL,
 unit_number integer NOT NULL CHECK(unit_number>0),redeemed_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(club_id,auction_id) REFERENCES auctions(club_id,id),
 FOREIGN KEY(club_id,grant_id) REFERENCES credit_grants(club_id,id),PRIMARY KEY(grant_id,unit_number)
);
CREATE FUNCTION check_credit_redemption() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE g credit_grants%ROWTYPE;
BEGIN
 SELECT * INTO g FROM credit_grants WHERE id=NEW.grant_id AND club_id=NEW.club_id FOR UPDATE;
 IF NOT FOUND OR g.revoked_at IS NOT NULL OR (g.expires_at IS NOT NULL AND g.expires_at<=now()) OR NEW.unit_number>g.units THEN
 RAISE EXCEPTION 'CREDIT_UNAVAILABLE'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER valid_redemption BEFORE INSERT ON credit_redemptions FOR EACH ROW EXECUTE FUNCTION check_credit_redemption();
CREATE TABLE audit_log (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),club_id uuid NOT NULL REFERENCES clubs,actor_id uuid NOT NULL REFERENCES users,
 action text NOT NULL,resource_id uuid,reason text,redacted_change jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX registrations_review ON registrations(club_id,auction_id,status);
CREATE INDEX auction_lookup ON auctions(club_id,status);
CREATE INDEX outbox_pending ON outbox(retry_at) WHERE delivered_at IS NULL;
CREATE INDEX audit_club_time ON audit_log(club_id,created_at);
-- Defense in depth: transaction-local tenant context; runtime role must not own tables or have BYPASSRLS.
-- Runtime grants, user-level profile policies and public redacted projections are separate deployment migrations.
DO $$ DECLARE tbl text; BEGIN
 FOREACH tbl IN ARRAY ARRAY['clubs','memberships','auctions','registrations','teams','manager_applications','team_operators','lots','commands','bids','allocations','purse_ledger','auction_events','orders','credit_grants','credit_redemptions','audit_log'] LOOP
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',tbl);
 IF tbl='clubs' THEN
 EXECUTE format('CREATE POLICY tenant_scope ON %I USING (id = nullif(current_setting(''app.club_id'',true),'''')::uuid) WITH CHECK (id = nullif(current_setting(''app.club_id'',true),'''')::uuid)',tbl);
 ELSE
 EXECUTE format('CREATE POLICY tenant_scope ON %I USING (club_id = nullif(current_setting(''app.club_id'',true),'''')::uuid) WITH CHECK (club_id = nullif(current_setting(''app.club_id'',true),'''')::uuid)',tbl);
 END IF;
 END LOOP;
END $$;
COMMIT;
