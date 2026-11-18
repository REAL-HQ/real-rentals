import { z } from "zod";

/**
 * Pure rules for switching the car on a Reserved rental (Dolmar, Nov 18).
 * The server core is reservation-switch.server.ts; nothing here touches data.
 */

/** Vehicle statuses a reservation may be moved onto (same set the Reserve picker offers). */
export const SWITCH_TARGET_STATUSES = ["available", "ready", "onboarding"] as const;

export const SwitchReservationVehicleInput = z.object({
  rentalId: z.string().uuid(),
  newVehicleId: z.string().uuid(),
  /** Omitted = keep the reservation's current weekly rate. */
  weeklyRate: z.number().positive().max(10000).optional(),
  /** Optional free text for the activity log. */
  reason: z.string().trim().max(300).optional(),
  /** "Old car has an issue": the old vehicle goes to Service instead of back to Available. */
  oldCarHasIssue: z.boolean().optional(),
});
export type SwitchReservationVehicleData = z.infer<typeof SwitchReservationVehicleInput>;

export type SwitchAgreementFlag = {
  /** True when staff must void / re-send because an agreement still names the old car. */
  needsAttention: boolean;
  signed: number;
  outstanding: number;
  draft: number;
  /** One line for the toast and the activity log; empty when nothing references the old car. */
  message: string;
};

type AgreementLite = { status: string | null };

/**
 * Agreements that still name the OLD vehicle. The switch never edits, voids or
 * re-sends an agreement: a signed one stays exactly as signed and is flagged.
 */
export function classifyAgreementsForSwitch(rows: AgreementLite[]): SwitchAgreementFlag {
  let signed = 0;
  let outstanding = 0;
  let draft = 0;
  for (const r of rows) {
    const s = String(r.status ?? "").toLowerCase();
    if (s === "voided" || s === "void" || s === "cancelled" || s === "canceled" || s === "expired") continue;
    if (s === "signed" || s === "completed") signed += 1;
    else if (s === "sent" || s === "viewed") outstanding += 1;
    else draft += 1;
  }
  const parts: string[] = [];
  if (signed) parts.push(`${signed} signed agreement${signed === 1 ? "" : "s"} still name${signed === 1 ? "s" : ""} the old car and need${signed === 1 ? "s" : ""} to be re-signed`);
  if (outstanding) parts.push(`${outstanding} sent agreement${outstanding === 1 ? "" : "s"} name${outstanding === 1 ? "s" : ""} the old car (void and re-send)`);
  if (draft) parts.push(`${draft} draft agreement${draft === 1 ? "" : "s"} name${draft === 1 ? "s" : ""} the old car (re-prepare)`);
  return {
    needsAttention: signed + outstanding + draft > 0,
    signed,
    outstanding,
    draft,
    message: parts.length ? `${parts.join("; ")}.` : "",
  };
}

/** Status the old car gets when the switch releases it. */
export function oldVehicleReleaseStatus(oldCarHasIssue: boolean | undefined): "available" | "maintenance" {
  return oldCarHasIssue ? "maintenance" : "available";
}

export type SwitchResult = {
  rentalId: string;
  fromVehicleId: string;
  toVehicleId: string;
  weeklyRate: number | null;
  rateChanged: boolean;
  oldVehicleStatus: "available" | "maintenance" | "unchanged";
  /** False when the old car could not be released (it is left as-is and staff should check it). */
  oldVehicleReleased: boolean;
  agreement: SwitchAgreementFlag;
};
