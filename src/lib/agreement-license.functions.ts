import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { AgreementDetailsSchema, type AgreementDetails } from "@/lib/agreement-prep";
import { parseWrittenAgreementDetails, WRITTEN_AGREEMENT_FIELDS } from "@/lib/agreement-document-read";

const LICENSE_FIELDS = [
  "driverName",
  "address",
  "city",
  "state",
  "zip",
  "dob",
  "licenseNumber",
  "licenseState",
  "licenseExpiration",
] as const;

/**
 * Read the current private license image into a reviewable agreement draft.
 * This never writes identity fields, verifies the license, or overwrites a
 * value staff already entered. Only the fields printed on the license return.
 */
export const readAgreementLicense = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((value: unknown) => z.object({ applicationId: z.string().uuid() }).parse(value))
  .handler(async ({ data, context }): Promise<{ details: Partial<AgreementDetails>; fileName: string }> => {
    const { requireManager } = await import("@/lib/roles.server");
    await requireManager(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: document, error } = await supabaseAdmin
      .from("documents")
      .select("storage_bucket,storage_path,file_name,mime_type,size_bytes")
      .eq("driver_id", data.applicationId)
      .eq("category", "license_front")
      .eq("is_current", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!document) throw new Error("No current driver's license front image is on file.");

    const { data: file, error: downloadError } = await supabaseAdmin.storage
      .from(document.storage_bucket)
      .download(document.storage_path);
    if (downloadError || !file) throw new Error("The driver's license image could not be opened.");
    const mime = String(document.mime_type || "image/jpeg").split(";")[0];
    if (!["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(mime)) {
      throw new Error("This license file needs to be a JPG, PNG, WebP, or PDF for automatic reading.");
    }

    const { readDocument, parseModelJson } = await import("@/lib/document-reader.server");
    const result = await readDocument({
      bytes: new Uint8Array(await file.arrayBuffer()),
      mime,
      maxTokens: 900,
      system: "You read driver's licenses for a rental business. Return only JSON. Never infer, guess, or normalize uncertain characters. Personal data is sensitive and must not appear in explanations.",
      prompt: `Read only text visibly printed on this driver's license. Return one JSON object with exactly these keys: ${LICENSE_FIELDS.join(", ")}. driverName is the full printed name. Split the printed residential address into address (street only), city, state, and zip. dob and licenseExpiration must be YYYY-MM-DD. licenseState is the two-letter issuing state, not the residence state. licenseNumber is the printed license or customer identifier. Use an empty string for anything absent or uncertain. Do not infer a value from a barcode, another field, or prior knowledge.`,
    });
    if (!result.ok) throw new Error(result.error);

    let parsed: Record<string, unknown>;
    try {
      parsed = parseModelJson(result.text);
    } catch {
      throw new Error("The license reader returned an unreadable result. Enter the details manually.");
    }
    const candidate: Record<string, string> = {};
    for (const key of LICENSE_FIELDS) {
      const value = parsed?.[key];
      candidate[key] = typeof value === "string" ? value.trim() : "";
    }
    const details = AgreementDetailsSchema.partial().parse(candidate);
    return { details, fileName: String(document.file_name || "Driver's License") };
  });

/**
 * Read the current private written agreement into blank fields of the staff
 * preparation draft. This is a proposal only: no application, rental, vehicle,
 * agreement status, or verification record is written by this function.
 */
export const readWrittenAgreement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((value: unknown) => z.object({ applicationId: z.string().uuid() }).parse(value))
  .handler(async ({ data, context }): Promise<{ details: Partial<AgreementDetails>; fileName: string; documentId: string }> => {
    const { requireManager } = await import("@/lib/roles.server");
    await requireManager(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: document, error } = await supabaseAdmin
      .from("documents")
      .select("id,storage_bucket,storage_path,file_name,mime_type")
      .eq("driver_id", data.applicationId)
      .eq("category", "agreement")
      .eq("is_current", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!document) return { details: {}, fileName: "", documentId: "" };

    const { data: file, error: downloadError } = await supabaseAdmin.storage
      .from(document.storage_bucket)
      .download(document.storage_path);
    if (downloadError || !file) throw new Error("The written agreement could not be opened.");
    const mime = String(document.mime_type || "application/pdf").split(";")[0];
    if (!["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(mime)) {
      throw new Error("This agreement needs to be a JPG, PNG, WebP, or PDF for automatic reading.");
    }

    const { readDocument, parseModelJson } = await import("@/lib/document-reader.server");
    const result = await readDocument({
      bytes: new Uint8Array(await file.arrayBuffer()),
      mime,
      maxTokens: 1200,
      system: "You read signed rental agreements for a rental business. Return only JSON. Never infer, guess, normalize uncertain characters, or complete missing contract facts. Personal and payment data is sensitive and must not appear in explanations.",
      prompt: `Read only text visibly printed or written on this rental agreement. Return one JSON object with exactly these keys: ${WRITTEN_AGREEMENT_FIELDS.join(", ")}. driverName, driverEmail and driverPhone identify the renter. Split the renter residential address into address (street only), city, state and zip. dob and licenseExpiration must be YYYY-MM-DD. licenseState is the two-letter issuing state. vehicleDescription is the printed year, make and model; vehicleVin is the exact printed VIN; licensePlate is the exact plate. startDate and endDate are the contractual rental dates in YYYY-MM-DD. weeklyRate is only the numeric weekly rent amount as a string, without a currency symbol; do not convert a monthly or total amount. cardOnFile may contain only the printed card brand and last four digits, never a full card number. insuranceCarrier and insurancePolicy must be explicit. Use an empty string for anything absent or uncertain. Do not infer values from other fields, signatures, barcodes, or prior knowledge.`,
    });
    if (!result.ok) throw new Error(result.error);

    let parsed: unknown;
    try {
      parsed = parseModelJson(result.text);
    } catch {
      throw new Error("The agreement reader returned an unreadable result. Review the details manually.");
    }
    return {
      details: parseWrittenAgreementDetails(parsed),
      fileName: String(document.file_name || "Written Agreement"),
      documentId: String(document.id),
    };
  });
