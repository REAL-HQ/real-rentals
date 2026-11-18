/**
 * FLEET: get the $50 Reservation Fee Checkout link for an applicant who has
 * signed (POST /api/public/fleet/reservation-fee-link, Bearer FLEET_API_KEY).
 * Same shared core as the staff "Copy Reservation Fee Link" action
 * (reservationFeeLinkForApplication). Idempotent: an open Checkout (under 23
 * hours) is returned again, never a second session; a paid fee is never
 * charged twice. Sends NOTHING (send is not supported yet). Audited as FLEET.
 */
import { cleanText, fleetAdmin, fleetAudit, fleetJson, fleetRequestBody, UUID_RE, type FleetDeps } from "@/lib/fleet-api.server";
import type { ReservationFeeDeps } from "@/lib/reservation-fee.server";

export async function handleFleetReservationFeeLink(request: Request, deps: FleetDeps & { fee?: ReservationFeeDeps } = {}): Promise<Response> {
  const got = await fleetRequestBody(request, deps);
  if ("response" in got) return got.response;
  const body = got.body;
  const lead = String(body.lead_id ?? body.application_id ?? "").trim();
  if (!UUID_RE.test(lead)) return fleetJson(400, { ok: false, error: "lead_id must be a UUID." });
  if (body.send === true || String(body.send).toLowerCase() === "true") {
    return fleetJson(400, { ok: false, error: "send is not supported yet; this returns the link only. Send it through the approved email or text path." });
  }
  const admin = await fleetAdmin(deps);
  const { reservationFeeLinkForApplication } = await import("@/lib/reservation-fee.server");
  const audit = fleetAudit(deps);
  let link;
  try {
    link = await reservationFeeLinkForApplication(admin, lead, deps.fee ?? {});
  } catch (e) {
    console.error("[fleet reservation-fee-link]", e);
    return fleetJson(500, { ok: false, error: "Could not create the link; nothing was sent." });
  }
  const reason = cleanText(body.reason, 200);
  await audit({
    action: "payment.reservation_fee_link_fleet",
    summary: link.ok ? `FLEET requested the Reservation Fee payment link (${link.reused ? "reused open checkout" : "new checkout"}; nothing was sent)` : `FLEET requested the Reservation Fee link: ${link.message}`,
    entityType: "esign_document",
    entityId: link.agreementId,
    metadata: { by: "FLEET", lead_id: lead, status: link.status, reused: link.ok ? link.reused : null, session_id: link.ok ? link.sessionId : null, reason: reason || null },
  }).catch(() => {});
  if (!link.ok) {
    const code = link.status === "no_signed_agreement" || link.status === "no_fee_on_agreement" || link.status === "not_found" || link.status === "off" ? 409 : link.status === "already_paid" || link.status === "paid" || link.status === "pending" ? 409 : 502;
    return fleetJson(code, { ok: false, error: link.message, status: link.status, agreement_id: link.agreementId, sent: false });
  }
  return fleetJson(200, { ok: true, url: link.url, session_id: link.sessionId, expires_at: link.expiresAt, amount: link.amount, reused: link.reused, agreement_id: link.agreementId, lead_id: lead, sent: false });
}
