// Server-function middleware for staff actions that contact one person
// (Send Agreement, Resend, Pickup Link, Payment Method Link, Request Documents...).
// The browser has already shown the "On DNC List" popup and the staff member chose
// Contact Anyway (or the person is not on the list), so the send inside this request
// is not treated as automated. See staffContact() in dnc.server.ts.
import { createMiddleware } from "@tanstack/react-start";

export const staffContactMiddleware = createMiddleware({ type: "function" }).server(
  async ({ next }) => {
    const { staffContact } = await import("@/lib/dnc.server");
    return staffContact(() => next());
  },
);
