import type { AuctionRules, AuctionStatus } from "../../contracts/src/index.ts";
import { validateRules } from "./auction.ts";
export interface Readiness {
  rules: AuctionRules;
  teams: { approved: boolean; operator: boolean }[];
  approvedPlayers: number;
  pendingReviews: number;
}
export function readinessIssues(input: Readiness): string[] {
  validateRules(input.rules);
  const issues: string[] = [];
  if (input.teams.length < 2 || input.teams.some((t) => !t.approved))
    issues.push("TEAMS_REQUIRED");
  if (input.teams.some((t) => !t.operator)) issues.push("OPERATORS_REQUIRED");
  if (input.approvedPlayers === 0) issues.push("PLAYERS_REQUIRED");
  else if (input.approvedPlayers < input.teams.length * input.rules.minSquad)
    issues.push("INSUFFICIENT_POOL");
  if (input.pendingReviews > 0) issues.push("REVIEWS_PENDING");
  return issues;
}
export function transitionAuction(
  status: AuctionStatus,
  action: string,
): AuctionStatus {
  const map: Record<string, Partial<Record<AuctionStatus, AuctionStatus>>> = {
    PUBLISH: { DRAFT: "REGISTRATION_OPEN" },
    LOCK: { REGISTRATION_OPEN: "LOCKED", READY: "LOCKED" },
    UNLOCK: { LOCKED: "REGISTRATION_OPEN" },
    START: { LOCKED: "LIVE" },
    PAUSE: { LIVE: "PAUSED" },
    RESUME: { PAUSED: "LIVE" },
    COMPLETE: { LIVE: "COMPLETED", PAUSED: "COMPLETED" },
    ARCHIVE: { COMPLETED: "ARCHIVED" },
    CANCEL: {
      DRAFT: "CANCELLED",
      REGISTRATION_OPEN: "CANCELLED",
      READY: "CANCELLED",
      LOCKED: "CANCELLED",
    },
  };
  const next = map[action]?.[status];
  if (!next) throw Error("INVALID_TRANSITION");
  return next;
}
export function assertReversalSafe(
  status: AuctionStatus,
  laterSales: boolean,
): void {
  if (status !== "PAUSED") throw Error("PAUSE_REQUIRED");
  if (laterSales) throw Error("REVERSAL_CONFLICT");
}
