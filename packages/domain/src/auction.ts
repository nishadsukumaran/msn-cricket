import type {
  AuctionRules,
  TeamState,
  LotState,
  LotAction,
  Allocation,
  ErrorCode,
} from "../../contracts/src/index.ts";

/** No persistence, transport, clocks or random effects in this module. */
export class AuctionError extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode) {
    super(code);
    this.name = "AuctionError";
    this.code = code;
  }
}
function fail(code: ErrorCode): never {
  throw new AuctionError(code);
}
function whole(value: unknown, minimum = 0): value is number {
  return (
    typeof value === "number" && Number.isSafeInteger(value) && value >= minimum
  );
}
function reasonRequired(reason?: string): void {
  if (
    typeof reason !== "string" ||
    reason.trim().length === 0 ||
    reason.length > 2000
  )
    fail("REASON_REQUIRED");
}
export function validateRules(rules: AuctionRules): AuctionRules {
  if (!rules || typeof rules !== "object") fail("INVALID_RULES");
  const values = [
    rules.purse,
    rules.minSquad,
    rules.maxSquad,
    rules.minimumBase,
    rules.defaultBase,
    rules.increment,
  ];
  if (
    !values.every((n) => whole(n, 1)) ||
    typeof rules.reserveEnabled !== "boolean"
  )
    fail("INVALID_RULES");
  if (
    rules.minSquad > rules.maxSquad ||
    rules.minimumBase > rules.defaultBase ||
    rules.defaultBase > rules.purse
  )
    fail("INVALID_RULES");
  const floor = rules.minSquad * rules.minimumBase;
  if (!whole(floor, 1) || rules.purse < floor) fail("INVALID_RULES");
  return rules;
}
export function resolveEffectiveBase(
  requested: number | null | undefined,
  override: number | null | undefined,
  rules: AuctionRules,
): number {
  validateRules(rules);
  const base = override ?? requested ?? rules.defaultBase;
  if (!whole(base, rules.minimumBase) || base > rules.purse)
    fail("INVALID_BASE");
  return base;
}
function validateTeam(team: TeamState, rules: AuctionRules): void {
  if (
    !team ||
    typeof team.id !== "string" ||
    !team.id.trim() ||
    !whole(team.remainingPurse) ||
    team.remainingPurse > rules.purse ||
    !whole(team.squadSize) ||
    team.squadSize > rules.maxSquad
  )
    fail("INVALID_TEAM");
}
function validateLot(lot: LotState): void {
  if (
    !lot ||
    typeof lot.id !== "string" ||
    !lot.id.trim() ||
    !whole(lot.version, 1) ||
    !whole(lot.base, 1)
  )
    fail("INVALID_LOT");
  if (
    ![
      "PREVIEW",
      "OPEN",
      "PAUSED",
      "CLOSED",
      "SOLD",
      "UNSOLD",
      "REVERSED",
    ].includes(lot.status)
  )
    fail("INVALID_LOT");
  if ((lot.leadingTeamId === null) !== (lot.amount === null))
    fail("INVALID_LOT");
  if (
    lot.leadingTeamId !== null &&
    (typeof lot.leadingTeamId !== "string" ||
      !lot.leadingTeamId.trim() ||
      !whole(lot.amount, lot.base))
  )
    fail("INVALID_LOT");
}
export function computeMaxBid(team: TeamState, rules: AuctionRules): number {
  validateRules(rules);
  validateTeam(team, rules);
  if (team.squadSize >= rules.maxSquad) return 0;
  const reserve = rules.reserveEnabled
    ? Math.max(0, rules.minSquad - team.squadSize - 1) * rules.minimumBase
    : 0;
  return Math.max(0, team.remainingPurse - reserve);
}
export function validateNextBid(
  lot: LotState,
  team: TeamState,
  rules: AuctionRules,
  version: number,
  amount: number,
): number {
  validateRules(rules);
  validateTeam(team, rules);
  validateLot(lot);
  if (lot.status !== "OPEN") fail("LOT_NOT_OPEN");
  if (!whole(version, 1) || version !== lot.version) fail("STALE_VERSION");
  if (!whole(amount, 1)) fail("INVALID_AMOUNT");
  if (lot.leadingTeamId === team.id) fail("ALREADY_LEADING");
  if (team.squadSize >= rules.maxSquad) fail("SQUAD_FULL");
  if (lot.base < rules.minimumBase || lot.base > rules.purse)
    fail("INVALID_BASE");
  const next = lot.amount === null ? lot.base : lot.amount + rules.increment;
  if (!whole(next, 1) || amount !== next) fail("INVALID_AMOUNT");
  if (amount > computeMaxBid(team, rules)) fail("INSUFFICIENT_POINTS");
  return amount;
}
export function transitionLot(
  lot: LotState,
  action: LotAction,
  reason?: string,
): LotState {
  validateLot(lot);
  const allowed: Partial<
    Record<LotAction, Partial<Record<LotState["status"], LotState["status"]>>>
  > = {
    OPEN: { PREVIEW: "OPEN" },
    PAUSE: { OPEN: "PAUSED" },
    RESUME: { PAUSED: "OPEN" },
    CLOSE: { OPEN: "CLOSED" },
    SELL: { CLOSED: "SOLD" },
    UNSOLD: { CLOSED: "UNSOLD" },
    REOPEN: { CLOSED: "OPEN" },
  };
  const next = allowed[action]?.[lot.status];
  if (!next) fail("INVALID_TRANSITION");
  if (action === "REOPEN") reasonRequired(reason);
  if (action === "SELL" && lot.leadingTeamId === null) fail("NO_WINNER");
  if (action === "UNSOLD" && lot.leadingTeamId !== null) fail("HAS_BIDS");
  if (!whole(lot.version + 1, 1)) fail("INVALID_LOT");
  return { ...lot, status: next, version: lot.version + 1 };
}
export function settle(
  lot: LotState,
  team: TeamState,
  rules: AuctionRules,
): { lot: LotState; team: TeamState; ledgerDelta: number } {
  validateRules(rules);
  validateTeam(team, rules);
  validateLot(lot);
  if (lot.status !== "CLOSED") fail("INVALID_TRANSITION");
  if (lot.leadingTeamId === null || lot.amount === null) fail("NO_WINNER");
  if (lot.leadingTeamId !== team.id) fail("WINNER_MISMATCH");
  if (lot.base < rules.minimumBase || lot.base > rules.purse)
    fail("INVALID_BASE");
  if ((lot.amount - lot.base) % rules.increment !== 0) fail("INVALID_AMOUNT");
  if (team.squadSize >= rules.maxSquad) fail("SQUAD_FULL");
  if (lot.amount > computeMaxBid(team, rules)) fail("INSUFFICIENT_POINTS");
  return {
    lot: transitionLot(lot, "SELL"),
    team: {
      ...team,
      remainingPurse: team.remainingPurse - lot.amount,
      squadSize: team.squadSize + 1,
    },
    ledgerDelta: -lot.amount,
  };
}
/** Caller must lock the allocation and reject dependent historical corrections first. */
export function reverseSettlement(
  allocation: Allocation,
  team: TeamState,
  rules: AuctionRules,
  reason: string,
): { team: TeamState; ledgerDelta: number } {
  validateRules(rules);
  validateTeam(team, rules);
  reasonRequired(reason);
  if (
    !allocation ||
    !whole(allocation.price, 1) ||
    allocation.teamId !== team.id
  )
    fail("INVALID_ALLOCATION");
  if (allocation.status === "REVERSED") fail("ALREADY_REVERSED");
  if (allocation.status !== "ACTIVE") fail("INVALID_ALLOCATION");
  if (
    team.squadSize < 1 ||
    !whole(team.remainingPurse + allocation.price) ||
    team.remainingPurse + allocation.price > rules.purse
  )
    fail("REVERSAL_CONFLICT");
  return {
    team: {
      ...team,
      remainingPurse: team.remainingPurse + allocation.price,
      squadSize: team.squadSize - 1,
    },
    ledgerDelta: allocation.price,
  };
}
