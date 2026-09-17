// Client-safe merge-field helpers shared by the admin preview and the
// server-side agreement renderer.

export const MERGE_FIELDS = [
  { key: "driver_name", label: "Driver full name" },
  { key: "driver_email", label: "Driver email" },
  { key: "driver_phone", label: "Driver phone" },
  { key: "driver_address", label: "Driver address" },
  { key: "license_number", label: "License number" },
  { key: "license_state", label: "License state" },
  { key: "license_expiration", label: "License expiration" },
  { key: "vehicle", label: "Vehicle (year make model)" },
  { key: "vehicle_color", label: "Vehicle color" },
  { key: "vehicle_vin", label: "Vehicle ID / VIN" },
  { key: "weekly_rate", label: "Weekly rate" },
  { key: "deposit_amount", label: "Security deposit" },
  { key: "start_date", label: "Pickup date" },
  { key: "return_date", label: "Return date" },
  { key: "market", label: "Market / city" },
  { key: "company_name", label: "Company name" },
  { key: "company_address", label: "Company address" },
  { key: "company_phone", label: "Company phone" },
  { key: "company_email", label: "Company email" },
  { key: "today", label: "Today's date" },
] as const;

export type MergeData = Record<string, string>;

export function renderTemplate(body: string, data: MergeData): string {
  return body.replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (_m, key: string) => {
    const v = data[key.toLowerCase()];
    return v && v.trim() ? v : "__________";
  });
}

export const COMPANY_DEFAULTS: MergeData = {
  company_name: "REAL RENTALS",
  company_address: "Tampa, FL",
  company_phone: "+1 (813) 699-9118",
  company_email: "team@drivereal.com",
};

export const DEFAULT_AGREEMENT_BODY = `VEHICLE RENTAL AGREEMENT

This Vehicle Rental Agreement ("Agreement") is entered into on {{today}} between {{company_name}}, {{company_address}} ("Company"), and {{driver_name}} ("Renter").

1. PARTIES AND CONTACT
Renter: {{driver_name}}
Email: {{driver_email}} · Phone: {{driver_phone}}
Address: {{driver_address}}
Driver's license: {{license_number}} ({{license_state}}), expires {{license_expiration}}
Company contact: {{company_phone}} · {{company_email}}

2. VEHICLE
Vehicle: {{vehicle}}
Color: {{vehicle_color}}
Vehicle ID / VIN: {{vehicle_vin}}
Market: {{market}}

3. TERM
Pickup date: {{start_date}}
Scheduled return date: {{return_date}}
The rental continues on a weekly basis until the vehicle is returned and the account is settled in full.

4. RATES AND PAYMENT
Weekly rental rate: {{weekly_rate}}
Security deposit: {{deposit_amount}}
Rent is billed weekly in advance to the payment method on file. Late payments may incur late fees and may result in suspension of the rental. The deposit is refundable after the vehicle is returned in acceptable condition and all balances are paid.

5. PERMITTED USE
The vehicle may be used for rideshare and delivery work on approved platforms and for ordinary personal use. Only the Renter may operate the vehicle. Subleasing, racing, towing, off-road use, transporting hazardous materials, and any illegal activity are strictly prohibited.

6. INSURANCE
The Renter must maintain active insurance meeting state minimums, including any rideshare endorsement required by their platform, and must keep valid proof of coverage on file with the Company at all times.

7. MAINTENANCE AND CONDITION
The Renter is responsible for routine care: fuel/charging, tire pressure, fluid levels, cleanliness, tolls, parking, and traffic citations. The Company handles scheduled maintenance. The Renter must report accidents, damage, warning lights, and mechanical issues immediately.

8. MILEAGE
Unlimited miles are included unless otherwise stated in writing.

9. RETURN AND TERMINATION
Either party may end this Agreement with seven (7) days' written notice. On termination the vehicle must be returned to the designated location in the same condition as received, less normal wear.

10. GPS AND MONITORING
The Renter acknowledges the vehicle may contain GPS tracking used for fleet safety, recovery, and maintenance.

11. GOVERNING LAW
This Agreement is governed by the laws of the state in which the vehicle is registered.

12. ELECTRONIC SIGNATURE
By typing their name below and submitting this Agreement, the Renter agrees that their electronic signature is the legal equivalent of a handwritten signature and that they have read and accept all terms above.
`;
