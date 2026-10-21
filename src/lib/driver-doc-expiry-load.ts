import { readCounted } from "./count-paged-read";
import {
  documentExpiryStatus,
  easternCalendarDay,
  type ReadinessApplication,
} from "./driver-readiness-facts";
import { DRIVER_DOC_EXPIRY_ROW_CAP, type DriverDocExpiryResult } from "./driver-doc-expiry";

const APPLICATION_COLUMNS = "id,license_expiration,insurance_expires_on";

const failed = (): DriverDocExpiryResult => ({
  failed: true,
  truncated: false,
  cap: DRIVER_DOC_EXPIRY_ROW_CAP,
  drivers: [],
});

/**
 * The Drivers-list population: not deleted, not a duplicate. Callers have
 * already passed the flag and the role check. The two dates are the fields
 * on ReadinessApplication. TNC approval columns are not selected, because
 * they are not in the schema, so every row is classified with a null TNC
 * date. An error is `failed`, not a cap. A count above the cap still returns
 * the drivers that were read.
 */
export async function loadDriverDocExpiry(
  admin: { from: (table: string) => any },
  today = easternCalendarDay(new Date()),
): Promise<DriverDocExpiryResult> {
  const applications = await readCounted(
    (from, to) =>
      admin
        .from("applications")
        .select(APPLICATION_COLUMNS, { count: "exact" })
        .is("deleted_at", null)
        .neq("status", "duplicate")
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(from, to),
    DRIVER_DOC_EXPIRY_ROW_CAP,
  );
  if (!applications.ok) return failed();
  const drivers = applications.rows.flatMap((row) => {
    const app = row as unknown as Pick<ReadinessApplication, "id" | "license_expiration" | "insurance_expires_on">;
    if (typeof app.id !== "string" || app.id.length === 0) return [];
    return [
      {
        id: app.id,
        status: documentExpiryStatus(
          {
            license_expiration: app.license_expiration ?? null,
            insurance_expires_on: app.insurance_expires_on ?? null,
          },
          today,
          null,
        ),
      },
    ];
  });
  return {
    failed: false,
    truncated: applications.truncated,
    cap: DRIVER_DOC_EXPIRY_ROW_CAP,
    drivers,
  };
}
