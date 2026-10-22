import { createMiddleware, createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  assertBookingFollowupEnabled,
  type BookingFollowupList,
} from "@/lib/booking-followup";

/**
 * Staff list of approved or verified applications with no booking.
 * Read-only. The flag refusal runs before auth, before the role check, and
 * before the loader (which itself refuses before any read).
 */
const bookingFollowupGate = createMiddleware({ type: "function" }).server(async ({ next }) => {
  assertBookingFollowupEnabled();
  return next();
});

export const listBookingFollowups = createServerFn({ method: "GET" })
  .middleware([bookingFollowupGate, requireSupabaseAuth])
  .handler(async ({ context }): Promise<BookingFollowupList> => {
    assertBookingFollowupEnabled();
    const { requireStaff } = await import("@/lib/roles.server");
    await requireStaff(context.userId);
    const { loadBookingFollowups } = await import("@/lib/booking-followup.server");
    return loadBookingFollowups();
  });
