import type { QueryClient } from "@tanstack/react-query";
import type { FinanceSession } from "./unified-finance-query";

/** Per QueryClient (not a server singleton). Reads and transitions never fetch finance. */
const epochs = new WeakMap<QueryClient, FinanceSession>();
export function financeSessionSnapshot(client: QueryClient): FinanceSession {
  return { ...(epochs.get(client) ?? { userId: null, revision: 0 }) };
}
export function advanceFinanceSession(client: QueryClient, userId: string | null, event: string): FinanceSession {
  const previous = financeSessionSnapshot(client);
  const authorizationEvent = ["SIGNED_IN", "SIGNED_OUT", "USER_UPDATED", "PASSWORD_RECOVERY", "MFA_CHALLENGE_VERIFIED"].includes(event);
  if (previous.userId === userId && !authorizationEvent) return previous;
  const next = { userId, revision: previous.revision + 1 }; epochs.set(client, next);
  // Increment synchronously before cancellation, so an in-flight response can never pass its guard.
  void client.cancelQueries({ queryKey: ["unified-finance"] });
  client.removeQueries({ queryKey: ["unified-finance"] });
  return { ...next };
}
/** Startup getSession response is ignored after any newer auth event (even refresh). */
export function createFinanceSessionObserver(client: QueryClient, onIdentity: (userId: string | null) => void) {
  let sequence = 0; let active = true;
  return {
    initialTicket: () => sequence,
    initial: (ticket: number, userId: string | null) => {
      if (!active || ticket !== sequence) return;
      advanceFinanceSession(client, userId, "INITIAL_SESSION"); onIdentity(userId);
    },
    event: (event: string, userId: string | null) => {
      if (!active) return; sequence++;
      advanceFinanceSession(client, userId, event); onIdentity(userId);
    },
    dispose: () => { active = false; sequence++; },
  };
}