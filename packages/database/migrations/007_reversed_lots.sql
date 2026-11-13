BEGIN;
ALTER TABLE lots DROP CONSTRAINT lots_status_check;
ALTER TABLE lots ADD CONSTRAINT lots_status_check CHECK(status IN ('PREVIEW','OPEN','PAUSED','CLOSED','SOLD','UNSOLD','REVERSED'));
UPDATE lots l SET status='REVERSED',version=version+1 WHERE status='SOLD' AND EXISTS(SELECT 1 FROM allocations a WHERE a.lot_id=l.id AND a.status='REVERSED');
COMMIT;
