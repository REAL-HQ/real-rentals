import { createMiddleware, createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  DOCUMENT_REVIEW_AGING_REFUSED,
  assertDocumentReviewAgingEnabled,
  type DocumentReviewAgingResult,
} from "./document-review-aging";

const documentReviewAgingGate = createMiddleware({ type: "function" }).server(async ({ next }) => {
  assertDocumentReviewAgingEnabled();
  return next();
});

export const getDocumentReviewAging = createServerFn({ method: "GET" })
  .middleware([documentReviewAgingGate, requireSupabaseAuth])
  .handler(async ({ context }): Promise<DocumentReviewAgingResult> => {
    // The assert throws while the flag is off, so a return after it never runs.
    // The read stays in the other branch, which the bundler drops with the flag.
    if (DOCUMENT_REVIEW_AGING_REFUSED) {
      assertDocumentReviewAgingEnabled();
    } else {
      const { loadDocumentReviewAging } = await import("./document-review-aging-load");
      const { requireManager } = await import("@/lib/roles.server");
      await requireManager(context.userId);
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      return loadDocumentReviewAging(supabaseAdmin);
    }
  });
