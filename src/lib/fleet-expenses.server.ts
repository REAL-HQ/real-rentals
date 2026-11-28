/**
 * FLEET vehicle expenses (Dolmar, 11/27 7:29 PM ET: "Make the api add expenses").
 *
 *   POST /api/public/fleet/vehicle-expenses        create one expense
 *   GET  /api/public/fleet/vehicle-expenses        list a vehicle's expenses
 *   POST /api/public/fleet/vehicle-expenses-list   same list, JSON body
 *
 * Writes the same vehicle_expenses table Back Office → Expenses reads and
 * writes, so an entry shows there at once. A receipt is stored exactly the way
 * that screen stores one: private `receipts` bucket, path
 * `<vehicle_id>/<time>-<random>.<ext>`, with receipt_path, receipt_name and
 * receipt_mime on the expense row.
 *
 * Bearer FLEET_API_KEY (src/lib/fleet-api.server.ts). Create is Off until
 * Automations → Expenses (FLEET) (fleet_expenses) is On; listing stays
 * available while it is Off. Every create is audited as "FLEET (automated)"
 * (action expense.fleet_created). Sends nothing to anyone and touches no
 * rental, payment or billing record.
 *
 * Idempotency: the key is kept on the audit row. The same key and the same
 * request returns the original (200, duplicate: true); the same key with
 * anything different is a 409 and nothing is saved. A likely duplicate (same
 * vehicle, date, amount and vendor, or the same invoice number) never blocks
 * the save; it is reported in duplicate_warnings.
 */
import { decodeBase64, sniffType } from "@/lib/fleet-document.server";
import {
  cleanText,
  fleetAdmin,
  fleetAudit,
  fleetAuthOnly,
  fleetJson,
  fleetRequestBody,
  idempotencyKey,
  type FleetDeps,
} from "@/lib/fleet-api.server";
import { fleetVehicleRef, resolveFleetVehicle } from "@/lib/fleet-vehicle-lookup.server";
import { FLEET_ACTOR_LABEL } from "@/lib/fleet-review";
import { vendorKey } from "@/lib/maintenance-rules";
import { businessToday } from "@/lib/vehicle-maintenance";
import {
  composeExpenseNotes,
  expenseFingerprintText,
  FLEET_EXPENSE_NOTE_TAG,
  FLEET_EXPENSES_KEY,
  findDuplicateExpenses,
  invoiceKey,
  parseExpenseCreate,
  parseExpenseListQuery,
  vendorFromNotes,
} from "@/lib/fleet-expenses";

type Admin = any;

export const FLEET_EXPENSE_AUDIT_ACTION = "expense.fleet_created";
export const FLEET_RECEIPT_MAX_BYTES = 20 * 1024 * 1024;
export const RECEIPTS_BUCKET = "receipts";

export type ExpenseDeps = FleetDeps & {
  gate?: (admin: Admin, key: string) => Promise<"send" | "off" | "held">;
  today?: () => string;
};

async function defaultGate(admin: Admin, key: string) {
  const { loadAutomationControls, gateFor } = await import("@/lib/automation-controls.server");
  return gateFor(await loadAutomationControls(admin), key);
}

async function sha256Hex(input: Uint8Array | string): Promise<string> {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  const d = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  return Array.from(new Uint8Array(d), (x) => x.toString(16).padStart(2, "0")).join("");
}

const EXPENSE_COLUMNS =
  "id,vehicle_id,incurred_on,amount,category,description,vendor_id,reference,notes,payment_method,is_recurring,receipt_path,receipt_name,receipt_mime,created_by,created_at";

/** ilike pattern that finds an invoice number whatever its spacing or punctuation ("INV 1001" for "INV-1001"); the exact comparison is findDuplicateExpenses'. */
const invoicePattern = (invoice: string) => `%${[...invoiceKey(invoice)].join("%")}%`;

function createdBy(row: { created_by?: string | null; notes?: string | null }): "FLEET" | "Staff" | null {
  if (String(row.notes ?? "").split("\n").some((l) => l.trim() === FLEET_EXPENSE_NOTE_TAG)) return "FLEET";
  return row.created_by ? "Staff" : null;
}

function expenseOut(row: any, vendorName: string | null, vehicle?: ReturnType<typeof fleetVehicleRef>) {
  return {
    id: row.id as string,
    ...(vehicle ?? { vehicle_id: row.vehicle_id as string }),
    date: row.incurred_on as string,
    amount: Number(row.amount),
    category: row.category as string,
    vendor: vendorName,
    description: row.description as string,
    invoice_number: (row.reference as string | null) ?? null,
    payment_method: (row.payment_method as string | null) ?? null,
    has_receipt: !!row.receipt_path,
    receipt_name: (row.receipt_name as string | null) ?? null,
    created_by: createdBy(row),
    created_at: row.created_at as string,
  };
}

async function vendorNames(admin: Admin, ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const uniq = [...new Set(ids.filter(Boolean))];
  for (let i = 0; i < uniq.length; i += 100) {
    const res = await admin.from("vendors").select("id,name").in("id", uniq.slice(i, i + 100));
    if (res.error) throw new Error("vendors_unreadable");
    for (const v of (res.data ?? []) as Array<{ id: string; name: string }>) out.set(v.id, v.name);
  }
  return out;
}

/** The Vendors-list entry with exactly this name (ignoring case, spaces and punctuation), or null. Never creates one. */
async function matchVendor(admin: Admin, name: string | null): Promise<{ id: string; name: string } | null> {
  const key = vendorKey(name);
  if (key.length < 3) return null;
  const res = await admin.from("vendors").select("id,name").eq("name_key", key).limit(2);
  if (res.error) throw new Error("vendors_unreadable");
  const rows = (res.data ?? []) as Array<{ id: string; name: string }>;
  return rows.length === 1 ? rows[0] : null;
}

async function priorAudit(admin: Admin, col: string, val: string) {
  const res = await admin
    .from("audit_log")
    .select("entity_id,metadata")
    .eq("action", FLEET_EXPENSE_AUDIT_ACTION)
    .eq(col, val)
    .limit(5);
  if (res.error) throw new Error("audit_unreadable");
  return (res.data ?? []) as Array<{ entity_id: string | null; metadata: any }>;
}

export async function handleFleetExpenseCreate(request: Request, deps: ExpenseDeps = {}): Promise<Response> {
  const parsed = await fleetRequestBody(request, deps);
  if ("response" in parsed) return parsed.response;
  const body = parsed.body;
  const admin = await fleetAdmin(deps);
  const audit = fleetAudit(deps);

  const gate = await (deps.gate ?? defaultGate)(admin, FLEET_EXPENSES_KEY).catch(() => "held" as const);
  if (gate === "off")
    return fleetJson(409, {
      ok: false,
      error: "The Expenses (FLEET) switch is Off (Back Office → Automations). Nothing was saved.",
      reason: "switched_off",
    });
  if (gate !== "send")
    return fleetJson(503, { ok: false, error: "Automation switches could not be read; try again later. Nothing was saved.", reason: "controls_unreadable" });

  const today = (deps.today ?? (() => businessToday()))();
  const input = parseExpenseCreate(body, today);
  if (!input.ok) return fleetJson(input.status, { ok: false, error: input.error });
  const idem = idempotencyKey(body.idempotency_key);
  if (idem === "invalid") return fleetJson(400, { ok: false, error: "idempotency_key must be 1-120 characters." });

  // Receipt (optional): PDF, JPEG, PNG, WebP or HEIC, judged by its bytes.
  let receipt: { bytes: Uint8Array; mime: string; ext: string; name: string; sha: string } | null = null;
  if (body.receipt_base64 != null && body.receipt_base64 !== "") {
    if (typeof body.receipt_base64 === "string" && body.receipt_base64.length > Math.ceil(FLEET_RECEIPT_MAX_BYTES / 3) * 4 + 200)
      return fleetJson(413, { ok: false, error: "The receipt is over 20 MB. Nothing was saved." });
    const bytes = decodeBase64(body.receipt_base64);
    if (!bytes || !bytes.length) return fleetJson(400, { ok: false, error: "receipt_base64 must be the receipt file, base64-encoded." });
    if (bytes.length > FLEET_RECEIPT_MAX_BYTES) return fleetJson(413, { ok: false, error: "The receipt is over 20 MB. Nothing was saved." });
    const type = sniffType(bytes);
    if (!type) return fleetJson(415, { ok: false, error: "A receipt must be a PDF, JPEG, PNG, WebP or HEIC file. Nothing was saved." });
    const name = cleanText(body.receipt_file_name, 200).replace(/[\\/\u0000-\u001f]/g, "_") || `receipt.${type.ext}`;
    receipt = { bytes, mime: type.mime, ext: type.ext, name, sha: await sha256Hex(bytes) };
  } else if (body.receipt_file_name != null && body.receipt_file_name !== "") {
    return fleetJson(400, { ok: false, error: "receipt_file_name was sent without receipt_base64." });
  }

  const found = await resolveFleetVehicle(admin, body);
  if ("response" in found) return found.response;
  const vehicle = found.vehicle;
  const ref = fleetVehicleRef(vehicle);
  const value = input.value;

  let vendor: { id: string; name: string } | null = null;
  try {
    vendor = await matchVendor(admin, value.vendor);
  } catch {
    return fleetJson(503, { ok: false, error: "Could not read the vendors list. Nothing was saved." });
  }

  const fingerprint = await sha256Hex(expenseFingerprintText({ vehicleId: vehicle.id, value, receiptSha256: receipt?.sha ?? null }));

  // Same key: the original, or a refusal when the request is different.
  if (idem) {
    let hit: Awaited<ReturnType<typeof priorAudit>>[number] | undefined;
    try {
      hit = (await priorAudit(admin, "metadata->>idempotency_key", idem))[0];
    } catch {
      return fleetJson(503, { ok: false, error: "Could not check for an earlier copy. Nothing was saved." });
    }
    if (hit) {
      const m = hit.metadata ?? {};
      if (m.fingerprint !== fingerprint)
        return fleetJson(409, { ok: false, error: "idempotency_key was already used for a different expense. Nothing was saved.", reason: "idempotency_key_reused", expense_id: m.expense_id ?? hit.entity_id ?? null });
      const id = (m.expense_id ?? hit.entity_id) as string | null;
      let row: any = null;
      if (id) {
        const res = await admin.from("vehicle_expenses").select(EXPENSE_COLUMNS).eq("id", id).maybeSingle();
        if (res.error) return fleetJson(503, { ok: false, error: "Could not read the original expense." });
        row = res.data;
      }
      if (!row)
        return fleetJson(200, { ok: true, duplicate: true, matched_by: "idempotency_key", expense_id: id, expense: null, deleted: true, note: "This request was saved before, and that expense has since been removed in Back Office. Nothing was saved again." });
      let vname: string | null = null;
      try {
        vname = row.vendor_id ? ((await vendorNames(admin, [row.vendor_id])).get(row.vendor_id) ?? null) : vendorFromNotes(row.notes);
      } catch {
        vname = vendorFromNotes(row.notes);
      }
      return fleetJson(200, { ok: true, duplicate: true, matched_by: "idempotency_key", expense: expenseOut(row, vname, ref) });
    }
  }

  // Likely duplicates (warn only).
  const warnings: string[] = [];
  let dupes: ReturnType<typeof findDuplicateExpenses> = [];
  try {
    const rows = new Map<string, any>();
    const same = await admin
      .from("vehicle_expenses")
      .select("id,vehicle_id,incurred_on,amount,vendor_id,reference,notes")
      .eq("vehicle_id", vehicle.id)
      .eq("incurred_on", value.date)
      .eq("amount", value.amount)
      .limit(25);
    if (same.error) throw new Error("unreadable");
    for (const r of same.data ?? []) rows.set(r.id, r);
    if (value.invoiceNumber) {
      const inv = await admin
        .from("vehicle_expenses")
        .select("id,vehicle_id,incurred_on,amount,vendor_id,reference,notes")
        .ilike("reference", invoicePattern(value.invoiceNumber))
        .limit(100);
      if (inv.error) throw new Error("unreadable");
      for (const r of inv.data ?? []) rows.set(r.id, r);
    }
    const list = [...rows.values()];
    const names = await vendorNames(admin, list.map((r) => r.vendor_id).filter(Boolean));
    dupes = findDuplicateExpenses(
      list,
      { vehicleId: vehicle.id, date: value.date, amount: value.amount, vendorId: vendor?.id ?? null, vendorName: value.vendor, invoiceNumber: value.invoiceNumber },
      (id) => names.get(id) ?? null,
    );
  } catch {
    warnings.push("duplicate_check_unavailable");
  }
  if (receipt) {
    try {
      const same = (await priorAudit(admin, "metadata->>receipt_sha256", receipt.sha)).filter((r) => r.metadata?.vehicle_id === vehicle.id);
      for (const s of same) warnings.push(`same_receipt_file_already_on:${s.metadata?.expense_id ?? s.entity_id}`);
    } catch {
      /* warning only */
    }
  }

  // Receipt first (same path shape as Back Office), then the row; a failed row removes the file.
  let receiptPath: string | null = null;
  if (receipt) {
    receiptPath = `${vehicle.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${receipt.ext}`;
    const up = await admin.storage.from(RECEIPTS_BUCKET).upload(receiptPath, receipt.bytes, { contentType: receipt.mime, upsert: false });
    if (up?.error) return fleetJson(503, { ok: false, error: "Could not store the receipt. Nothing was saved." });
  }
  const notes = composeExpenseNotes({ vendorUnmatched: value.vendor && !vendor ? value.vendor : null, notes: value.notes });
  const ins = await admin
    .from("vehicle_expenses")
    .insert({
      vehicle_id: vehicle.id,
      rental_id: null,
      vendor_id: vendor?.id ?? null,
      category: value.category,
      description: value.description,
      amount: value.amount,
      incurred_on: value.date,
      payment_method: value.paymentMethod,
      reference: value.invoiceNumber,
      receipt_path: receiptPath,
      receipt_name: receipt?.name ?? null,
      receipt_mime: receipt?.mime ?? null,
      is_recurring: value.isRecurring,
      notes,
      created_by: null,
    })
    .select(EXPENSE_COLUMNS)
    .single();
  if (ins.error || !ins.data) {
    if (receiptPath) await admin.storage.from(RECEIPTS_BUCKET).remove([receiptPath]).catch(() => undefined);
    return fleetJson(503, { ok: false, error: "Could not save the expense. Nothing was saved." });
  }
  const row = ins.data;

  try {
    await audit({
      action: FLEET_EXPENSE_AUDIT_ACTION,
      summary: `${FLEET_ACTOR_LABEL} recorded $${value.amount.toFixed(2)} ${value.category} on ${ref.license_plate ?? "a vehicle"} (${value.description})`.slice(0, 300),
      entityType: "vehicle_expense",
      entityId: row.id,
      metadata: {
        actor: FLEET_ACTOR_LABEL,
        expense_id: row.id,
        vehicle_id: vehicle.id,
        category: value.category,
        amount: value.amount,
        date: value.date,
        vendor: value.vendor,
        vendor_id: vendor?.id ?? null,
        invoice_number: value.invoiceNumber,
        has_receipt: !!receiptPath,
        receipt_sha256: receipt?.sha ?? null,
        idempotency_key: idem,
        fingerprint,
        duplicate_warnings: dupes.map((d) => d.expense_id),
      },
    });
  } catch {
    warnings.push("audit_not_recorded");
  }

  return fleetJson(201, {
    ok: true,
    duplicate: false,
    expense: expenseOut(row, vendor?.name ?? value.vendor, ref),
    vendor_matched: value.vendor ? !!vendor : null,
    duplicate_warnings: dupes,
    warnings,
    next: "Saved to Back Office → Expenses.",
  });
}

export async function handleFleetExpenseList(request: Request, deps: ExpenseDeps = {}): Promise<Response> {
  let params: Record<string, unknown>;
  if (request.method === "GET") {
    const denied = await fleetAuthOnly(request, deps);
    if (denied) return denied;
    params = Object.fromEntries(new URL(request.url).searchParams.entries());
  } else {
    const parsed = await fleetRequestBody(request, deps, ["POST"]);
    if ("response" in parsed) return parsed.response;
    params = parsed.body;
  }
  const q = parseExpenseListQuery(params);
  if (!q.ok) return fleetJson(q.status, { ok: false, error: q.error });
  const admin = await fleetAdmin(deps);
  const found = await resolveFleetVehicle(admin, params, { allowArchived: true });
  if ("response" in found) return found.response;
  const vehicle = found.vehicle;

  let query = admin.from("vehicle_expenses").select(EXPENSE_COLUMNS).eq("vehicle_id", vehicle.id);
  if (q.value.from) query = query.gte("incurred_on", q.value.from);
  if (q.value.to) query = query.lte("incurred_on", q.value.to);
  const res = await query.order("incurred_on", { ascending: false }).order("created_at", { ascending: false }).limit(q.value.limit + 1);
  if (res.error) return fleetJson(503, { ok: false, error: "Could not read the expenses." });
  const all = (res.data ?? []) as any[];
  const truncated = all.length > q.value.limit;
  const rows = all.slice(0, q.value.limit);
  let names = new Map<string, string>();
  try {
    names = await vendorNames(admin, rows.map((r) => r.vendor_id).filter(Boolean));
  } catch {
    return fleetJson(503, { ok: false, error: "Could not read the vendors list." });
  }
  const expenses = rows.map((r) => {
    const o = expenseOut(r, r.vendor_id ? (names.get(r.vendor_id) ?? null) : vendorFromNotes(r.notes));
    const { vehicle_id: _v, ...rest } = o as any;
    return rest;
  });
  const cents = rows.reduce((n, r) => n + Math.round(Number(r.amount) * 100), 0);
  return fleetJson(200, {
    ok: true,
    vehicle: { ...fleetVehicleRef(vehicle), archived: !!vehicle.archived_at },
    from: q.value.from,
    to: q.value.to,
    count: expenses.length,
    total_amount: cents / 100,
    truncated,
    expenses,
  });
}
