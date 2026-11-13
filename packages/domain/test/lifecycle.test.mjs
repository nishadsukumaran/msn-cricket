import { test } from "node:test";
import assert from "node:assert/strict";
import {
  transitionAuction,
  readinessIssues,
  assertReversalSafe,
} from "../src/lifecycle.ts";
const rules = {
  purse: 10000,
  minSquad: 2,
  maxSquad: 5,
  minimumBase: 100,
  defaultBase: 300,
  increment: 100,
  reserveEnabled: true,
};
const ready = {
  rules,
  teams: [
    { approved: true, operator: true },
    { approved: true, operator: true },
  ],
  approvedPlayers: 4,
  pendingReviews: 0,
};
test("readiness names missing players, teams, operators and pending reviews", () => {
  assert.deepEqual(readinessIssues(ready), []);
  assert.deepEqual(
    readinessIssues({
      ...ready,
      teams: [{ approved: true, operator: false }],
      approvedPlayers: 0,
      pendingReviews: 1,
    }),
    [
      "TEAMS_REQUIRED",
      "OPERATORS_REQUIRED",
      "PLAYERS_REQUIRED",
      "REVIEWS_PENDING",
    ],
  );
  assert.ok(
    readinessIssues({ ...ready, approvedPlayers: 3 }).includes(
      "INSUFFICIENT_POOL",
    ),
  );
});
test("auction lifecycle locks before start and forbids mutation of completed event", () => {
  assert.equal(transitionAuction("DRAFT", "PUBLISH"), "REGISTRATION_OPEN");
  assert.equal(transitionAuction("REGISTRATION_OPEN", "LOCK"), "LOCKED");
  assert.equal(transitionAuction("LOCKED", "START"), "LIVE");
  assert.equal(transitionAuction("LIVE", "PAUSE"), "PAUSED");
  assert.equal(transitionAuction("PAUSED", "RESUME"), "LIVE");
  assert.throws(
    () => transitionAuction("DRAFT", "START"),
    /INVALID_TRANSITION/,
  );
  assert.throws(
    () => transitionAuction("COMPLETED", "RESUME"),
    /INVALID_TRANSITION/,
  );
});
test("historical reversal requires paused auction and rejects later dependent sales", () => {
  assert.doesNotThrow(() => assertReversalSafe("PAUSED", false));
  assert.throws(() => assertReversalSafe("LIVE", false), /PAUSE_REQUIRED/);
  assert.throws(() => assertReversalSafe("PAUSED", true), /REVERSAL_CONFLICT/);
});
