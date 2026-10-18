import { collectionsRequestRange, type CollectionsReport } from "@/lib/stripe-collections";

/** One query definition for every Collections reader, so identical periods share one cache entry and one request. */
export function stripeCollectionsQuery(
  load: (args: { data: { environment: "live" | "sandbox"; from: string; to: string } }) => Promise<{ report: CollectionsReport } | { error: string }>,
  environment: "live" | "sandbox",
  from: string,
  to: string,
  enabled: boolean,
) {
  const request = collectionsRequestRange(from, to);
  return {
    queryKey: ["stripe-collections", environment, from, to] as const,
    enabled: enabled && request !== null,
    queryFn: async (): Promise<CollectionsReport> => {
      if (!request) throw new Error("Invalid reporting range");
      const result = await load({ data: { environment, ...request } });
      if ("error" in result) throw new Error(result.error);
      return result.report;
    },
    retry: false as const, refetchOnWindowFocus: false, staleTime: 60000,
  };
}
