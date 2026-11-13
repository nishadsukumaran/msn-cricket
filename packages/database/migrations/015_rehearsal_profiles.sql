BEGIN;
ALTER TABLE player_profiles ADD COLUMN rehearsal_only boolean NOT NULL DEFAULT false;
COMMIT;
