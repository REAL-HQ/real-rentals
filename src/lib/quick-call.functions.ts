import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { quickCallInput, quickCallNotesInput } from "./quick-call";

export const recordCompletedPhoneCall = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => quickCallInput.parse(input))
  .handler(async ({ data, context }) => {
    const { recordQuickCall } = await import("./quick-call.server");
    return recordQuickCall(data, context);
  });

export const updateCompletedPhoneCallNotes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => quickCallNotesInput.parse(input))
  .handler(async ({ data, context }) => {
    const { updateQuickCallNotes } = await import("./quick-call.server");
    return updateQuickCallNotes(data, context);
  });