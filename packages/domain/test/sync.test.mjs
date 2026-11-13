import { test } from "node:test";
import assert from "node:assert/strict";
import { applyEvent, loadSnapshot, disconnect, canBid } from "../src/sync.ts";
const e = (sequence) => ({
  eventId: "event-" + sequence,
  auctionId: "a",
  sequence,
  lotVersion: sequence,
  type: "BID_ACCEPTED",
  occurredAt: "2026-11-12T12:00:00Z",
  payload: {},
});
test("events are not accepted until an authoritative snapshot arrives", () => {
  assert.equal(canBid(disconnect()), false);
  const s = applyEvent(disconnect(), e(1));
  assert.equal(s.status, "RESYNC_REQUIRED");
});
test("duplicates are ignored, gaps require resync, different auctions rejected", () => {
  const s = loadSnapshot("a", 2);
  assert.equal(applyEvent(s, e(2)), s);
  assert.equal(applyEvent(s, e(3)).sequence, 3);
  assert.equal(applyEvent(s, e(4)).status, "RESYNC_REQUIRED");
  assert.equal(
    applyEvent(s, { ...e(3), auctionId: "b" }).status,
    "RESYNC_REQUIRED",
  );
});
test("disconnect disables bidding and only a new snapshot re-enables sync", () => {
  const s = loadSnapshot("a", 2);
  assert.equal(canBid(s), true);
  const d = disconnect(s);
  assert.equal(canBid(d), false);
  assert.equal(applyEvent(d, e(3)).status, "RESYNC_REQUIRED");
  assert.equal(canBid(loadSnapshot("a", 3)), true);
});
