import { z } from "zod";

/** Isolated contract only. No live reads, sends, saves or rental authorization. */
export const PICKUP_PLAN_ENABLED = false;
export const PICKUP_PACKET_ENABLED = false;
export const PICKUP_HANDOFF_ENABLED = false;

const zone = z.string().trim().refine((value) => {
  try { new Intl.DateTimeFormat("en-US", { timeZone: value }).format(); return true; }
  catch { return false; }
}, "Valid Time Zone Required");
export const pickupPlanInput = z.object({
  applicationId: z.string().uuid(), expectedRevision: z.number().int().nonnegative(),
  idempotencyKey: z.string().uuid(), vehicleId: z.string().uuid(),
  appointmentAt: z.string().datetime({ offset: true }), timeZone: zone,
  location: z.string().trim().min(3).max(500), reason: z.string().trim().min(5).max(500),
}).strict();
export type PickupPlanInput = z.infer<typeof pickupPlanInput>;
export type PickupPlan = PickupPlanInput & { revision: number; actorId: string; confirmedAt: string };
export type PickupVehicle = { id: string; label: string; vin: string | null; plate: string | null; registration: string | null };
export type PickupPacket = {
  applicationId: string; planRevision: number; vehicle: PickupVehicle;
  appointmentAt: string; timeZone: string; location: string;
  portalUrl: string | null; agreementUrl: string | null; paymentUrl: string | null;
  /** Already-authorized reviewed share URL, never a private storage path. */
  photoPackageUrl: string | null;
};
const publicHosts = new Set(["drivereal.com", "www.drivereal.com"]);
function publicLink(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && publicHosts.has(url.hostname) && !url.username && !url.password && !url.port ? url.href : null;
  } catch { return null; }
}

/** Mock-only optimistic revision proposal, not a durable save. */
export function proposePickupPlan(input: PickupPlanInput, current: PickupPlan | null, issued: { actorId: string; confirmedAt: string }): PickupPlan {
  const parsed = pickupPlanInput.parse(input);
  if (current && current.applicationId !== parsed.applicationId) throw new Error("Pickup Plan Belongs To Another Renter");
  if (parsed.expectedRevision !== (current?.revision ?? 0)) throw new Error("Pickup Plan Changed; Refresh Before Saving");
  return { ...parsed, ...issued, revision: parsed.expectedRevision + 1 };
}

/** Draft snapshot; a result is never permission to send a packet. */
export function pickupPacket(input: {
  applicationId: string; plan: PickupPlan | null; vehicle: PickupVehicle | null;
  portalUrl: string | null; agreementUrl: string | null; paymentUrl: string | null;
  photoPackageUrl: string | null;
}): { packet: PickupPacket | null; issues: string[] } {
  const { plan, vehicle } = input;
  const issues: string[] = [];
  if (!plan || plan.applicationId !== input.applicationId || !pickupPlanInput.safeParse(plan && { applicationId: plan.applicationId, expectedRevision: plan.expectedRevision, idempotencyKey: plan.idempotencyKey, vehicleId: plan.vehicleId, appointmentAt: plan.appointmentAt, timeZone: plan.timeZone, location: plan.location, reason: plan.reason }).success) issues.push("Confirmed Pickup Appointment Required");
  if (!vehicle || vehicle.id !== plan?.vehicleId) issues.push("Assigned Vehicle Changed");
  if (!vehicle?.vin || !/^[A-HJ-NPR-Z0-9]{17}$/.test(vehicle.vin)) issues.push("Valid VIN Required");
  if (!vehicle?.plate?.trim()) issues.push("License Plate Not Set");
  if (!vehicle?.registration?.trim()) issues.push("Registration Not Set");
  const links = {
    portalUrl: publicLink(input.portalUrl), agreementUrl: publicLink(input.agreementUrl),
    paymentUrl: publicLink(input.paymentUrl), photoPackageUrl: publicLink(input.photoPackageUrl),
  };
  for (const key of ["portalUrl", "agreementUrl", "paymentUrl", "photoPackageUrl"] as const) if (input[key] && !links[key]) issues.push("Public Website Link Required");
  if (!links.portalUrl) issues.push("Portal Access Not Set");
  if (!links.agreementUrl) issues.push("Agreement Access Not Set");
  if (!links.paymentUrl) issues.push("Payment Access Not Set");
  if (issues.length || !plan || !vehicle) return { packet: null, issues };
  return { packet: { applicationId: input.applicationId, planRevision: plan.revision, vehicle: { ...vehicle }, appointmentAt: plan.appointmentAt, timeZone: plan.timeZone, location: plan.location, ...links }, issues };
}

export type HandoffEvidence = {
  applicationId: string; plan: PickupPlan; expectedPlanRevision: number; finalVehicleId: string;
  signedAgreement: { applicationId: string; vehicleId: string; signed: boolean; voided: boolean } | null;
  payment: { applicationId: string; vehicleId: string; obligationId: string | null; status: string; netCollectedCents: number | null; requiredCents: number | null; kind: "rent" | "deposit" } | null;
};
/** Mock-only binding diagnostics. Never import this into decideActivation. */
export function handoffEvidenceIssues(input: HandoffEvidence): string[] {
  const issues: string[] = [];
  if (input.plan.applicationId !== input.applicationId || input.plan.revision !== input.expectedPlanRevision || input.plan.vehicleId !== input.finalVehicleId) issues.push("Pickup Plan Changed");
  const agreement = input.signedAgreement;
  if (!agreement || agreement.applicationId !== input.applicationId || agreement.vehicleId !== input.finalVehicleId || !agreement.signed || agreement.voided) issues.push("Signed Agreement For Final Vehicle Required");
  const payment = input.payment;
  if (!payment || payment.applicationId !== input.applicationId || payment.vehicleId !== input.finalVehicleId || !payment.obligationId || payment.status !== "paid" || payment.kind !== "rent" || !Number.isSafeInteger(payment.netCollectedCents) || !Number.isSafeInteger(payment.requiredCents) || (payment.requiredCents ?? 0) <= 0 || (payment.netCollectedCents ?? 0) < (payment.requiredCents ?? 0)) issues.push("Verified Applicable Payment Required");
  return issues;
}