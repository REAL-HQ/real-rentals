import { useEffect, useState, type FormEvent } from "react";
import { useServerFn } from "@tanstack/react-start";
import { FileText, X } from "lucide-react";
import { SWAP_ENABLED } from "@/lib/record-numbers";
import {
  linkReplacementAgreement,
  loadReplacementAgreement,
  previewReplacementAgreement,
  sendReplacementAgreement,
  type ReplacementAgreementReadiness,
} from "@/lib/replacement-agreement.functions";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type PreviewShape = {
  fingerprint: string | null;
  canSend: boolean;
  sendRefusal: string | null;
  blockers: { label: string }[];
  companyMissing: string[];
  vehicleId: string | null;
};

export function ReplacementAgreement({ rentalId }: { rentalId: string }) {
  const [open, setOpen] = useState(false);
  if (!SWAP_ENABLED) return null;
  return (
    <div className="mt-3">
      <button
        type="button"
        data-testid="send-replacement-agreement"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-md border border-[#EDEDF0] bg-white px-2.5 py-1 text-[12px] text-[#55555E]"
      >
        <FileText className="h-3 w-3" /> Send Replacement Agreement
      </button>
      {SWAP_ENABLED && open ? (
        <ReplacementAgreementDialog rentalId={rentalId} onClose={() => setOpen(false)} />
      ) : null}
    </div>
  );
}

function ReplacementAgreementDialog({ rentalId, onClose }: { rentalId: string; onClose: () => void }) {
  const load = useServerFn(loadReplacementAgreement);
  const preview = useServerFn(previewReplacementAgreement);
  const send = useServerFn(sendReplacementAgreement);
  const link = useServerFn(linkReplacementAgreement);
  const [readiness, setReadiness] = useState<ReplacementAgreementReadiness | null>(null);
  const [previewed, setPreviewed] = useState<PreviewShape | null>(null);
  const [agreementId, setAgreementId] = useState("");
  const [companyAck, setCompanyAck] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linked, setLinked] = useState(false);
  const [busy, setBusy] = useState(false);
  const field = "mt-1 w-full rounded-md border border-[#EDEDF0] bg-white px-2.5 py-1.5 text-[13px]";

  useEffect(() => {
    let cancelled = false;
    load({ data: { rentalId } })
      .then((row) => {
        if (!cancelled) setReadiness(row);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Replacement Agreement could not be loaded");
      });
    return () => {
      cancelled = true;
    };
  }, [load, rentalId]);

  async function onPreview() {
    if (!SWAP_ENABLED || !readiness?.applicationId || !readiness.rentalVehicleId) return;
    setBusy(true);
    setError(null);
    try {
      const result = (await preview({
        data: { rentalId },
      })) as PreviewShape;
      if (result.vehicleId !== readiness.rentalVehicleId) {
        setPreviewed(null);
        setError("The agreement vehicle must be the rental's current vehicle.");
        return;
      }
      setPreviewed(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Preview could not be built");
    } finally {
      setBusy(false);
    }
  }

  async function onSend() {
    if (!SWAP_ENABLED || !readiness?.rentalVehicleId || !previewed?.fingerprint || !previewed.canSend) return;
    if (previewed.companyMissing.length > 0 && !companyAck) return;
    setBusy(true);
    setError(null);
    try {
      await send({
        data: {
          rentalId,
          fingerprint: previewed.fingerprint,
          companyAck: previewed.companyMissing.length > 0 ? companyAck : undefined,
        },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Replacement Agreement could not be sent");
    } finally {
      setBusy(false);
    }
  }

  async function onLink(event: FormEvent) {
    event.preventDefault();
    if (!SWAP_ENABLED) return;
    setBusy(true);
    setError(null);
    try {
      const id = agreementId.trim();
      if (!UUID.test(id)) throw new Error("Agreement must be the agreement id");
      await link({ data: { rentalId, agreementId: id } });
      setLinked(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Evidence could not be linked");
    } finally {
      setBusy(false);
    }
  }

  const canSend = Boolean(
    readiness?.rentalVehicleId &&
      previewed?.canSend &&
      previewed.fingerprint &&
      previewed.vehicleId === readiness.rentalVehicleId &&
      (previewed.companyMissing.length === 0 || companyAck),
  );

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:items-center">
      <div
        data-testid="replacement-agreement-dialog"
        className="w-full max-w-lg rounded-2xl bg-white shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-[#EDEDF0] px-5 py-4">
          <h3 className="text-[15px] font-semibold text-[#111114]">Replacement Agreement</h3>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1.5 text-[#9A9AA3]">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-4 p-5 text-[13px] text-[#55555E]">
          <p>Signing uses the existing agreement send. The agreement names the rental's current vehicle. Evidence is linked after the agreement is signed and archived.</p>
          {!readiness && !error && <p>Loading</p>}
          {readiness && (
            <div className="space-y-3">
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  void onPreview();
                }}
                className="rounded-md border border-[#EDEDF0] bg-white px-3 py-1.5 text-[13px] disabled:opacity-50"
              >
                Preview Agreement
              </button>
              {previewed?.sendRefusal && <p>{previewed.sendRefusal}</p>}
              {previewed?.blockers?.length ? (
                <ul className="list-disc pl-4">
                  {previewed.blockers.map((blocker) => (
                    <li key={blocker.label}>{blocker.label}</li>
                  ))}
                </ul>
              ) : null}
              {previewed && previewed.companyMissing.length > 0 && (
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={companyAck} onChange={(e) => setCompanyAck(e.target.checked)} />
                  Company Details Are Incomplete
                </label>
              )}
              <button
                type="button"
                disabled={busy || !canSend}
                onClick={() => {
                  void onSend();
                }}
                className="rounded-md bg-black px-3 py-1.5 text-[13px] text-white disabled:opacity-50"
              >
                Send Replacement Agreement
              </button>
            </div>
          )}
          <form
            onSubmit={(event) => {
              void onLink(event);
            }}
            className="space-y-2 border-t border-[#EDEDF0] pt-4"
          >
            <label className="block text-[12px] text-[#55555E]">
              Agreement
              <input className={field} value={agreementId} onChange={(e) => setAgreementId(e.target.value)} autoComplete="off" />
            </label>
            <button
              type="submit"
              disabled={busy}
              className="rounded-md bg-black px-3 py-1.5 text-[13px] text-white disabled:opacity-50"
            >
              Link Evidence
            </button>
            {linked && <p>Evidence Linked</p>}
          </form>
          {error && <p className="text-[12px] text-[#D03020]">{error}</p>}
        </div>
      </div>
    </div>
  );
}
