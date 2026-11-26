import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getApplicationForWizard, replaceApplicantDocument, addApplicantDocument } from "@/lib/applications.functions";
import { uploadApplicantFile, type UploadKind } from "@/lib/applicant-upload";
import { Logo } from "@/components/site/Logo";
import { FileUploader } from "@/components/FileUploader";

/**
 * Documents-only page behind the secure link, for approved renters before
 * pickup (t466u). The Driver Portal opens at pickup, so this is where a
 * renter re-sends a blurry license or a new insurance card. Only documents
 * can change here; the rest of the application stays as staff approved it.
 */
type Row = { kind: UploadKind; label: string; hint: string; onFile: boolean };

const ACCEPT = "image/*,application/pdf";

export function ApplicantDocumentsPanel({ token }: { token: string }) {
  const load = useServerFn(getApplicationForWizard);
  const replace = useServerFn(replaceApplicantDocument);
  const add = useServerFn(addApplicantDocument);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [name, setName] = useState("");
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<UploadKind | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function refresh() {
    try {
      const a = await load({ data: { token } });
      setName(a.full_name || "");
      setRows([
        { kind: "license", label: "Driver's License", hint: "A clear photo of the front of your license.", onFile: a.license_photo_on_file },
        { kind: "insurance", label: "Insurance", hint: "Your current insurance card or declarations page.", onFile: a.insurance_doc_on_file },
        { kind: "gig_profile", label: "Gig Profile", hint: "A screenshot of your gig app profile.", onFile: a.profile_screenshot_on_file },
        { kind: "trip_history", label: "Trip History", hint: "Screenshots of your recent trips or earnings.", onFile: a.trip_screenshot_names.length > 0 },
        { kind: "income", label: "Proof Of Income", hint: "A recent pay statement or earnings summary.", onFile: a.income_proof_on_file },
      ]);
    } catch {
      setFailed(true);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  /**
   * Throws on failure so the uploader offers Retry. "add" keeps every file
   * already on file and adds this one beside them; "replace" is the explicit
   * swap of the main file.
   */
  async function onPick(kind: UploadKind, file: File, mode: "add" | "replace") {
    setBusy(kind);
    setMessage(null);
    try {
      const { path } = await uploadApplicantFile({ token, kind, file });
      if (mode === "add") {
        await add({ data: { token, kind, path } });
        setMessage({ ok: true, text: "Thanks — Your File Was Added. Our Team Will Review It." });
      } else {
        const r = await replace({ data: { token, kind, path } });
        setMessage({ ok: true, text: r.replaced ? "Thanks — Your New File Replaced The Old One. Our Team Will Review It." : "Thanks — Your File Is Uploaded. Our Team Will Review It." });
      }
      await refresh();
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : "We Couldn't Upload That. Please Try Again." });
      throw e;
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="max-w-lg w-full rounded-2xl border border-border bg-white p-8">
        <div className="flex justify-center">
          <Logo offset={false} />
        </div>
        <h1 className="mt-6 text-2xl font-semibold text-center">Update Your Documents{name ? `, ${name}` : ""}</h1>
        <p className="mt-3 text-sm text-muted-foreground leading-relaxed text-center">
          Upload a missing document, add more files to any section, or replace one, like a clearer photo of your driver's license. Your driver portal opens once your rental is paid at pickup.
        </p>
        {failed ? (
          <p className="mt-6 text-sm text-red-700 text-center">This Link Has Expired. Request A New One From The Sign-In Page.</p>
        ) : !rows ? (
          <p className="mt-6 text-sm text-muted-foreground text-center">Loading Your Documents…</p>
        ) : (
          <ul className="mt-6 divide-y divide-border">
            {rows.map((row) => (
              <li key={row.kind} className="flex items-center justify-between gap-4 py-3">
                <div>
                  <p className="text-sm font-medium">{row.label}</p>
                  <p className="text-xs text-muted-foreground">{row.onFile ? "On File" : "Not On File Yet"} · {row.hint}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <FileUploader
                    variant="inline"
                    accept={ACCEPT}
                    camera
                    multiple
                    disabled={busy !== null && busy !== row.kind}
                    busy={busy === row.kind}
                    label={row.onFile ? "Add Another" : "Upload"}
                    context={row.label}
                    upload={(file) => onPick(row.kind, file, "add")}
                    className="shrink-0"
                  />
                  {row.onFile && row.kind !== "trip_history" ? (
                    <FileUploader
                      variant="inline"
                      accept={ACCEPT}
                      camera
                      disabled={busy !== null && busy !== row.kind}
                      busy={busy === row.kind}
                      label="Replace"
                      context={`${row.label} (Replaces The Main File)`}
                      upload={(file) => onPick(row.kind, file, "replace")}
                      className="shrink-0"
                    />
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
        {message ? (
          <p role="status" className={`mt-4 text-sm ${message.ok ? "text-emerald-700" : "text-red-700"}`}>{message.text}</p>
        ) : null}
      </div>
    </div>
  );
}
