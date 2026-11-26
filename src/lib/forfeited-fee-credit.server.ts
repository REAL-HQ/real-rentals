// Reading and saving the forfeited-fee credit policy. Service role, so the
// caller has already checked the staff tier. A missing row or a missing table
// is the default (case by case, 90 days): the late-pickup job must not invent
// an automatic credit because settings could not be read.

import {
  DEFAULT_FORFEITED_FEE_CREDIT,
  FORFEITED_FEE_CREDIT_KEY,
  keptFeeOffers,
  readForfeitedFeeCreditSettings,
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
