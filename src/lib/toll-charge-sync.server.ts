// Marks an existing toll charge paid when a hand-made Payment Link is paid.
//
// Called from the one-off payment recorder after the payments row exists.
// It never inserts a charge. No match, more than one match, or a charge
// already paid by a different payment is logged and left alone.
// A missing stripe_payment_link_id column (migration not applied) falls
// through to the notice number plus the rental, which uses columns that
// already exist.

import { isMissingColumnError } from "@/lib/db-errors";
import {
  normalizeNotice,
  pickTollChargeMatch,
  shouldLinkPaidTollCharge,
  type TollChargeRef,
} from "@/lib/toll-charge-deadlines";

type Admin = any;

export type TollChargeLinkInput = {
  paymentId: string | null;
  paymentLinkId?: string | null;
  notice?: string | null;
  rentalId?: string | null;
  reason?: string | null;
};

export type TollChargeLinkResult =
  | { linked: true; id: string; by: "payment_link" | "notice" }
  | { linked: false; why: string };

const NOTICE_COLS = "id,status,payment_id,reference_number,rental_id";
const LINK_COLS = "id,status,payment_id,reference_number,rental_id,stripe_payment_link_id";

function exactILike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Find the charge for this paid notice and set status paid with payment_id.
 * Returns without writing when nothing matches.
 */
export async function linkPaidTollCharge(admin: Admin, input: TollChargeLinkInput): Promise<TollChargeLinkResult> {
  if (!shouldLinkPaidTollCharge(input.reason, input.notice)) return { linked: false, why: "not_applicable" };
  if (!input.paymentId) {
    console.info("[toll-charge] paid notice has no payment row to link", {
      paymentLinkId: input.paymentLinkId ?? null,
      rentalId: input.rentalId ?? null,
    });
    return { linked: false, why: "no_payment" };
  }

  const rows: TollChargeRef[] = [];
  const linkId = input.paymentLinkId?.trim() || null;
  if (linkId) {
    const found = await admin.from("toll_charges").select(LINK_COLS).eq("stripe_payment_link_id", linkId);
    if (found?.error) {
      if (!isMissingColumnError(found.error)) {
        console.error("[toll-charge] payment link lookup failed", found.error.message ?? found.error);
        return { linked: false, why: "lookup_failed" };
      }
    } else {
      for (const row of (found?.data ?? []) as TollChargeRef[]) rows.push(row);
    }
  }

  const notice = normalizeNotice(input.notice);
  const rentalId = input.rentalId?.trim() || null;
  if (notice && rentalId) {
    const found = await admin
      .from("toll_charges")
      .select(NOTICE_COLS)
      .eq("rental_id", rentalId)
      .ilike("reference_number", exactILike(notice));
    if (found?.error) {
      if (isMissingColumnError(found.error)) {
        console.info("[toll-charge] charge lookup columns are not installed; paid notice not linked", {
          paymentId: input.paymentId,
        });
        return { linked: false, why: "columns_absent" };
      }
      console.error("[toll-charge] notice lookup failed", found.error.message ?? found.error);
      return { linked: false, why: "lookup_failed" };
    }
    for (const row of (found?.data ?? []) as TollChargeRef[]) {
      if (!rows.some((existing) => existing.id === row.id)) rows.push(row);
    }
  }

  const pick = pickTollChargeMatch(rows, {
    paymentLinkId: linkId,
    notice,
    rentalId,
    paymentId: input.paymentId,
  });
  if (!pick.ok) {
    console.info("[toll-charge] paid notice did not match a charge", {
      why: pick.why,
      paymentId: input.paymentId,
      paymentLinkId: linkId,
      rentalId,
    });
    return { linked: false, why: pick.why };
  }

  const updated = await admin
    .from("toll_charges")
    .update({ status: "paid", payment_id: input.paymentId })
    .eq("id", pick.id)
    .select("id");
  if (updated?.error || !(updated?.data?.length)) {
    console.error("[toll-charge] could not mark charge paid", updated?.error?.message ?? "no row");
    return { linked: false, why: "update_failed" };
  }
  return { linked: true, id: pick.id, by: pick.by };
}
