/**
 * Add Driver requests: database, storage and Stripe Checkout. Server only.
 * Rules and copy live in add-driver-requests.ts; docs/add-driver-requests.md
 * has the whole flow.
 *
 * Money safety (same shape as the Reservation Fee, reservation-fee.server.ts):
 *   - The $100 charge row (payments: type fee, reason add_driver, notes
 *     add_driver:<request id>) is written BEFORE Stripe is called, with no
 *     rental_id so rent balance, Pay Now and reminders never pick it up.
 *   - One row per request. A paid row is never charged again. A still-open
 *     Checkout (under 23 hours) is reused.
 *   - Checkout only, never an off-session charge. The payments webhook marks
 *     the row paid (metadata.paymentIds) and then settleAddDriverPayment moves
 *     the request to Paid. Reads also catch up a request whose row is paid.
 *   - A declined card inside Checkout is not a failed rent payment: the
 *     webhook leaves the row owed and the rental untouched.
 *
 * Insurance: nothing here contacts an insurer. Staff (Manager+) start the
 * insurance step, then record Approved with the insurance card, or Denied
 * with a note. A refund after a denial is a staff action in Payments.
 *
 * Sends nothing to anyone.
 */
import {
  ADD_DRIVER_CHECKOUT_TTL_MS,
  ADD_DRIVER_CONSENT_VERSION,
  ADD_DRIVER_DIFFERENT_ADDRESS,
  ADD_DRIVER_FEE_CENTS,
  ADD_DRIVER_MAX_BYTES,
  ADD_DRIVER_NO_ADDRESS,
  ADD_DRIVER_NO_RENTAL,
  ADD_DRIVER_REASON,
  ADD_DRIVER_SWITCH_KEY,
  addDriverFormError,
  addDriverPaymentNote,
  addDriverUploadPath,
  canMoveAddDriver,
  compareHouseholdAddress,
  formAddress,
  householdAddressKey,
  isAddDriverStatus,
  ownAddDriverPath,
  renterView,
  staffQueueRank,
  type AddDriverForm,
  type AddDriverRequest,
  type AddDriverStatus,
  type RenterAddDriverRequest,
} from "@/lib/add-driver-requests";
import {
  addressFromApplication,
  normalizeUsState,
  normalizeZip,
  type AddressParts,
} from "@/lib/driver-addresses";

type Admin = any;
type StripeLike = any;
type Gate = "send" | "off" | "held";
type StaffActor = { userId: string; email?: string | null };

export const ADD_DRIVER_BUCKET = "driver-docs";
const COLS =
  "id,application_id,rental_id,status,full_name,dob,phone,email,relationship,address_line1,address_line2,city,state,zip,license_number,license_state,license_expiration,years_licensed,fee_cents,payment_id,paid_at,insurance_started_at,decided_at,decision_notes,insurance_card_path,refund_note,checkout_url,checkout_created_at,checkout_session_id,license_front_path,license_back_path,created_at";
const UPLOAD_TYPES = /^(image\/(jpeg|png|webp|heic|heif)|application\/pdf)$/;
const OPEN_LIMIT = 3;

export type AddDriverDeps = {
  gate?: (admin: Admin) => Promise<Gate>;
  stripe?: StripeLike | null;
  now?: () => number;
  audit?: (
    actor: StaffActor | null,
    e: { action: string; summary: string; entityId: string; metadata?: Record<string, unknown> },
  ) => Promise<void>;
  uuid?: () => string;
};

export class AddDriverError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "AddDriverError";
  }
}

async function defaultGate(admin: Admin): Promise<Gate> {
  const { loadAutomationControls, gateFor } = await import("@/lib/automation-controls.server");
  return gateFor(await loadAutomationControls(admin), ADD_DRIVER_SWITCH_KEY);
}

export async function addDriverGate(admin: Admin, deps: AddDriverDeps = {}): Promise<Gate> {
  try {
    return await (deps.gate ?? defaultGate)(admin);
  } catch {
    return "held";
  }
}

async function audit(
  deps: AddDriverDeps,
  actor: StaffActor | null,
  e: { action: string; summary: string; entityId: string; metadata?: Record<string, unknown> },
) {
  try {
    if (deps.audit) return await deps.audit(actor, e);
    const { logAudit } = await import("@/lib/audit.server");
    await logAudit(actor as any, {
      action: e.action,
      summary: e.summary,
      entityType: "additional_driver_request",
      entityId: e.entityId,
      metadata: e.metadata,
    });
  } catch {
    // An audit write never blocks the request.
  }
}

function easternToday(now: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(now));
}

export function mapRequest(
  r: any,
): AddDriverRequest & {
  licenseFrontPath: string | null;
  licenseBackPath: string | null;
  insuranceCardPath: string | null;
  checkoutUrl: string | null;
  checkoutCreatedAt: string | null;
} {
  const status: AddDriverStatus = isAddDriverStatus(r.status) ? r.status : "requested";
  return {
    id: String(r.id),
    applicationId: String(r.application_id),
    rentalId: r.rental_id ?? null,
    status,
    fullName: String(r.full_name ?? ""),
    dob: r.dob ? String(r.dob).slice(0, 10) : "",
    phone: String(r.phone ?? ""),
    email: String(r.email ?? ""),
    relationship: String(r.relationship ?? ""),
    address: {
      line1: r.address_line1 ?? null,
      line2: r.address_line2 ?? null,
      city: r.city ?? null,
      state: r.state ?? null,
      zip: r.zip ?? null,
    },
    licenseNumber: String(r.license_number ?? ""),
    licenseState: String(r.license_state ?? ""),
    licenseExpiration: r.license_expiration ? String(r.license_expiration).slice(0, 10) : "",
    yearsLicensed: r.years_licensed == null ? null : Number(r.years_licensed),
    feeCents: Number(r.fee_cents ?? ADD_DRIVER_FEE_CENTS),
    paymentId: r.payment_id ?? null,
    paidAt: r.paid_at ?? null,
    insuranceStartedAt: r.insurance_started_at ?? null,
    decidedAt: r.decided_at ?? null,
    decisionNotes: r.decision_notes ?? null,
    hasInsuranceCard: !!r.insurance_card_path,
    refundNote: r.refund_note ?? null,
    createdAt: String(r.created_at ?? ""),
    licenseFrontPath: r.license_front_path ?? null,
    licenseBackPath: r.license_back_path ?? null,
    insuranceCardPath: r.insurance_card_path ?? null,
    checkoutUrl: r.checkout_url ?? null,
    checkoutCreatedAt: r.checkout_created_at ?? null,
  };
}

export function addDriverDbMessage(message: unknown): string | null {
  const m = String(message ?? "");
  if (/additional_driver_requests/.test(m) && /does not exist|schema cache|could not find/i.test(m))
    return "Add Driver is not set up on this database yet.";
  if (/add_driver_request_bad_step|add_driver_request_closed/.test(m))
    return "This request can't move to that step.";
  if (/add_driver_request_approve_needs_card/.test(m))
    return "Upload the insurance card before approving.";
  if (/add_driver_request_deny_needs_note/.test(m)) return "Add a note before denying.";
  if (/add_driver_request_needs_staff/.test(m)) return "Only staff can start the insurance step.";
  return null;
}

// ---- Renter side --------------------------------------------------------------

export type RenterContext = {
  app: {
    id: string;
    full_name: string | null;
    email: string | null;
    phone: string | null;
    stripe_customer_id: string | null;
  };
  rental: { id: string; vehicle_id: string | null } | null;
  mainAddress: AddressParts | null;
};

export async function renterContext(admin: Admin, userId: string): Promise<RenterContext | null> {
  const { data: app } = await admin
    .from("applications")
    .select("id,full_name,email,phone,stripe_customer_id,address,city,state,zip")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!app?.id) return null;
  const { data: rental } = await admin
    .from("rentals")
    .select("id,vehicle_id")
    .eq("application_id", app.id)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return {
    app: {
      id: String(app.id),
      full_name: app.full_name ?? null,
      email: app.email ?? null,
      phone: app.phone ?? null,
      stripe_customer_id: app.stripe_customer_id ?? null,
    },
    rental: rental?.id ? { id: String(rental.id), vehicle_id: rental.vehicle_id ?? null } : null,
    mainAddress: addressFromApplication(app),
  };
}

async function signedUrl(admin: Admin, path: string | null | undefined): Promise<string | null> {
  if (!path) return null;
  try {
    const { data } = await admin.storage.from(ADD_DRIVER_BUCKET).createSignedUrl(path, 600);
    return data?.signedUrl ?? null;
  } catch {
    return null;
  }
}

/**
 * A request still on Requested whose $100 row is already paid (the webhook's
 * request update was missed) moves to Paid here. Same conditional update as
 * the webhook, so running both is harmless.
 */
export async function catchUpPaidRequests(
  admin: Admin,
  rows: any[],
  deps: AddDriverDeps = {},
): Promise<any[]> {
  const waiting = rows.filter((r) => r.status === "requested" && r.payment_id);
  if (!waiting.length) return rows;
  const { data: pays } = await admin
    .from("payments")
    .select("id,status")
    .in(
      "id",
      waiting.map((r) => r.payment_id),
    );
  const paid = new Set(
    ((pays ?? []) as any[]).filter((p) => p.status === "paid").map((p) => String(p.id)),
  );
  const out = [...rows];
  for (let i = 0; i < out.length; i++) {
    const r = out[i];
    if (r.status !== "requested" || !paid.has(String(r.payment_id))) continue;
    const moved = await markRequestPaid(admin, r.id, r.payment_id, r.rental_id ?? null, deps);
    if (moved) out[i] = { ...r, status: "paid", paid_at: moved };
  }
  return out;
}

async function markRequestPaid(
  admin: Admin,
  requestId: string,
  paymentId: string,
  rentalId: string | null,
  deps: AddDriverDeps,
): Promise<string | null> {
  const at = new Date(deps.now?.() ?? Date.now()).toISOString();
  const { data, error } = await admin
    .from("additional_driver_requests")
    .update({ status: "paid", paid_at: at })
    .eq("id", requestId)
    .eq("status", "requested")
    .eq("payment_id", paymentId)
    .select("id");
  if (error || !data?.length) return null;
  if (rentalId) {
    // Paid money belongs to the rental for revenue. Owed, it stayed off the rent balance.
    await admin
      .from("payments")
      .update({ rental_id: rentalId })
      .eq("id", paymentId)
      .is("rental_id", null);
  }
  await audit(deps, null, {
    action: "add_driver.paid",
    summary: "Add Driver $100 paid. Waiting for staff to start the insurance step.",
    entityId: requestId,
    metadata: { payment_id: paymentId },
  });
  return at;
}

export type RenterAddDriverState = {
  enabled: boolean;
  canRequest: boolean;
  blocked: string | null;
  mainAddress: AddressParts | null;
  requests: RenterAddDriverRequest[];
};

export async function renterAddDriverState(
  admin: Admin,
  userId: string,
  deps: AddDriverDeps = {},
): Promise<RenterAddDriverState> {
  const gate = await addDriverGate(admin, deps);
  const ctx = await renterContext(admin, userId);
  if (!ctx)
    return {
      enabled: gate === "send",
      canRequest: false,
      blocked: null,
      mainAddress: null,
      requests: [],
    };
  const { data, error } = await admin
    .from("additional_driver_requests")
    .select(COLS)
    .eq("application_id", ctx.app.id)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error && !addDriverDbMessage(error.message)) throw new Error("Could not load your drivers.");
  const rows = await catchUpPaidRequests(admin, (data ?? []) as any[], deps);
  const requests: RenterAddDriverRequest[] = [];
  for (const raw of rows) {
    const r = mapRequest(raw);
    requests.push(
      renterView(r, r.status === "approved" ? await signedUrl(admin, r.insuranceCardPath) : null),
    );
  }
  const blocked =
    gate !== "send"
      ? null
      : !ctx.rental
        ? ADD_DRIVER_NO_RENTAL
        : !householdAddressKey(ctx.mainAddress)
          ? ADD_DRIVER_NO_ADDRESS
          : null;
  return {
    enabled: gate === "send",
    canRequest: gate === "send" && !blocked && !error,
    blocked,
    mainAddress: ctx.mainAddress,
    requests,
  };
}

async function requireOpen(
  admin: Admin,
  userId: string,
  deps: AddDriverDeps,
): Promise<RenterContext & { rental: { id: string; vehicle_id: string | null } }> {
  const gate = await addDriverGate(admin, deps);
  if (gate !== "send")
    throw new AddDriverError("Adding a driver isn't available right now.", "off");
  const ctx = await renterContext(admin, userId);
  if (!ctx) throw new AddDriverError("We couldn't find your account.", "no_application");
  if (!ctx.rental) throw new AddDriverError(ADD_DRIVER_NO_RENTAL, "no_rental");
  return ctx as any;
}

export async function createRenterUploadUrl(
  admin: Admin,
  userId: string,
  input: {
    kind: "license_front" | "license_back";
    fileName: string;
    mimeType: string;
    sizeBytes: number;
  },
  deps: AddDriverDeps = {},
) {
  const ctx = await requireOpen(admin, userId, deps);
  if (!UPLOAD_TYPES.test(input.mimeType))
    throw new AddDriverError("Upload a photo or a PDF.", "type");
  if (!(input.sizeBytes > 0) || input.sizeBytes > ADD_DRIVER_MAX_BYTES)
    throw new AddDriverError("Files must be under 15 MB.", "size");
  const path = addDriverUploadPath(
    ctx.app.id,
    input.kind,
    input.fileName,
    input.mimeType,
    (deps.uuid ?? (() => crypto.randomUUID()))(),
  );
  const { data, error } = await admin.storage.from(ADD_DRIVER_BUCKET).createSignedUploadUrl(path);
  if (error || !data) throw new AddDriverError("Could not start the upload.", "upload");
  return { bucket: ADD_DRIVER_BUCKET, path: String(data.path ?? path), token: String(data.token) };
}

export async function submitAddDriverRequest(
  admin: Admin,
  userId: string,
  form: AddDriverForm,
  deps: AddDriverDeps = {},
): Promise<RenterAddDriverRequest> {
  const ctx = await requireOpen(admin, userId, deps);
  const today = easternToday(deps.now?.() ?? Date.now());
  const problem = addDriverFormError(form, today);
  if (problem) throw new AddDriverError(problem, "form");
  if (
    !ownAddDriverPath(ctx.app.id, form.licenseFrontPath) ||
    !ownAddDriverPath(ctx.app.id, form.licenseBackPath)
  ) {
    throw new AddDriverError("Upload the license again.", "upload_path");
  }
  // Same household only, checked here on the server and again in the form.
  const same = compareHouseholdAddress(ctx.mainAddress, formAddress(form));
  if (same === "no_main_address")
    throw new AddDriverError(ADD_DRIVER_NO_ADDRESS, "no_main_address");
  if (same !== "same") throw new AddDriverError(ADD_DRIVER_DIFFERENT_ADDRESS, "different_address");

  const { data: open } = await admin
    .from("additional_driver_requests")
    .select("id,status,license_number")
    .eq("application_id", ctx.app.id)
    .in("status", ["requested", "paid", "insurance_pending"]);
  const openRows = (open ?? []) as any[];
  const lic = form.licenseNumber.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  if (
    openRows.some(
      (r) =>
        String(r.license_number ?? "")
          .replace(/[^A-Za-z0-9]/g, "")
          .toUpperCase() === lic,
    )
  ) {
    throw new AddDriverError("You already have a request open for this driver.", "duplicate");
  }
  if (openRows.length >= OPEN_LIMIT)
    throw new AddDriverError(
      "You have several requests open. We'll finish those first.",
      "too_many",
    );

  const { data, error } = await admin
    .from("additional_driver_requests")
    .insert({
      application_id: ctx.app.id,
      rental_id: ctx.rental.id,
      requested_by: userId,
      status: "requested",
      full_name: form.fullName.trim().replace(/\s+/g, " "),
      dob: form.dob,
      phone: form.phone.trim(),
      email: form.email.trim().toLowerCase(),
      relationship: form.relationship.trim(),
      address_line1: form.addressLine1.trim(),
      address_line2: form.addressLine2.trim() || null,
      city: form.city.trim(),
      state: normalizeUsState(form.state),
      zip: normalizeZip(form.zip),
      license_number: form.licenseNumber.trim().toUpperCase(),
      license_state: normalizeUsState(form.licenseState),
      license_expiration: form.licenseExpiration,
      years_licensed: form.yearsLicensed.trim() === "" ? null : Number(form.yearsLicensed),
      license_front_path: form.licenseFrontPath,
      license_back_path: form.licenseBackPath,
      consent_version: ADD_DRIVER_CONSENT_VERSION,
      fee_cents: ADD_DRIVER_FEE_CENTS,
    })
    .select(COLS)
    .single();
  if (error || !data)
    throw new AddDriverError(
      addDriverDbMessage(error?.message) ?? "Could not send your request.",
      "insert",
    );
  await audit(deps, null, {
    action: "add_driver.requested",
    summary: "Renter asked to add a driver from the Driver Portal.",
    entityId: String(data.id),
    metadata: { application_id: ctx.app.id, rental_id: ctx.rental.id },
  });
  return renterView(mapRequest(data), null);
}

async function stripeFor(deps: AddDriverDeps): Promise<StripeLike | null> {
  if (deps.stripe !== undefined) return deps.stripe;
  const { checkoutStripeEnv } = await import("@/lib/initial-payment.server");
  const env = checkoutStripeEnv();
  if (!env) return null;
  const { createStripeClient } = await import("@/lib/stripe.server");
  return createStripeClient(env);
}

export type AddDriverCheckoutResult =
  | { status: "checkout"; url: string; reused: boolean }
  | { status: "already_paid" }
  | { status: "processing" };

/** Charge metadata for the $100: rental_id, lead_id, reason add_driver, for_date, renter, plate. */
export async function addDriverChargeMetadata(
  admin: Admin,
  input: {
    rentalId: string;
    requestId: string;
    applicationId: string;
    paymentId: string;
    forDate: string;
  },
): Promise<Record<string, string>> {
  const { chargeMetadataForRental } = await import("@/lib/stripe-charge-metadata.server");
  const charge = await chargeMetadataForRental(
    admin,
    input.rentalId,
    ADD_DRIVER_REASON,
    input.forDate,
  );
  return {
    ...charge,
    applicationId: input.applicationId,
    paymentIds: input.paymentId,
    add_driver_request_id: input.requestId,
  };
}

export async function startAddDriverCheckout(
  admin: Admin,
  userId: string,
  requestId: string,
  deps: AddDriverDeps = {},
): Promise<AddDriverCheckoutResult> {
  const ctx = await requireOpen(admin, userId, deps);
  const { data: raw } = await admin
    .from("additional_driver_requests")
    .select(COLS)
    .eq("id", requestId)
    .maybeSingle();
  if (!raw || String(raw.application_id) !== ctx.app.id)
    throw new AddDriverError("Request not found.", "not_found");
  const [caught] = await catchUpPaidRequests(admin, [raw], deps);
  const req = mapRequest(caught);
  if (req.status !== "requested") return { status: "already_paid" };
  const rentalId = req.rentalId ?? ctx.rental.id;
  const amount = req.feeCents / 100;
  const now = deps.now?.() ?? Date.now();

  const note = addDriverPaymentNote(req.id);
  const { data: existing } = await admin
    .from("payments")
    .select("id,status,attempt_count")
    .eq("driver_id", ctx.app.id)
    .eq("notes", note)
    .limit(5);
  let row = ((existing ?? []) as any[]).find((p) => p.status !== "void") ?? null;
  if (row?.status === "paid") {
    await markRequestPaid(admin, req.id, row.id, rentalId, deps);
    return { status: "already_paid" };
  }
  if (row?.status === "pending") return { status: "processing" };
  if (
    row &&
    row.status === "unpaid" &&
    req.paymentId === row.id &&
    req.checkoutUrl &&
    req.checkoutCreatedAt
  ) {
    const created = Date.parse(req.checkoutCreatedAt);
    if (
      /^https:\/\//.test(req.checkoutUrl) &&
      Number.isFinite(created) &&
      now - created < ADD_DRIVER_CHECKOUT_TTL_MS
    ) {
      return { status: "checkout", url: req.checkoutUrl, reused: true };
    }
  }
  if (!row) {
    const ins = await admin
      .from("payments")
      .insert({
        driver_id: ctx.app.id,
        vehicle_id: ctx.rental.vehicle_id,
        type: "fee",
        reason: ADD_DRIVER_REASON,
        amount,
        balance_due: amount,
        status: "current",
        due_date: easternToday(now),
        notes: note,
      })
      .select("id,status,attempt_count")
      .single();
    if (ins.error || !ins.data)
      throw new AddDriverError("We couldn't start the payment. Try again.", "payment_row");
    row = ins.data;
  }
  if (req.paymentId !== row.id) {
    await admin
      .from("additional_driver_requests")
      .update({ payment_id: row.id })
      .eq("id", req.id)
      .eq("status", "requested");
  }

  const stripe = await stripeFor(deps);
  if (!stripe)
    throw new AddDriverError("Card payments aren't available right now. Contact us.", "no_stripe");
  const attempt = Number(row.attempt_count ?? 0) + 1;
  let meta: Record<string, string>;
  try {
    meta = await addDriverChargeMetadata(admin, {
      rentalId,
      requestId: req.id,
      applicationId: ctx.app.id,
      paymentId: row.id,
      forDate: easternToday(now),
    });
  } catch {
    throw new AddDriverError("We couldn't start the payment. Contact us.", "metadata");
  }
  const { withCheckoutChargeMetadata } = await import("@/lib/stripe-charge-metadata");
  let customer = ctx.app.stripe_customer_id;
  if (!customer) {
    const { ensureApplicationStripeCustomer } = await import("@/lib/stripe-link.server");
    customer = await ensureApplicationStripeCustomer(admin, stripe, ctx.app);
  }
  const { publicAppOrigin } = await import("@/lib/public-app-url");
  const site = publicAppOrigin();
  const session = await stripe.checkout.sessions.create(
    withCheckoutChargeMetadata(
      {
        mode: "payment",
        customer,
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: "usd",
              unit_amount: req.feeCents,
              product_data: {
                name: "Add Driver",
                description: `Request to add ${req.fullName} to your rental`,
              },
            },
          },
        ],
        payment_intent_data: { description: "Add Driver", metadata: meta },
        metadata: meta,
        success_url: `${site}/portal?add_driver=paid`,
        cancel_url: `${site}/portal?add_driver=canceled`,
        expires_at: Math.floor(now / 1000) + 23 * 3600,
      },
      meta,
      { kind: "rental" },
    ),
    { idempotencyKey: `add-driver-checkout:${row.id}:attempt:${attempt}` },
  );
  if (!session?.url)
    throw new AddDriverError("We couldn't start the payment. Try again.", "checkout");
  await admin
    .from("payments")
    .update({ status: "unpaid", attempt_count: attempt, failure_reason: null, balance_due: amount })
    .eq("id", row.id)
    .in("status", ["current", "failed", "unpaid"]);
  await admin
    .from("additional_driver_requests")
    .update({
      checkout_url: session.url,
      checkout_session_id: session.id ?? null,
      checkout_created_at: new Date(now).toISOString(),
    })
    .eq("id", req.id)
    .eq("status", "requested");
  return { status: "checkout", url: String(session.url), reused: false };
}

/**
 * Payments webhook hook, after payment_intent.succeeded has marked the row
 * paid. Only acts on intents this module created. Never throws.
 */
export async function settleAddDriverPayment(
  admin: Admin,
  pi: any,
  deps: AddDriverDeps = {},
): Promise<"settled" | "skipped"> {
  try {
    const m = pi?.metadata ?? {};
    if (m.reason !== ADD_DRIVER_REASON) return "skipped";
    const requestId = String(m.add_driver_request_id ?? "");
    const paymentId =
      String(m.paymentIds ?? "")
        .split(",")[0]
        ?.trim() ?? "";
    if (!/^[0-9a-f-]{36}$/i.test(requestId) || !/^[0-9a-f-]{36}$/i.test(paymentId))
      return "skipped";
    const { data: pay } = await admin
      .from("payments")
      .select("id,status")
      .eq("id", paymentId)
      .maybeSingle();
    if (pay?.status !== "paid") return "skipped";
    const { data: req } = await admin
      .from("additional_driver_requests")
      .select("id,status,payment_id,rental_id")
      .eq("id", requestId)
      .maybeSingle();
    if (!req || req.status !== "requested" || String(req.payment_id) !== paymentId)
      return "skipped";
    return (await markRequestPaid(admin, requestId, paymentId, req.rental_id ?? null, deps))
      ? "settled"
      : "skipped";
  } catch (e) {
    console.error("[add-driver] settle failed", e);
    return "skipped";
  }
}

// ---- Staff side ---------------------------------------------------------------

export type StaffAddDriverRequest = AddDriverRequest & {
  statusLabel: string;
  renterName: string | null;
  plate: string | null;
  paymentStatus: string | null;
};

export async function listStaffAddDriverRequests(
  admin: Admin,
  filter: { applicationId?: string; rentalId?: string; open?: boolean },
  deps: AddDriverDeps = {},
): Promise<StaffAddDriverRequest[]> {
  let q = admin
    .from("additional_driver_requests")
    .select(COLS)
    .order("created_at", { ascending: true })
    .limit(200);
  if (filter.applicationId) q = q.eq("application_id", filter.applicationId);
  if (filter.rentalId) q = q.eq("rental_id", filter.rentalId);
  if (filter.open) q = q.in("status", ["requested", "paid", "insurance_pending"]);
  const { data, error } = await q;
  if (error) {
    const known = addDriverDbMessage(error.message);
    if (known?.includes("not set up")) return [];
    throw new Error(known ?? "Could not load Add Driver requests.");
  }
  const rows = await catchUpPaidRequests(admin, (data ?? []) as any[], deps);
  const appIds = [...new Set(rows.map((r) => String(r.application_id)))];
  const rentalIds = [...new Set(rows.map((r) => r.rental_id).filter(Boolean))];
  const payIds = [...new Set(rows.map((r) => r.payment_id).filter(Boolean))];
  const [apps, rentals, pays] = await Promise.all([
    appIds.length
      ? admin.from("applications").select("id,full_name").in("id", appIds)
      : { data: [] },
    rentalIds.length
      ? admin
          .from("rentals")
          .select("id,vehicle_id,vehicles:vehicle_id(license_plate)")
          .in("id", rentalIds)
      : { data: [] },
    payIds.length ? admin.from("payments").select("id,status").in("id", payIds) : { data: [] },
  ]);
  const names = new Map(
    ((apps?.data ?? []) as any[]).map((a) => [String(a.id), a.full_name ?? null]),
  );
  const plates = new Map(
    ((rentals?.data ?? []) as any[]).map((r) => [String(r.id), r.vehicles?.license_plate ?? null]),
  );
  const payStatus = new Map(
    ((pays?.data ?? []) as any[]).map((p) => [String(p.id), String(p.status)]),
  );
  const { ADD_DRIVER_STATUS_LABEL } = await import("@/lib/add-driver-requests");
  return rows
    .map((raw) => {
      const r = mapRequest(raw);
      const {
        licenseFrontPath: _f,
        licenseBackPath: _b,
        insuranceCardPath: _c,
        checkoutUrl: _u,
        checkoutCreatedAt: _t,
        ...rest
      } = r;
      return {
        ...rest,
        statusLabel: ADD_DRIVER_STATUS_LABEL[r.status],
        renterName: names.get(r.applicationId) ?? null,
        plate: r.rentalId ? (plates.get(r.rentalId) ?? null) : null,
        paymentStatus: r.paymentId ? (payStatus.get(r.paymentId) ?? null) : null,
      };
    })
    .sort(
      (a, b) =>
        staffQueueRank(a.status) - staffQueueRank(b.status) ||
        a.createdAt.localeCompare(b.createdAt),
    );
}

async function loadForStaff(admin: Admin, id: string) {
  const { data } = await admin
    .from("additional_driver_requests")
    .select(COLS)
    .eq("id", id)
    .maybeSingle();
  if (!data) throw new AddDriverError("Request not found.", "not_found");
  return mapRequest(data);
}

export async function staffAddDriverFileUrl(
  admin: Admin,
  id: string,
  kind: "license_front" | "license_back" | "insurance_card",
): Promise<string> {
  const r = await loadForStaff(admin, id);
  const path =
    kind === "license_front"
      ? r.licenseFrontPath
      : kind === "license_back"
        ? r.licenseBackPath
        : r.insuranceCardPath;
  const url = await signedUrl(admin, path);
  if (!url) throw new AddDriverError("File not found.", "no_file");
  return url;
}

async function moveRequest(
  admin: Admin,
  actor: StaffActor,
  id: string,
  to: AddDriverStatus,
  patch: Record<string, unknown>,
  deps: AddDriverDeps,
  summary: string,
) {
  const r = await loadForStaff(admin, id);
  if (!canMoveAddDriver(r.status, to))
    throw new AddDriverError("This request can't move to that step.", "bad_step");
  const { data, error } = await admin
    .from("additional_driver_requests")
    .update({ status: to, ...patch })
    .eq("id", id)
    .eq("status", r.status)
    .select("id");
  if (error)
    throw new AddDriverError(
      addDriverDbMessage(error.message) ?? "Could not update this request.",
      "update",
    );
  if (!data?.length)
    throw new AddDriverError("This request changed. Refresh and try again.", "stale");
  await audit(deps, actor, {
    action: `add_driver.${to}`,
    summary,
    entityId: id,
    metadata: { from: r.status, to },
  });
  return { ok: true as const };
}

export async function startAddDriverInsurance(
  admin: Admin,
  actor: StaffActor,
  id: string,
  deps: AddDriverDeps = {},
) {
  const at = new Date(deps.now?.() ?? Date.now()).toISOString();
  return moveRequest(
    admin,
    actor,
    id,
    "insurance_pending",
    { insurance_started_at: at, insurance_started_by: actor.userId },
    deps,
    "Staff started the insurance step for an added driver.",
  );
}

export async function createInsuranceCardUploadUrl(
  admin: Admin,
  actor: StaffActor,
  id: string,
  input: { fileName: string; mimeType: string; sizeBytes: number },
  deps: AddDriverDeps = {},
) {
  void actor;
  const r = await loadForStaff(admin, id);
  if (r.status !== "insurance_pending")
    throw new AddDriverError("Start the insurance step first.", "bad_step");
  if (!UPLOAD_TYPES.test(input.mimeType))
    throw new AddDriverError("Upload a photo or a PDF.", "type");
  if (!(input.sizeBytes > 0) || input.sizeBytes > ADD_DRIVER_MAX_BYTES)
    throw new AddDriverError("Files must be under 15 MB.", "size");
  const path = addDriverUploadPath(
    r.applicationId,
    "insurance_card",
    input.fileName,
    input.mimeType,
    (deps.uuid ?? (() => crypto.randomUUID()))(),
  );
  const { data, error } = await admin.storage.from(ADD_DRIVER_BUCKET).createSignedUploadUrl(path);
  if (error || !data) throw new AddDriverError("Could not start the upload.", "upload");
  return { bucket: ADD_DRIVER_BUCKET, path: String(data.path ?? path), token: String(data.token) };
}

export async function approveAddDriverRequest(
  admin: Admin,
  actor: StaffActor,
  id: string,
  input: { insuranceCardPath: string; notes?: string | null },
  deps: AddDriverDeps = {},
) {
  const r = await loadForStaff(admin, id);
  const card = input.insuranceCardPath;
  if (!ownAddDriverPath(r.applicationId, card) || !/\/insurance_card-/.test(card))
    throw new AddDriverError("Upload the insurance card before approving.", "no_card");
  const at = new Date(deps.now?.() ?? Date.now()).toISOString();
  return moveRequest(
    admin,
    actor,
    id,
    "approved",
    {
      decided_at: at,
      decided_by: actor.userId,
      decision_notes: input.notes?.trim() || null,
      insurance_card_path: card,
      insurance_card_uploaded_at: at,
      insurance_card_uploaded_by: actor.userId,
    },
    deps,
    "Staff approved an added driver and filed their insurance card.",
  );
}

export async function denyAddDriverRequest(
  admin: Admin,
  actor: StaffActor,
  id: string,
  input: { notes: string; refundNote?: string | null },
  deps: AddDriverDeps = {},
) {
  const notes = String(input.notes ?? "").trim();
  if (!notes) throw new AddDriverError("Add a note before denying.", "no_note");
  const at = new Date(deps.now?.() ?? Date.now()).toISOString();
  const before = await loadForStaff(admin, id);
  const result = await moveRequest(
    admin,
    actor,
    id,
    "denied",
    {
      decided_at: at,
      decided_by: actor.userId,
      decision_notes: notes,
      refund_note: input.refundNote?.trim() || null,
    },
    deps,
    "Staff denied an added driver. Any refund is a separate staff action.",
  );
  // Not paid yet: the $100 is no longer owed, and its open Checkout is closed so it can't be paid.
  if (before.status === "requested") {
    if (before.paymentId) {
      await admin
        .from("payments")
        .update({ status: "void", balance_due: 0 })
        .eq("id", before.paymentId)
        .in("status", ["current", "unpaid", "failed"]);
    }
    if (before.checkoutUrl) {
      try {
        const { data: s } = await admin
          .from("additional_driver_requests")
          .select("checkout_session_id")
          .eq("id", id)
          .maybeSingle();
        const stripe = s?.checkout_session_id ? await stripeFor(deps) : null;
        if (stripe && s?.checkout_session_id)
          await stripe.checkout.sessions.expire(String(s.checkout_session_id));
      } catch {
        // Already expired or paid. Staff see the payment status on the request.
      }
    }
  }
  return result;
}
