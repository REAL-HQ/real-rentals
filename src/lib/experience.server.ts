// Server-side response shaping for the Experience selector. The browser sends
// the chosen experience in a header; it can only NARROW what an Owner receives
// (Owner in Admin view gets Admin-shaped responses). It never grants anything:
// real access still comes from roles + RLS.
import { getRequestHeader } from "@tanstack/react-start/server";

export function requestedExperience(): string | null {
  try {
    return getRequestHeader("x-rr-experience") ?? null;
  } catch {
    return null;
  }
}

/** True only for a real Owner who is in the Owner experience. */
export function ownerView(actor: { tier: string } | null | undefined): boolean {
  return actor?.tier === "owner" && requestedExperience() !== "admin";
}
