import { queryOptions, type QueryClient } from "@tanstack/react-query";
import type { UnifiedFinanceRequest, UnifiedFinanceResponse } from "./unified-finance-contract";

export type FinanceSession = { userId: string | null; revision: number };
/** No auth subscriber or UI integration. Future consumers must supply current session identity/revision. */
export function unifiedFinanceQueryOptions(request: UnifiedFinanceRequest, session: FinanceSession,
  currentSession: () => FinanceSession,
  read: (request: UnifiedFinanceRequest) => Promise<UnifiedFinanceResponse>) {
  const sameSession = () => { const now = currentSession(); return Boolean(session.userId) && now.userId === session.userId && now.revision === session.revision; };
  return queryOptions({
    queryKey: ["unified-finance", session.userId, session.revision, request] as const,
    enabled: false, retry: false, staleTime: 0, gcTime: 0, refetchInterval: false,
    refetchOnWindowFocus: false, refetchOnReconnect: false, refetchOnMount: false,
    queryFn: async ({ signal }) => {
      if (!sameSession()) throw new Error("Finance session changed");
      signal.throwIfAborted();
      const response = await read(request);
      signal.throwIfAborted();
      if (!sameSession()) throw new Error("Finance session changed");
      return response;
    },
  });
}
export async function clearUnifiedFinanceQueries(client: QueryClient) {
  await client.cancelQueries({ queryKey: ["unified-finance"] });
  client.removeQueries({ queryKey: ["unified-finance"] });
}