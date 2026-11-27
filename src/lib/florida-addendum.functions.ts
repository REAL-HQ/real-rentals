// Staff preview of the Florida 812.155 Addendum for one renter
// (agreement-fl-addendum.ts). Read-only: it never writes, sends, texts or
// emails anything, and it never creates an agreement or document row.
//
// Until the Owner approves the addendum wording (FL_ADDENDUM_OWNER_APPROVAL),
// the PDF is the watermarked "PREVIEW - NOT SENT" render, so it cannot be
// handed to a renter for signature. Once approved, staff get a clean PDF to
// print; the signed paper copy is filed with the existing Paper Agreements
// upload (no new database objects). Sending it through eSign is a separate,
// later change (see proposed/florida-addendum-esign-v1.sql, not applied).
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { COMPANY_DEFAULTS } from "@/lib/agreement-merge";
import { formatHomeAddress } from "@/lib/agreement-home-address";
import {
  FL_ADDENDUM_OWNER_APPROVAL,
  FL_ADDENDUM_TITLE,
  FL_ADDENDUM_VERSION,
  addendumBlockers,
  renderFloridaAddendum,
  type AddendumFields,
} from "@/lib/agreement-fl-addendum";
import {
  agreementFactFromRow,
  floridaAddendumNeed,
  needs812155Addendum,
  type AgreementFact,
  type FloridaAddendumNeed,
} from "@/lib/florida-addendum-need";
import { PAPER_TYPES, type PaperType } from "@/lib/paper-agreements";

const LIVE_RENTAL_STATUSES = ["active", "reserved", "on_hold"];
const cell = (v: unknown) =>
  String(v ?? "")
    .replace(/\|/g, "/")
    .replace(/\s+/g, " ")
    .trim();

/** Everything the addendum prints for one renter, from records only (nothing guessed). */
export async function floridaAddendumFields(
  admin: any,
  applicationId: string,
): Promise<AddendumFields & { agreementSource: "signed_agreement" | "unknown" }> {
  const { data: app, error } = await admin
    .from("applications")
    .select("id,full_name,address,city,state,zip,vehicle_id")
    .eq("id", applicationId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!app) throw new Error("Driver not found");

  // The car on the renter's live rental, else the application's car.
  const { data: rentals } = await admin
    .from("rentals")
    .select("id,vehicle_id,status,created_at")
    .eq("application_id", applicationId)
    .in("status", LIVE_RENTAL_STATUSES)
    .order("created_at", { ascending: false })
    .limit(1);
  const vehicleId =
    (rentals?.[0]?.vehicle_id as string | undefined) ?? (app.vehicle_id as string | null) ?? null;
  let vehicle: any = null;
  if (vehicleId) {
    const { data } = await admin
      .from("vehicles")
      .select("id,year,make,model,trim,vin,license_plate,plate_state")
      .eq("id", vehicleId)
      .maybeSingle();
    vehicle = data ?? null;
  }

  // The renter's latest signed eSign agreement number; paper agreements have none on file.
  const { data: signed } = await admin
    .from("agreements")
    .select("id,merge_data,signed_at,status")
    .eq("application_id", applicationId)
    .eq("status", "signed")
    .order("signed_at", { ascending: false })
    .limit(1);
  const agreementNumber = String((signed?.[0]?.merge_data as any)?.agreement_number ?? "").trim();
  const usable = /^RRA-/.test(agreementNumber) ? agreementNumber : "";

  const { getCompanyIdentity } = await import("@/lib/company-identity.server");
  const company = { ...COMPANY_DEFAULTS, ...(await getCompanyIdentity(admin)).merge } as Record<
    string,
    string
  >;
  return {
    agreement_number: usable || null,
    agreementSource: usable ? "signed_agreement" : "unknown",
    driver_name: cell(app.full_name),
    driver_address: cell(formatHomeAddress(app)),
    vehicle: cell(
      vehicle
        ? [vehicle.year, vehicle.make, vehicle.model, vehicle.trim].filter(Boolean).join(" ")
        : "",
    ),
    vehicle_vin: cell(vehicle?.vin),
    license_plate: cell(
      vehicle?.license_plate
        ? [String(vehicle.license_plate).toUpperCase(), vehicle.plate_state]
            .filter(Boolean)
            .join(" / ")
        : "",
    ),
    company_name: cell(company.company_name),
    company_address: cell(company.company_address),
    company_email: cell(company.company_email),
    company_phone: cell(company.company_phone),
  };
}

const PAPER_TYPE = new Set<string>(PAPER_TYPES);

function paperTypeOf(metadata: unknown): PaperType | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const type = (metadata as { type?: unknown }).type;
  return typeof type === "string" && PAPER_TYPE.has(type) ? (type as PaperType) : null;
}

/** Current paper filings for this renter. A failure here does not invent a version. */
async function paperAddendumFacts(admin: any, applicationId: string): Promise<AgreementFact[]> {
  const docs = await admin
    .from("documents")
    .select("id,file_name,notes,label,is_current")
    .eq("driver_id", applicationId)
    .eq("category", "agreement")
    .eq("source", "paper");
  if (docs.error || !docs.data?.length) return [];
  const ids = docs.data.map((doc: { id: string }) => doc.id);
  const audits = await admin
    .from("audit_log")
    .select("entity_id,metadata")
    .eq("action", "paper_agreement.uploaded")
    .eq("entity_type", "document")
    .in("entity_id", ids);
  if (audits.error) return [];
  const typeById = new Map<string, PaperType>();
  for (const audit of audits.data ?? []) {
    const type = paperTypeOf(audit.metadata);
    if (type && !typeById.has(audit.entity_id as string)) typeById.set(audit.entity_id as string, type);
  }
  return docs.data.map((doc: { id: string; file_name?: string | null; notes?: string | null; label?: string | null; is_current?: boolean | null }) => ({
    status: "signed" as const,
    source: "paper",
    title: doc.label ?? null,
    paperType: typeById.get(doc.id) ?? null,
    paperName: [doc.file_name, doc.label, doc.notes].filter((part) => typeof part === "string" && part.trim()).join(" "),
    isCurrent: doc.is_current !== false,
  }));
}

/**
 * The addendum card for one driver. Read-only. Returns the shared rule's
 * answer and nothing else (no agreement text, no phone number).
 * Staff of every tier that can open a driver profile may read it. The preview
 * PDF stays Manager-only.
 */
export type FloridaAddendumCard = FloridaAddendumNeed & {
  /** needs812155Addendum: true only while the addendum is still outstanding. */
  outstanding: boolean;
};

export async function floridaAddendumStatusFor(
  admin: any,
  applicationId: string,
): Promise<FloridaAddendumCard> {
  const { data, error } = await admin
    .from("agreements")
    .select("status,signed_at,voided_at,created_at,source,title,metadata,body")
    .eq("application_id", applicationId);
  if (error) throw new Error(error.message);
  const agreements = ((data ?? []) as Parameters<typeof agreementFactFromRow>[0][]).map(agreementFactFromRow);
  let paper: AgreementFact[] = [];
  try {
    paper = await paperAddendumFacts(admin, applicationId);
  } catch {
    paper = [];
  }
  const facts = [...agreements, ...paper];
  const need = floridaAddendumNeed(facts);
  return { ...need, outstanding: needs812155Addendum(facts) };
}

export const getFloridaAddendumStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ applicationId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const roles = await import("@/lib/roles.server");
    await roles.requireStaff(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return floridaAddendumStatusFor(supabaseAdmin, data.applicationId);
  });

export const previewFloridaAddendum = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ applicationId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const roles = await import("@/lib/roles.server");
    await roles.requireTier(context.userId, "manager");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const fields = await floridaAddendumFields(supabaseAdmin, data.applicationId);
    const blockers = addendumBlockers(fields);
    const body = renderFloridaAddendum(fields);
    const { getCompanySigner } = await import("@/lib/esign.server");
    const { renderPreviewPdf, layoutStructured, sha256Hex } =
      await import("@/lib/esign-pdf.server");
    const signer = await getCompanySigner(supabaseAdmin);
    const fingerprint = await sha256Hex(body);
    const label = `${FL_ADDENDUM_TITLE} v${FL_ADDENDUM_VERSION}`;
    let bytes: Uint8Array;
    if (FL_ADDENDUM_OWNER_APPROVAL && blockers.length === 0) {
      const { PDFDocument } = await import("pdf-lib");
      const pdf = await PDFDocument.create();
      pdf.setTitle(`${label} - ${fields.driver_name}`);
      pdf.setAuthor("REAL RENTALS");
      await layoutStructured(pdf, {
        title: FL_ADDENDUM_TITLE,
        body,
        footerText: `${label} - Owner Approved ${FL_ADDENDUM_OWNER_APPROVAL.at} - Fingerprint ${fingerprint.slice(0, 16)}`,
        companySignerName: signer.name,
        companySignerTitle: signer.title,
        signed: null,
      });
      bytes = await pdf.save({ useObjectStreams: false });
    } else {
      bytes = await renderPreviewPdf({
        title: FL_ADDENDUM_TITLE,
        body,
        fingerprint,
        templateLabel: `${label} - Not Approved For Renters`,
        companySignerName: signer.name,
        companySignerTitle: signer.title,
        generatedAt: new Date().toISOString(),
      });
    }
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000)
      bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return {
      pdfBase64: btoa(bin),
      fingerprint,
      blockers,
      agreementNumber: fields.agreement_number ?? null,
      agreementSource: fields.agreementSource,
      approvedForRenters: Boolean(FL_ADDENDUM_OWNER_APPROVAL),
    };
  });
