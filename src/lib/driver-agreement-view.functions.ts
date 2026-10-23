import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  AGREEMENT_PDF_URL_TTL_SECONDS,
  RENTAL_AGREEMENTS_BUCKET,
  STAFF_PDF_LABEL,
  agreementIsOwned,
  agreementPdfLink,
  assertAgreementPdfTtl,
  assertDriverAgreementViewEnabled,
  buildDriverAgreements,
  documentCanBeSigned,
  ownApplicationIds,
  pdfAgreementAllowed,
  type AgreementPdfResult,
  type AgreementSourceRow,
  type ApplicationOwnerRow,
  type DocumentSignRow,
  type DriverAgreementList,
  type TemplateVersionRow,
} from "@/lib/driver-agreement-view";

/**
 * The signed-in driver's own agreements, and a short-lived PDF link.
 *
 * Both handlers throw on the flag before auth or any table read. The client
 * is the caller's bearer session, so RLS applies. No service-role client.
 * The PDF link is created only when the existing storage policy allows it.
 */

function staffPdf(): AgreementPdfResult {
  return { url: null, availability: STAFF_PDF_LABEL };
}

export const getDriverAgreements = createServerFn({ method: "POST" }).handler(async (): Promise<DriverAgreementList> => {
  assertDriverAgreementViewEnabled();
  const { getRequest } = await import("@tanstack/react-start/server");
  const { createClient } = await import("@supabase/supabase-js");
  const request = getRequest();
  const authHeader = request?.headers?.get("authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) throw new Error("Unauthorized: No authorization header provided");
  const token = authHeader.slice("Bearer ".length).trim();
  if (!token) throw new Error("Unauthorized: No token provided");
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase environment variable(s).");
  const supabase = createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
  });
  const { data: claims, error: authError } = await supabase.auth.getClaims(token);
  if (authError || !claims?.claims?.sub) throw new Error("Unauthorized: Invalid token");
  const userId = claims.claims.sub as string;
  const { data: apps, error: appError } = await supabase
    .from("applications")
    .select("id,user_id")
    .eq("user_id", userId);
  if (appError) throw new Error(appError.message);
  const ownIds = ownApplicationIds((apps ?? []) as ApplicationOwnerRow[], userId);
  if (!ownIds.length) return { agreements: [] };
  const { data: agreementRows, error: agreementError } = await supabase
    .from("agreements")
    .select("id,application_id,title,status,signed_at,template_id,document_id,archive_status")
    .in("application_id", ownIds)
    .order("created_at", { ascending: false });
  if (agreementError) throw new Error(agreementError.message);
  const templateIds = [
    ...new Set(
      ((agreementRows ?? []) as AgreementSourceRow[])
        .map((row) => row.template_id)
        .filter((id): id is string => !!id),
    ),
  ];
  let templates: TemplateVersionRow[] = [];
  if (templateIds.length) {
    const { data: templateRows, error: templateError } = await supabase
      .from("agreement_templates")
      .select("id,version")
      .in("id", templateIds);
    if (!templateError) templates = (templateRows ?? []) as TemplateVersionRow[];
  }
  return {
    agreements: buildDriverAgreements((agreementRows ?? []) as AgreementSourceRow[], ownIds, templates),
  };
});

export const getDriverAgreementPdf = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ agreementId: z.string().uuid() }).parse(d))
  .handler(async ({ data }): Promise<AgreementPdfResult> => {
    assertDriverAgreementViewEnabled();
    const { getRequest } = await import("@tanstack/react-start/server");
    const { createClient } = await import("@supabase/supabase-js");
    const request = getRequest();
    const authHeader = request?.headers?.get("authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) throw new Error("Unauthorized: No authorization header provided");
    const token = authHeader.slice("Bearer ".length).trim();
    if (!token) throw new Error("Unauthorized: No token provided");
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) throw new Error("Missing Supabase environment variable(s).");
    const supabase = createClient(url, key, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
    });
    const { data: claims, error: authError } = await supabase.auth.getClaims(token);
    if (authError || !claims?.claims?.sub) throw new Error("Unauthorized: Invalid token");
    const userId = claims.claims.sub as string;
    const { data: apps, error: appError } = await supabase
      .from("applications")
      .select("id,user_id")
      .eq("user_id", userId);
    if (appError) throw new Error(appError.message);
    const ownIds = ownApplicationIds((apps ?? []) as ApplicationOwnerRow[], userId);
    const { data: agreement, error: agreementError } = await supabase
      .from("agreements")
      .select("id,application_id,status,document_id,archive_status")
      .eq("id", data.agreementId)
      .maybeSingle();
    if (agreementError) throw new Error(agreementError.message);
    if (!agreement || !agreementIsOwned(agreement, ownIds)) throw new Error("Agreement not found");
    if (!pdfAgreementAllowed(agreement, ownIds) || !agreement.document_id) return staffPdf();
    const { data: doc, error: docError } = await supabase
      .from("documents")
      .select("id,driver_id,storage_bucket,storage_path,visibility")
      .eq("id", agreement.document_id)
      .maybeSingle();
    if (docError) throw new Error(docError.message);
    if (!documentCanBeSigned(doc as DocumentSignRow | null, ownIds) || !doc?.storage_path) return staffPdf();
    const { data: signed, error: signError } = await supabase.storage
      .from(RENTAL_AGREEMENTS_BUCKET)
      .createSignedUrl(doc.storage_path, assertAgreementPdfTtl(AGREEMENT_PDF_URL_TTL_SECONDS));
    return agreementPdfLink(
      { signedUrl: signed?.signedUrl ?? null, error: signError ? { message: signError.message } : null },
      AGREEMENT_PDF_URL_TTL_SECONDS,
    );
  });
