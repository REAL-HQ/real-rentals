import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { quickCallInput } from "./quick-call";

export const recordCompletedPhoneCall = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => quickCallInput.parse(input))
  .handler(async ({ data, context }) => {
    const { recordQuickCall } = await import("./quick-call.server");
    return recordQuickCall(data, context);
  });