import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateRules,
  resolveEffectiveBase,
  computeMaxBid,
  validateNextBid,
  transitionLot,
  settle,
  reverseSettlement,
} from "../src/auction.ts";
const rules = {
  purse: 10000,
  minSquad: 5,
  maxSquad: 11,
  minimumBase: 100,
  defaultBase: 300,
  increment: 100,
  reserveEnabled: true,
};
const team = { id: "team-a", remainingPurse: 10000, squadSize: 2 };
const lot = {
  id: "lot",
  status: "OPEN",
  version: 1,
  base: 500,
  leadingTeamId: null,
  amount: null,
};
const error = (fn, code) => assert.throws(fn, (e) => e.code === code);
test("rejects impossible or noninteger rules", () => {
  assert.equal(validateRules(rules), rules);
  for (const value of [NaN, Infinity, 1.5, -1, 0, Number.MAX_SAFE_INTEGER + 1])
    error(() => validateRules({ ...rules, increment: value }), "INVALID_RULES");
  error(() => validateRules({ ...rules, purse: 400 }), "INVALID_RULES");
  error(() => validateRules({ ...rules, minSquad: 12 }), "INVALID_RULES");
});
test("optional base resolves through explicit override then requested then default", () => {
  assert.equal(resolveEffectiveBase(undefined, undefined, rules), 300);
  assert.equal(resolveEffectiveBase(500, undefined, rules), 500);
  assert.equal(resolveEffectiveBase(500, 700, rules), 700);
  error(() => resolveEffectiveBase(0, undefined, rules), "INVALID_BASE");
});
test("reserve leaves enough minimum points for remaining minimum squad", () => {
  assert.equal(computeMaxBid(team, rules), 9800);
  assert.equal(computeMaxBid({ ...team, squadSize: 4 }, rules), 10000);
  assert.equal(computeMaxBid(team, { ...rules, reserveEnabled: false }), 10000);
});
test("only exact first/next bid with fresh version can be accepted", () => {
  assert.equal(validateNextBid(lot, team, rules, 1, 500), 500);
  error(() => validateNextBid(lot, team, rules, 1, 600), "INVALID_AMOUNT");
  error(() => validateNextBid(lot, team, rules, 0, 500), "STALE_VERSION");
  const l = { ...lot, version: 2, leadingTeamId: "team-b", amount: 500 };
  assert.equal(validateNextBid(l, team, rules, 2, 600), 600);
  error(() => validateNextBid(l, team, rules, 2, 700), "INVALID_AMOUNT");
});
test("rejects own leader, full squad, reserve overspend and paused bidding", () => {
  error(
    () =>
      validateNextBid(
        { ...lot, leadingTeamId: team.id, amount: 500 },
        team,
        rules,
        1,
        600,
      ),
    "ALREADY_LEADING",
  );
  error(
    () => validateNextBid(lot, { ...team, squadSize: 11 }, rules, 1, 500),
    "SQUAD_FULL",
  );
  error(
    () => validateNextBid(lot, { ...team, remainingPurse: 600 }, rules, 1, 500),
    "INSUFFICIENT_POINTS",
  );
  error(
    () => validateNextBid({ ...lot, status: "PAUSED" }, team, rules, 1, 500),
    "LOT_NOT_OPEN",
  );
});
test("safe integer checks reject malformed amounts and team state", () => {
  for (const v of [NaN, Infinity, 500.5, "500"])
    error(() => validateNextBid(lot, team, rules, 1, v), "INVALID_AMOUNT");
  error(
    () => computeMaxBid({ ...team, remainingPurse: -1 }, rules),
    "INVALID_TEAM",
  );
});
test("closing then selling is mandatory; unsold needs no leading bid", () => {
  assert.equal(transitionLot(lot, "CLOSE").status, "CLOSED");
  error(() => transitionLot(lot, "SELL"), "INVALID_TRANSITION");
  error(
    () =>
      transitionLot(
        { ...lot, status: "CLOSED", amount: 500, leadingTeamId: team.id },
        "UNSOLD",
      ),
    "HAS_BIDS",
  );
  assert.equal(
    transitionLot({ ...lot, status: "CLOSED" }, "UNSOLD").status,
    "UNSOLD",
  );
});
test("pause/resume and reasoned reopen preserve leading bid and advance version", () => {
  let l = { ...lot, amount: 500, leadingTeamId: team.id };
  l = transitionLot(l, "PAUSE");
  assert.equal(l.amount, 500);
  l = transitionLot(l, "RESUME");
  l = transitionLot(l, "CLOSE");
  error(() => transitionLot(l, "REOPEN"), "REASON_REQUIRED");
  l = transitionLot(l, "REOPEN", "Auctioneer correction");
  assert.equal(l.status, "OPEN");
  assert.equal(l.version, 5);
});
test("settlement returns immutable allocation effect and correct balance", () => {
  const l = { ...lot, status: "CLOSED", amount: 500, leadingTeamId: team.id };
  const result = settle(l, team, rules);
  assert.equal(result.team.remainingPurse, 9500);
  assert.equal(result.team.squadSize, 3);
  assert.equal(result.ledgerDelta, -500);
  assert.equal(result.lot.status, "SOLD");
  assert.equal(team.remainingPurse, 10000);
  error(() => settle(l, { ...team, id: "other" }, rules), "WINNER_MISMATCH");
  error(() => settle(result.lot, result.team, rules), "INVALID_TRANSITION");
});
test("settlement fails atomically if winner no longer eligible", () => {
  error(
    () =>
      settle(
        { ...lot, status: "CLOSED", amount: 9900, leadingTeamId: team.id },
        team,
        rules,
      ),
    "INSUFFICIENT_POINTS",
  );
});
test("reversal restores points only for active allocation with reason", () => {
  const a = { price: 500, teamId: team.id, status: "ACTIVE" };
  const r = reverseSettlement(
    a,
    { ...team, remainingPurse: 9500, squadSize: 3 },
    rules,
    "Wrong player selected",
  );
  assert.equal(r.team.remainingPurse, 10000);
  assert.equal(r.team.squadSize, 2);
  assert.equal(r.ledgerDelta, 500);
  error(
    () =>
      reverseSettlement(
        { ...a, status: "REVERSED" },
        team,
        rules,
        "Correction",
      ),
    "ALREADY_REVERSED",
  );
  error(() => reverseSettlement(a, team, rules, ""), "REASON_REQUIRED");
});
test("settlement rejects invalid effective base and unsafe winning increments", () => {
  error(
    () =>
      settle(
        {
          ...lot,
          status: "CLOSED",
          base: 50,
          amount: 50,
          leadingTeamId: team.id,
        },
        team,
        rules,
      ),
    "INVALID_BASE",
  );
  error(
    () =>
      settle(
        { ...lot, status: "CLOSED", amount: 550, leadingTeamId: team.id },
        team,
        rules,
      ),
    "INVALID_AMOUNT",
  );
});
