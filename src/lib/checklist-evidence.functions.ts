import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { attestationInput } from "./checklist-evidence";

export const getChecklistEvidence = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ applicationId: z.string().uuid() }).strict().parse(input))
  .handler(async ({ data, context }) => {
    const { readEvidenceEvents } = await import("./checklist-evidence.server");
    return { events: await readEvidenceEvents(context.supabase as any, data.applicationId) };
  });

export const saveChecklistEvidence = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => attestationInput.parse(input))
  .handler(async ({ data, context }) => {
    const { writeEvidenceEvent } = await import("./checklist-evidence.server");
    return writeEvidenceEvent(context.supabase as any, data);
  });
