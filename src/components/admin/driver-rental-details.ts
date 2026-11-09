import type { BookingDetail } from "@/lib/bookings.functions";

/** Only the rental's saved terms and linked pickup/return readings, not application drafts. */
export function driverRentalFacts(detail: BookingDetail, applicationId: string) {
  if (detail.booking.applicationId !== applicationId) return null;
  return {
    status: detail.booking.status,
    startDate: detail.booking.startDate,
    endDate: detail.booking.endDate,
    active: detail.booking.phase === "active",
    openEnded: detail.booking.openEnded,
    mileageOut: detail.mileage.pickup,
    mileageIn: detail.mileage.return,
    ...(detail.canSeeMoney ? {
      money: {
        weeklyRate: detail.booking.weeklyRate ?? null,
        deposit: detail.money?.deposit.amount ?? null,
      },
    } : {}),
  };
}