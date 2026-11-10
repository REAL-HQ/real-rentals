import { z } from "zod";

export const quickCallInput = z.object({
  applicationId: z.string().uuid(),
  occurredAt: z.string().datetime({ offset: true }),
  note: z.string().trim().min(3).max(1000),
  completed: z.literal(true),
}).strict();

export const quickCallNotesInput = z.object({
  applicationId: z.string().uuid(),
  note: z.string().trim().min(3).max(4000),
}).strict();

/** Only completion metadata: never manufacture answers or change stages. */
export function quickCallPatch(existing: { interview_notes?: string | null }, input: { occurredAt: string; note: string }, actor: { userId: string; email: string | null }) {
  const note = `Phone Call Completed · ${input.occurredAt}\n${input.note}`;
  return {
    interview_completed_at: input.occurredAt,
    interviewed_by: actor.email ?? actor.userId,
    interview_notes: existing.interview_notes ? `${existing.interview_notes}\n\n${note}` : note,
  };
}