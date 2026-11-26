// Reading and saving the forfeited-fee credit policy. Service role, so the
// caller has already checked the staff tier. A missing row or a missing table
// is the default (case by case, 90 days): the late-pickup job must not invent
// an automatic credit because settings could not be read.

import {
  DEFAULT_FORFEITED_FEE_CREDIT,
  FORFEITED_FEE_CREDIT_KEY,
  keptFeeOffers,
  readForfeitedFeeCreditSettings,
  type CancelledRentalCredit,
  type ForfeitedFeeCreditSettings,
  type KeptFeeOffer,
} from "@/lib/forfeited-fee-credit";

type Admin = {
  from: (table: string) => any;
};

export async function loadForfeitedFeeCreditSettings(admin: Admin): Promise<ForfeitedFeeCreditSettings> {
  try {
    const { data, error } = await admin.from("app_settings").select("value").eq("key", FORFEITED_FEE_CREDIT_KEY).maybeSingle();
    if (error || !data) return DEFAULT_FORFEITED_FEE_CREDIT;
    return readForfeitedFeeCreditSettings((data as { value?: unknown }).value);
  } catch {
    return DEFAULT_FORFEITED_FEE_CREDIT;
  }
}

export async function saveForfeitedFeeCreditSettings(
  admin: Admin,
  settings: ForfeitedFeeCreditSettings,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const value = readForfeitedFeeCreditSettings(settings);
  const { error } = await admin.from("app_settings").upsert(
    {
      key: FORFEITED_FEE_CREDIT_KEY,
      value,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "key" },
  );
  if (error) return { ok: false, error: "Could Not Save The Credit Policy." };
  return { ok: true };
}

/** Kept fees on this page that still have no non-void credit. */
export async function loadKeptFeeOffers(admin: Admin, rentalIds: readonly string[]): Promise<{
  settings: ForfeitedFeeCreditSettings;
  offers: KeptFeeOffer[];
}> {
  const settings = await loadForfeitedFeeCreditSettings(admin);
  if (!rentalIds.length) return { settings, offers: [] };
  try {
    const pays = await admin
      .from("payments")
      .select("id,reason,status,notes,rental_id")
      .eq("reason", "reservation_fee")
      .eq("status", "paid")
      .ilike("notes", "%kept:%")
      .limit(500);
    if (pays.error) return { settings, offers: [] };
    const payments = ((pays.data ?? []) as Array<Record<string, unknown>>).map((row) => ({
      id: String(row.id),
      reason: (row.reason as string | null) ?? null,
      status: (row.status as string | null) ?? null,
      notes: (row.notes as string | null) ?? null,
      rentalId: (row.rental_id as string | null) ?? null,
    }));
    const ids = payments.map((p) => p.id);
    let live = new Set<string>();
    if (ids.length) {
      const credits = await admin
        .from("renter_credits")
        .select("source_payment_id,status")
        .in("source_payment_id", ids)
        .neq("status", "void")
        .limit(500);
      if (!credits.error) {
        live = new Set(
          ((credits.data ?? []) as Array<{ source_payment_id?: string | null }>)
            .map((row) => String(row.source_payment_id ?? ""))
            .filter(Boolean),
        );
      }
    }
    return { settings, offers: keptFeeOffers(rentalIds, payments, live) };
  } catch {
    return { settings, offers: [] };
  }
}

const CREDIT_SELECT = "id,application_id,source_rental_id,amount,status,expires_at,created_at";

function mapCancelledCredit(row: Record<string, unknown>): CancelledRentalCredit {
  return {
    id: String(row.id ?? ""),
    applicationId: String(row.application_id ?? ""),
    sourceRentalId: (row.source_rental_id as string | null) ?? null,
    amount: Number(row.amount),
    status: String(row.status ?? ""),
    expiresAt: (row.expires_at as string | null) ?? null,
    createdAt: (row.created_at as string | null) ?? null,
  };
}

async function readCreditRows(
  run: (select: string) => Promise<{ data: unknown; error: { message?: string } | null }>,
): Promise<CancelledRentalCredit[]> {
  let select = CREDIT_SELECT;
  let result = await run(select);
  const missingSource = !!result.error && /source_rental_id/i.test(String(result.error.message ?? ""));
  if (missingSource) return [];
  if (result.error && /expires_at/i.test(String(result.error.message ?? ""))) {
    select = select.replace(",expires_at", "");
    result = await run(select);
  }
  if (result.error) return [];
  return ((result.data ?? []) as Record<string, unknown>[]).map(mapCancelledCredit).filter((row) => row.id);
}

/**
 * Credits for the Cancelled page. Matched by source rental, plus credits for
 * these drivers that were saved without a source rental. A missing table is
 * an empty list so the kept-fee offers still load.
 */
export async function loadCancelledRentalCredits(
  admin: Admin,
  rentalIds: readonly string[],
  applicationIds: readonly string[],
): Promise<CancelledRentalCredit[]> {
  try {
    const byId = new Map<string, CancelledRentalCredit>();
    const add = (rows: CancelledRentalCredit[]) => {
      for (const row of rows) byId.set(row.id, row);
    };
    if (rentalIds.length) {
      add(await readCreditRows((select) =>
        admin.from("renter_credits").select(select).in("source_rental_id", [...rentalIds]).neq("status", "void").limit(200),
      ));
    }
    if (applicationIds.length) {
      add(await readCreditRows((select) => {
        let query = admin.from("renter_credits").select(select).in("application_id", [...applicationIds]).neq("status", "void");
        if (select.includes("source_rental_id")) query = query.is("source_rental_id", null);
        return query.limit(200);
      }));
    }
    return [...byId.values()];
  } catch {
    return [];
  }
}
