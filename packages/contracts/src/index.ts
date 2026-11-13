/** Shared business vocabulary. Network inputs must still be validated at runtime. */
export interface AuctionRules {
  purse: number;
  minSquad: number;
  maxSquad: number;
  minimumBase: number;
  defaultBase: number;
  increment: number;
  reserveEnabled: boolean;
}
export type AuctionStatus =
  | "DRAFT"
  | "REGISTRATION_OPEN"
  | "READY"
  | "LOCKED"
  | "LIVE"
  | "PAUSED"
  | "COMPLETED"
  | "ARCHIVED"
  | "CANCELLED";
export type RegistrationStatus =
  | "DRAFT"
  | "PENDING"
  | "APPROVED"
  | "REJECTED"
  | "CHANGES_REQUESTED"
  | "WITHDRAWN";
export type LotStatus =
  "PREVIEW" | "OPEN" | "PAUSED" | "CLOSED" | "SOLD" | "UNSOLD" | "REVERSED";
export interface TeamState {
  id: string;
  remainingPurse: number;
  squadSize: number;
}
export interface LotState {
  id: string;
  status: LotStatus;
  version: number;
  base: number;
  leadingTeamId: string | null;
  amount: number | null;
}
export type LotAction =
  "OPEN" | "PAUSE" | "RESUME" | "CLOSE" | "SELL" | "UNSOLD" | "REOPEN";
export interface Allocation {
  price: number;
  teamId: string;
  status: "ACTIVE" | "REVERSED";
}
export interface BidCommand {
  commandId: string;
  lotId: string;
  expectedVersion: number;
  amount: number;
}
export interface AuctionEvent<T = unknown> {
  eventId: string;
  auctionId: string;
  sequence: number;
  lotVersion: number | null;
  type: string;
  occurredAt: string;
  payload: T;
}
export type ErrorCode =
  | "INVALID_RULES"
  | "INVALID_BASE"
  | "INVALID_TEAM"
  | "INVALID_LOT"
  | "INVALID_AMOUNT"
  | "STALE_VERSION"
  | "LOT_NOT_OPEN"
  | "ALREADY_LEADING"
  | "SQUAD_FULL"
  | "INSUFFICIENT_POINTS"
  | "INVALID_TRANSITION"
  | "HAS_BIDS"
  | "REASON_REQUIRED"
  | "WINNER_MISMATCH"
  | "NO_WINNER"
  | "ALREADY_REVERSED"
  | "INVALID_ALLOCATION"
  | "REVERSAL_CONFLICT";
