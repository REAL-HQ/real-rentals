import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { X, Loader2, Copy, Printer, Check, ShieldCheck } from "lucide-react";
import { getVehicleShare, type VehicleShare } from "@/lib/vehicles.functions";
import { resolvePhotoUrl } from "@/lib/photoUrl";
import { MicroLabel } from "./ui";

// Hand someone the details on a car without retyping them.
//
// The toggles narrow the payload; they cannot widen it. Financing, keys, GPS
// credentials and internal notes are not options here because they are not
// options in the server function that builds this — they are simply not
// fetched. A checkbox is a thing that can be ticked by mistake.

type Opts = {
  includeVin: boolean;
  includeRegistration: boolean;
  includeInsurance: boolean;
  includePolicyNumber: boolean;
  includeRates: boolean;
  includePhotos: boolean;
};

const DEFAULTS: Opts = {
  includeVin: true,
  includeRegistration: true,
  includeInsurance: true,
  includePolicyNumber: false,
  includeRates: false,
  includePhotos: true,
};

export function ShareVehicleDialog({
  vehicleId,
  onClose,
}: {
  vehicleId: string;
  onClose: () => void;
}) {
  const build = useServerFn(getVehicleShare);
  const [opts, setOpts] = useState<Opts>(DEFAULTS);
  const [data, setData] = useState<VehicleShare | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setData(await build({ data: { id: vehicleId, ...opts } }));
    } catch {
      toast.error("Could not build the summary.");
    } finally {
      setLoading(false);
    }
  }, [build, vehicleId, opts]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function asText(): string {
    if (!data) return "";
    const lines = [data.title, data.unitLabel !== data.title ? `Unit ${data.unitLabel}` : "", ""];
    for (const s of data.sections) {
      lines.push(s.heading.toUpperCase());
      for (const r of s.rows) lines.push(r.label ? `  ${r.label}: ${r.value}` : `  ${r.value}`);
      lines.push("");
    }
    lines.push("REAL RENTALS · drivereal.com");
    return lines.filter((l, i, a) => !(l === "" && a[i - 1] === "")).join("\n");
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(asText());
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error("Could not copy — select the text and copy it manually.");
    }
  }

  const set = <K extends keyof Opts>(k: K, v: Opts[K]) => setOpts((o) => ({ ...o, [k]: v }));

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 print:static print:p-0">
      <div className="absolute inset-0 bg-black/40 print:hidden" onClick={onClose} />
      <div className="relative w-full max-w-3xl max-h-[90vh] bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden print:max-h-none print:rounded-none print:shadow-none print:max-w-none">
        <header className="flex items-center gap-3 border-b border-[#EDEDF0] px-5 py-4 print:hidden">
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-semibold text-[#111114]">Share vehicle info</h2>
            <p className="text-[12px] text-[#9A9AA3] mt-0.5">
              Financing, keys, GPS identifiers and internal notes are never included.
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-[#9A9AA3] hover:text-[#111114] hover:bg-[#F4F4F6]"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto print:overflow-visible">
          <div className="border-b border-[#EDEDF0] bg-[#FAFAFB] px-5 py-3.5 print:hidden">
            <MicroLabel className="mb-2">Include</MicroLabel>
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              <Opt label="VIN" on={opts.includeVin} onChange={(v) => set("includeVin", v)} />
              <Opt
                label="Registration & plate"
                on={opts.includeRegistration}
                onChange={(v) => set("includeRegistration", v)}
              />
              <Opt
                label="Insurance"
                on={opts.includeInsurance}
                onChange={(v) => set("includeInsurance", v)}
              />
              <Opt
                label="Policy number"
                on={opts.includePolicyNumber}
                disabled={!opts.includeInsurance}
                onChange={(v) => set("includePolicyNumber", v)}
              />
              <Opt label="Rates" on={opts.includeRates} onChange={(v) => set("includeRates", v)} />
              <Opt
                label="Photos"
                on={opts.includePhotos}
                onChange={(v) => set("includePhotos", v)}
              />
            </div>
          </div>

          <div className="px-6 py-6 print:px-0">
            {loading && !data ? (
              <div className="flex items-center gap-2 text-[13px] text-[#9A9AA3] py-10 justify-center">
                <Loader2 className="w-4 h-4 animate-spin" /> Building summary…
              </div>
            ) : !data ? (
              <div className="text-[13px] text-[#9A9AA3] py-10 text-center">
                That vehicle could not be found.
              </div>
            ) : (
              <article className={loading ? "opacity-50 transition-opacity" : "transition-opacity"}>
                <div className="flex items-baseline justify-between gap-4 border-b-2 border-[#111114] pb-3">
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#D03020]">
                      Real Rentals
                    </div>
                    <h1 className="text-[22px] font-semibold text-[#111114] mt-1">{data.title}</h1>
                  </div>
                  <div className="text-right text-[11px] text-[#9A9AA3]">
                    <div className="font-medium text-[#111114]">{data.unitLabel}</div>
                    <div>
                      {new Date(data.generatedAt).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </div>
                  </div>
                </div>

                {data.photos.length > 0 && (
                  <div className="grid grid-cols-3 gap-2 mt-5">
                    {data.photos.map((p, i) => {
                      const url = resolvePhotoUrl(p);
                      return url ? (
                        <img
                          key={i}
                          src={url}
                          alt=""
                          className="w-full aspect-[4/3] object-cover rounded-lg bg-[#F4F4F6]"
                        />
                      ) : null;
                    })}
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-10 gap-y-6 mt-6">
                  {data.sections.map((s) => (
                    <section key={s.heading} className="break-inside-avoid">
                      <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#9A9AA3] pb-1.5 border-b border-[#EDEDF0]">
                        {s.heading}
                      </div>
                      <dl className="mt-1.5">
                        {s.rows.map((r, i) => (
                          <div key={i} className="flex items-baseline gap-3 py-1">
                            {r.label && (
                              <dt className="w-[45%] shrink-0 text-[12px] text-[#9A9AA3]">
                                {r.label}
                              </dt>
                            )}
                            <dd className="min-w-0 flex-1 text-[13px] text-[#111114] break-words">
                              {r.value}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    </section>
                  ))}
                </div>

                <div className="mt-8 pt-3 border-t border-[#EDEDF0] text-[11px] text-[#9A9AA3]">
                  REAL RENTALS · drivereal.com
                </div>
              </article>
            )}
          </div>
        </div>

        <footer className="flex items-center gap-2 border-t border-[#EDEDF0] px-5 py-3.5 print:hidden">
          <div className="flex items-center gap-1.5 text-[11px] text-[#9A9AA3] flex-1 min-w-0">
            <ShieldCheck className="w-3.5 h-3.5 shrink-0 text-[#50C060]" />
            <span className="truncate">Recorded in Activity as shared.</span>
          </div>
          <button
            onClick={copy}
            disabled={!data}
            className="inline-flex items-center gap-1.5 rounded-md border border-[#EDEDF0] px-3.5 py-2 text-[13px] text-[#111114] hover:bg-[#FAFAFB] transition-colors disabled:opacity-50"
          >
            {copied ? (
              <Check className="w-3.5 h-3.5 text-[#50C060]" />
            ) : (
              <Copy className="w-3.5 h-3.5" />
            )}
            {copied ? "Copied" : "Copy as text"}
          </button>
          <button
            onClick={() => window.print()}
            disabled={!data}
            className="inline-flex items-center gap-1.5 rounded-md bg-[#111114] px-4 py-2 text-[13px] font-medium text-white hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            <Printer className="w-3.5 h-3.5" /> Print / PDF
          </button>
        </footer>
      </div>
    </div>
  );
}

function Opt({
  label,
  on,
  onChange,
  disabled,
}: {
  label: string;
  on: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label
      className={`inline-flex items-center gap-2 text-[12px] ${disabled ? "opacity-40" : "cursor-pointer"}`}
    >
      <input
        type="checkbox"
        checked={on && !disabled}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="h-3.5 w-3.5 rounded border-[#EDEDF0] accent-[#D03020]"
      />
      <span className="text-[#111114]">{label}</span>
    </label>
  );
}
