// Printable Vehicle Inspection Report, built from a recorded inspection.
// Client-safe and pure: it formats what the inspection already holds and
// never invents a value. A blank stays a blank line to fill in by hand. The
// Rental Start (or Return) Date & Time is always a write-in line: an inspection
// records when the car was checked, not the moment the renter took it.
//
// The digital record (checklist, readings, photos, the renter's electronic
// sign-off) stays the source of truth. This is the paper form of the same
// record: print it for a wet signature at the car, or after the renter signs
// in the portal for a copy that shows both.

export type InspectionReportInput = {
  inspectionType: string;
  status: string;
  vehicleLabel: string;
  odometer: number | null;
  fuelLevel: string | null;
  exteriorNotes: string | null;
  interiorNotes: string | null;
  notes: string | null;
  inspectorName: string | null;
  startedAt: string | null;
  completedAt: string | null;
  renterSignatureName: string | null;
  renterSignedAt: string | null;
  renterNotes: string | null;
  items: Array<{ section: string; label: string; result: string; notes: string | null }>;
  /** Angle keys of the photos on file for this inspection (one entry per photo). */
  photoAngles: Array<string | null>;
  angles: ReadonlyArray<{ key: string; label: string }>;
};

export function escapeHtml(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const RESULT_LABEL: Record<string, string> = { pass: "Pass", fail: "Fail", na: "N/A", pending: "" };

export function isReturnInspection(type: string): boolean {
  return type === "return";
}

/** "At Pickup" for a pre-delivery inspection, "At Return" for a return, else the type in Title Case. */
export function reportPartTitle(type: string): string {
  if (type === "pre_delivery") return "At Pickup";
  if (isReturnInspection(type)) return "At Return";
  return type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function reportStatement(type: string): string {
  return isReturnInspection(type)
    ? "The information and photos above are accurate."
    : "I inspected the Vehicle with REAL RENTALS. The information and photos above are accurate, and I received the Vehicle in safe working order.";
}

export function inspectionReportHtml(
  d: InspectionReportInput,
  fmtDateTime: (iso: string) => string,
): string {
  const e = escapeHtml;
  const when = (iso: string | null) => (iso ? e(fmtDateTime(iso)) : "");
  const ret = isReturnInspection(d.inspectionType);
  const row = (k: string, v: string) => `<tr><th>${e(k)}</th><td>${v}</td></tr>`;

  const sections: string[] = [];
  let current = "";
  for (const it of d.items) {
    if (it.section !== current) {
      current = it.section;
      sections.push(`<tr class="sec"><td colspan="3">${e(current)}</td></tr>`);
    }
    sections.push(
      `<tr><td>${e(it.label)}</td><td class="res">${e(RESULT_LABEL[it.result] ?? it.result)}</td><td>${e(it.notes ?? "")}</td></tr>`,
    );
  }

  const counts = new Map<string, number>();
  for (const a of d.photoAngles) counts.set(a ?? "other", (counts.get(a ?? "other") ?? 0) + 1);
  const photos = d.angles
    .map((a) => `<span class="ph">${e(a.label)}: <b>${counts.get(a.key) ?? 0}</b></span>`)
    .join("");

  const signed = !!d.renterSignedAt;
  const renterSig = signed
    ? `<div class="val">/s/ ${e(d.renterSignatureName ?? "")}</div>`
    : `<div class="val"></div>`;
  const repName = d.completedAt ? e(d.inspectorName ?? "") : "";

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Vehicle Inspection Report</title>
<style>
  @page { size: Letter; margin: 0.6in; }
  * { box-sizing: border-box; }
  body { font: 10pt/1.4 Arial, Helvetica, sans-serif; color: #111114; margin: 0; }
  h1 { font-size: 18pt; margin: 0; }
  .sub { color: #55555E; margin: 2px 0 10px; }
  h2 { font-size: 12pt; margin: 16px 0 6px; padding-left: 8px; border-left: 3px solid #C8102E; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #44444A; padding: 4px 6px; vertical-align: top; text-align: left; font-size: 9.5pt; }
  table.kv th { width: 38%; background: #EDEDF0; font-weight: 700; }
  table.kv td { height: 22px; }
  table.items th { background: #38383D; color: #fff; }
  table.items td.res { width: 12%; font-weight: 700; }
  tr.sec td { background: #EDEDF0; font-weight: 700; }
  .photos { margin-top: 6px; }
  .ph { display: inline-block; margin: 0 14px 4px 0; }
  .statement { margin: 14px 0 4px; font-weight: 700; }
  .sigs { display: grid; grid-template-columns: 3fr 2fr; gap: 6px 22px; margin-top: 8px; page-break-inside: avoid; }
  .sig .val { height: 30px; border-bottom: 1px solid #111114; padding-top: 12px; font-weight: 700; }
  .sig .cap { font-size: 7.5pt; color: #55555E; margin-top: 2px; }
  .muted { color: #55555E; font-size: 8.5pt; }
</style></head><body>
<h1>REAL RENTALS</h1>
<div class="sub">Vehicle Inspection Report</div>
<p>This report is part of your Vehicle Rental Agreement. It records the Vehicle ${ret ? "at return" : "at pickup"}. By signing, you agree it is accurate.</p>
<table class="kv">
${row("Vehicle", e(d.vehicleLabel))}
${row("Agreement Number", "")}
${row("Renter Name", signed ? e(d.renterSignatureName ?? "") : "")}
</table>
<h2>${e(reportPartTitle(d.inspectionType))}</h2>
<table class="kv">
${row("Inspection Date & Time", when(d.completedAt))}
${row(ret ? "Return Date & Time" : "Rental Start Date & Time", "")}
${row("Inspected By", e(d.inspectorName ?? ""))}
${row(ret ? "Mileage In" : "Mileage Out", d.odometer != null ? e(d.odometer.toLocaleString("en-US")) : "")}
${row(ret ? "Fuel Level In" : "Fuel Level Out", e(d.fuelLevel ?? ""))}
${row("Exterior Notes", e(d.exteriorNotes ?? ""))}
${row("Interior Notes", e(d.interiorNotes ?? ""))}
${row("Notes", e(d.notes ?? ""))}
${d.renterNotes ? row("Renter Noted", e(d.renterNotes)) : ""}
</table>
${d.items.length ? `<h2>Checklist</h2><table class="items"><tr><th>Item</th><th>Result</th><th>Notes</th></tr>${sections.join("")}</table>` : ""}
<h2>Photos On File</h2>
<div class="photos">${photos}</div>
<p class="statement">${e(reportStatement(d.inspectionType))}</p>
<div class="sigs">
  <div class="sig">${renterSig}<div class="cap">Renter Signature${signed ? " (signed electronically)" : ""}</div></div>
  <div class="sig"><div class="val">${when(d.renterSignedAt)}</div><div class="cap">Date &amp; Time</div></div>
  <div class="sig"><div class="val">${repName}</div><div class="cap">REAL RENTALS Representative</div></div>
  <div class="sig"><div class="val">${when(d.completedAt)}</div><div class="cap">Date &amp; Time</div></div>
</div>
<p class="muted">Inspection status: ${e(d.status.replace(/_/g, " "))}. Printed from the REAL RENTALS inspection record.</p>
</body></html>`;
}
