/**
 * POST /api/public/fleet/team-alert (Bearer FLEET_API_KEY)
 *
 * For the bots (FLEET, the support bot, the phone assistant) to put a person
 * on something right away:
 *
 *   { "kind": "roadside_overnight", "summary": "Flat tire on I-4, car not drivable",
 *     "rental_id"?: "...", "lead_id"?: "...", "dedupe_key"?: "quo message id" }
 *     Only from 6 PM to 6 AM ET (D17); in the daytime staff handle roadside (409).
 *
 *   { "kind": "bot_handoff", "reason": "complaint" | "injury" | "payment_dispute" |
 *     "asked_for_person" | "outside_templates" | "no_answer", "summary": "...",
 *     "lead_id"?: "...", "rental_id"?: "...", "dedupe_key"?: "..." }
 *     (D29). The bot stops replying to that person and says a team member will
 *     follow up (docs/bot-rules.md).
 *
 * Sends one team alert (team-alerts.server.ts): email to team@drivereal.com
 * anytime, and a text that follows staff coverage (other company Quo line
 * during Rosa's hours, field-rep numbers from Pickup Schedule settings
 * otherwise). Injuries also go to the field rep at any hour. Gated per kind
 * by app_settings.team_alerts (OFF by default). Any phone number in the
 * summary is removed. Staff phones are read from settings, never from the
 * request.
 */
import { cleanText, fleetAdmin, fleetJson, fleetRequestBody, UUID_RE, type FleetDeps } from "@/lib/fleet-api.server";
import { isOvernightEt } from "@/lib/team-alerts";
import type { TeamAlertDeps } from "@/lib/team-alerts.server";

export const HANDOFF_REASONS = ["complaint", "injury", "payment_dispute", "asked_for_person", "outside_templates", "no_answer"] as const;
const REASON_LABEL: Record<(typeof HANDOFF_REASONS)[number], string> = {
  complaint: "Complaint",
  injury: "Injury",
  payment_dispute: "Payment Dispute",
  asked_for_person: "Asked For A Person",
  outside_templates: "Outside The Approved Templates",
  no_answer: "No Bot Answer In 15 Minutes",
};

const SITE = () => String(process.env.SITE_URL || "https://drivereal.com").replace(/\/$/, "");

export async function handleFleetTeamAlert(request: Request, deps: FleetDeps & TeamAlertDeps = {}): Promise<Response> {
  const parsed = await fleetRequestBody(request, deps);
  if ("response" in parsed) return parsed.response;
  const { body } = parsed;
  const now = (deps.now ?? (() => new Date()))();
  const kind = String(body.kind ?? "");
  if (kind !== "roadside_overnight" && kind !== "bot_handoff") return fleetJson(400, { ok: false, error: 'kind must be "roadside_overnight" or "bot_handoff".' });
  const summary = cleanText(body.summary, 300);
  if (summary.length < 3) return fleetJson(400, { ok: false, error: "summary is required." });
  for (const f of ["lead_id", "rental_id"] as const) if (body[f] != null && body[f] !== "" && !UUID_RE.test(String(body[f]))) return fleetJson(400, { ok: false, error: `${f} must be a UUID.` });
  const leadId = body.lead_id ? String(body.lead_id) : null;
  const rentalId = body.rental_id ? String(body.rental_id) : null;
  const dedupe = cleanText(body.dedupe_key, 120) || `${leadId ?? rentalId ?? "none"}:${now.toISOString().slice(0, 16)}`;

  let title: string;
  const lines: string[] = [];
  if (kind === "roadside_overnight") {
    if (!isOvernightEt(now)) return fleetJson(409, { ok: false, error: "Roadside is staffed 6 AM to 6 PM ET; hand it to staff the normal way." });
    title = `After-Hours Roadside: ${summary}`;
    lines.push("Reported to a bot between 6 PM and 6 AM ET. There is no tow partner overnight yet: call the renter back and arrange help.");
  } else {
    const reason = String(body.reason ?? "") as (typeof HANDOFF_REASONS)[number];
    if (!HANDOFF_REASONS.includes(reason)) return fleetJson(400, { ok: false, error: `reason must be one of ${HANDOFF_REASONS.join(", ")}.` });
    title = `Bot Hand-Off (${REASON_LABEL[reason]}): ${summary}`;
    lines.push("The bot has stopped replying to this person and told them a team member will follow up.");
    if (reason === "injury") lines.push("Injury reported: call them now. If anyone is hurt they should call 911.");
  }
  const link = leadId ? `${SITE()}/admin?tab=drivers&id=${encodeURIComponent(leadId)}` : `${SITE()}/admin?tab=issues`;
  const admin = await fleetAdmin(deps);
  const { sendTeamAlert } = await import("@/lib/team-alerts.server");
  const out = await sendTeamAlert(admin, {
    kind,
    dedupeKey: dedupe,
    title,
    lines: [`Summary: ${summary}`, ...lines],
    link,
    rentalId,
    activeLine: body.line_id ?? body.from_phone_number_id ?? body.phone_number_id ?? null,
    handoffReason: kind === "bot_handoff" ? String(body.reason ?? "") : null,
  }, deps);
  const code = out.status === "no_table" ? 503 : out.status === "failed" ? 502 : 200;
  return fleetJson(code, { ok: out.status === "sent" || out.status === "partial" || out.status === "duplicate", ...out });
}
