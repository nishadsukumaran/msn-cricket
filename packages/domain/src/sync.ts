import type { AuctionEvent } from "../../contracts/src/index.ts";
export interface SyncState {
  auctionId: string | null;
  sequence: number;
  status: "SYNCED" | "DISCONNECTED" | "RESYNC_REQUIRED";
}
export function loadSnapshot(auctionId: string, sequence: number): SyncState {
  if (!auctionId || !Number.isSafeInteger(sequence) || sequence < 0)
    throw Error("INVALID_SNAPSHOT");
  return { auctionId, sequence, status: "SYNCED" };
}
export function disconnect(state?: SyncState): SyncState {
  return {
    auctionId: state?.auctionId ?? null,
    sequence: state?.sequence ?? 0,
    status: "DISCONNECTED",
  };
}
/** Transport/controller must validate the event schema before calling this cursor reducer. */
export function applyEvent(state: SyncState, event: AuctionEvent): SyncState {
  if (
    state.status !== "SYNCED" ||
    event.auctionId !== state.auctionId ||
    !Number.isSafeInteger(event.sequence) ||
    event.sequence < 1
  )
    return { ...state, status: "RESYNC_REQUIRED" };
  if (event.sequence <= state.sequence) return state;
  if (event.sequence !== state.sequence + 1)
    return { ...state, status: "RESYNC_REQUIRED" };
  return { ...state, sequence: event.sequence };
}
/** Connection readiness only. Actor eligibility and lot state are separate gates. */
export function canBid(state: SyncState): boolean {
  return state.status === "SYNCED";
}
