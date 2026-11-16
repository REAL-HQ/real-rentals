/**
 * Pickup checklist on the field rep's phone (Dolmar, t298s1611): a photo of
 * the renter holding their license, the odometer, the fuel level and the
 * renter's signature. When it is complete AND the agreement is signed AND a
 * card is on file AND the reservation fee is paid, the rental is activated
 * through the normal Activate Rental path (activateRentalCore ->
 * activate_rental_checked_tx), which starts billing as it always has.
 *
 * Auto-activation is OFF until app_settings.pickup_auto_activate.enabled is
 * true (proposed/pickup-auto-activate-on.sql). With it off, the checklist is
 * still saved and staff activate as today. Nothing here marks anyone
 * insured or verified; the insurance status is recorded exactly as the
 * manual path records it.
 */

export const PICKUP_AUTO_ACTIVATE_KEY = "pickup_auto_activate";
export const LICENSE_HOLD_CAPTION = "Renter holding license";
export const FUEL_LEVELS = ["E", "1/8", "1/4", "3/8", "1/2", "5/8", "3/4", "7/8", "F"] as const;
export type FuelLevel = (typeof FUEL_LEVELS)[number];

export type AutoActivateSetting = {
  enabled: boolean;
  /** Treat a completed checklist as covering "interview not recorded" (audited override). */
  override_no_interview: boolean;
  /** Treat a completed checklist as covering "no passed pre-delivery inspection" (audited override). */
  override_no_passed_inspection: boolean;
};

export function readAutoActivateSetting(v: unknown): AutoActivateSetting {
  const o = v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  return {
    enabled: o.enabled === true,
    override_no_interview: o.override_no_interview === true,
    override_no_passed_inspection: o.override_no_passed_inspection === true,
  };
}

/** The caption that marks the license photo, tied to this applicant. */
export function licenseHoldCaption(applicationId: string): string {
  return `${LICENSE_HOLD_CAPTION} · ${applicationId}`;
}

export const FEE_PAID_STATUSES = ["paid", "applied", "waived", "not_required"] as const;

export type HandoverGateInput = {
  licensePhoto: boolean;
  odometer: number | null;
  fuelLevel: string | null;
  renterSignatureName: string | null;
  renterSignedAt: string | null;
  agreementSigned: boolean;
  cardOnFile: boolean;
  reservationFeeStatus: string | null;
  reservationFeeRequired: boolean;
};

export type HandoverGate = { key: string; label: string; met: boolean };

export function handoverGates(i: HandoverGateInput): HandoverGate[] {
  const fee = i.reservationFeeRequired ? String(i.reservationFeeStatus ?? "") : "not_required";
  return [
    { key: "license_photo", label: "Photo of renter holding license", met: i.licensePhoto },
    { key: "odometer", label: "Odometer", met: i.odometer != null && Number.isInteger(i.odometer) && i.odometer >= 0 },
    { key: "fuel", label: "Fuel level", met: (FUEL_LEVELS as readonly string[]).includes(String(i.fuelLevel ?? "")) },
    { key: "renter_signature", label: "Renter signature", met: !!(i.renterSignatureName && i.renterSignatureName.trim().length >= 3 && i.renterSignedAt) },
    { key: "agreement_signed", label: "Rental agreement signed", met: i.agreementSigned },
    { key: "card_on_file", label: "Card on file", met: i.cardOnFile },
    { key: "fee_paid", label: "Reservation fee paid", met: (FEE_PAID_STATUSES as readonly string[]).includes(fee) },
  ];
}

/** Blocker codes the checklist may cover, each only when its setting is on. */
export function coverableBlockers(s: AutoActivateSetting): string[] {
  const out: string[] = [];
  if (s.override_no_interview) out.push("no_interview");
  if (s.override_no_passed_inspection) out.push("no_passed_inspection");
  return out;
}

export type AutoDecision =
  | { activate: true; overrides: string[] }
  | { activate: false; reason: string; missing: string[] };

/**
 * Should a completed checklist activate the rental now?
 * `blockers` are the activation readiness blockers (evaluateReadiness).
 */
export function decideAutoActivation(input: {
  setting: AutoActivateSetting;
  actorIsManager: boolean;
  gates: HandoverGate[];
  blockers: { code: string }[];
}): AutoDecision {
  if (!input.setting.enabled) return { activate: false, reason: "auto_activate_off", missing: [] };
  const missing = input.gates.filter((g) => !g.met).map((g) => g.key);
  if (missing.length) return { activate: false, reason: "gates_not_met", missing };
  if (!input.actorIsManager) return { activate: false, reason: "needs_manager", missing: [] };
  const coverable = new Set(coverableBlockers(input.setting));
  const left = input.blockers.map((b) => b.code).filter((c) => !coverable.has(c));
  if (left.length) return { activate: false, reason: "activation_blocked", missing: left };
  return { activate: true, overrides: input.blockers.map((b) => b.code) };
}

export function overrideReason(repName: string): string {
  return `Pickup checklist completed by ${repName}: photo of renter holding license, odometer, fuel and renter signature (Owner rule, Nov 15 2026).`;
}

export function hasCardOnFile(rows: Array<{ card_last4?: string | null; stripe_payment_method_id?: string | null; card_on_file_at?: string | null } | null | undefined>): boolean {
  const filled = (v: unknown) => typeof v === "string" && v.trim().length > 0;
  return rows.some((r) => !!r && (filled(r.card_last4) || filled(r.stripe_payment_method_id) || filled(r.card_on_file_at)));
}
