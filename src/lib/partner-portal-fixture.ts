/**
 * Sample rows for the local partner-portal preview (`/partner?fixture=1`).
 * Loaded only from that dev-only screen. Nothing here is a real partner,
 * vehicle, or payout.
 */
import { partnerSections } from "@/lib/partner-portal";
import type { PartnerFinancials, PartnerPortalData } from "@/lib/partner-portal.functions";

const PHOTO = "/preview/sample-car.svg";

export function activeFixture(): { portal: PartnerPortalData; financials: PartnerFinancials } {
  const portal: PartnerPortalData = {
    partner: {
      id: "00000000-0000-4000-8000-000000000001",
      name: "Jordan Hale",
      email: "jordan.hale@example.com",
      phone: "",
      businessName: "Hale Motors",
      address: { line1: "100 Example Ave", line2: null, city: "Tampa", state: "FL", postalCode: "33602" },
      status: "active",
      splitPct: 50,
      smsConsent: false,
      notifyRentals: true,
      payoutsEnabled: false,
      payoutSetupStarted: false,
    },
    sections: partnerSections("active"),
    vehicles: [
      {
        id: "00000000-0000-4000-8000-000000000011",
        label: "2019 Honda Accord EX",
        year: 2019,
        make: "Honda",
        model: "Accord",
        trim: "EX",
        color: "Silver",
        vin: "1HGCV1F3XKA000001",
        plate: "SAMPLE1",
        status: "rented",
        statusLabel: "Rented",
        weeklyRate: 375,
        photoPath: PHOTO,
        rentals: [
          { start: "2026-11-02", end: null, active: true },
          { start: "2026-09-01", end: "2026-10-12", active: false },
        ],
      },
      {
        id: "00000000-0000-4000-8000-000000000012",
        label: "2016 Ford Fusion SE",
        year: 2016,
        make: "Ford",
        model: "Fusion",
        trim: "SE",
        color: "White",
        vin: "3FA6P0H73GR318847",
        plate: "SAMPLE2",
        status: "listed",
        statusLabel: "Listed — Awaiting Renter",
        weeklyRate: 325,
        photoPath: PHOTO,
        rentals: [],
      },
    ],
    submissions: [
      {
        id: "00000000-0000-4000-8000-000000000021",
        createdAt: "2026-11-20",
        label: "2018 Toyota Camry SE",
        vin: "4T1B11HK5JU000222",
        status: "under_review",
        photoCount: 0,
        hasRegistration: true,
      },
    ],
  };
  const financials: PartnerFinancials = {
    splitPct: 50,
    months: [
      { month: "2026-11", grossRent: 1500, partnerShare: 750, expenses: 120, partnerExpenseShare: 60, net: 690 },
      { month: "2026-10", grossRent: 1500, partnerShare: 750, expenses: 80, partnerExpenseShare: 40, net: 710 },
      { month: "2026-09", grossRent: 1125, partnerShare: 562.5, expenses: 0, partnerExpenseShare: 0, net: 562.5 },
    ],
    expenses: [
      { id: "e1", vehicleId: portal.vehicles[0].id, date: "2026-11-04", category: "insurance", label: "Program Coverage", amount: 120, vehicleLabel: "2019 Honda Accord EX" },
    ],
    payouts: [
      {
        id: "00000000-0000-4000-8000-000000000031",
        periodStart: "2026-10-01",
        periodEnd: "2026-10-31",
        grossRent: 1500,
        partnerShare: 750,
        expenses: 40,
        net: 710,
        status: "paid",
        paidAt: "2026-11-05",
        method: "ach",
        hasReceipt: true,
      },
    ],
  };
  return { portal, financials };
}

export function prospectFixture(): { portal: PartnerPortalData; financials: PartnerFinancials } {
  const active = activeFixture();
  return {
    portal: {
      ...active.portal,
      partner: { ...active.portal.partner, status: "prospect", businessName: null },
      sections: partnerSections("prospect"),
      vehicles: [],
    },
    financials: { ...active.financials, months: [], expenses: [], payouts: [] },
  };
}
