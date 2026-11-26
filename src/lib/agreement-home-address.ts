// Home Address is required before any rental agreement can be previewed as
// ready or sent: v1.15 makes it the renter's address for all legal notices and
// demands, including demands under Florida s. 812.155. Client-safe; the staff
// dialog (PrepareAgreementDialog) and the server readiness gate
// (agreements.functions.ts buildMergeData) both use this one check.

export type HomeAddressParts = {
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
};

export const HOME_ADDRESS_LABEL = "Home Address (Street, City, State, ZIP)";
export const HOME_ADDRESS_WHY =
  "The agreement prints the renter's Home Address, and it is the address for all legal notices and demands, including demands under Section 812.155. Confirm it with the renter. Do not guess it.";

const blank = (v: unknown) => !String(v ?? "").trim();

/** The Home Address parts that are missing (blank or whitespace). */
export function missingHomeAddressParts(
  p: HomeAddressParts,
): ("Street" | "City" | "State" | "ZIP")[] {
  const out: ("Street" | "City" | "State" | "ZIP")[] = [];
  if (blank(p.address)) out.push("Street");
  if (blank(p.city)) out.push("City");
  if (blank(p.state)) out.push("State");
  if (blank(p.zip)) out.push("ZIP");
  return out;
}

export function homeAddressMissing(p: HomeAddressParts): boolean {
  return missingHomeAddressParts(p).length > 0;
}

/** The printed Home Address, or "" when any part is missing (which blocks sending). */
export function formatHomeAddress(p: HomeAddressParts): string {
  if (homeAddressMissing(p)) return "";
  return [p.address, p.city, p.state, p.zip].map((v) => String(v).trim()).join(", ");
}
