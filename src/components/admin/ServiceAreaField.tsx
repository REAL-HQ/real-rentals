import { useEffect, useState } from "react";
import { composeServiceArea, parseServiceArea, composeMileage, parseMileage, PERIOD_LABEL, type ServiceArea, type Mileage, type MileagePeriod } from "@/lib/service-area";

const input = "h-8 w-full rounded-md border bg-background px-2 text-[12px]";

/** Service Area: where the renter may drive. Explicit choice only — never defaults to a restriction. */
export function ServiceAreaField({ value, onChange, missing }: { value: string; onChange: (v: string) => void; missing?: boolean }) {
  const [a, setA] = useState<ServiceArea | { mode: "custom"; text: string }>(() => parseServiceArea(value));
  useEffect(() => { onChange(a.mode === "custom" ? a.text : composeServiceArea(a)); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [JSON.stringify(a)]);
  const pick = (m: string) => setA(
    m === "radius" ? { mode: "radius", miles: 0, center: "", region: "" }
      : m === "region" ? { mode: "region", region: "" }
      : m === "none" ? { mode: "none" }
      : m === "custom" ? { mode: "custom", text: value }
      : { mode: "unset" });
  return (
    <div className={`space-y-1.5 rounded-md border p-2 text-[12px] ${missing ? "border-destructive" : ""}`}>
      <select aria-label="Service Area Type" className={input} value={a.mode} onChange={(e) => pick(e.target.value)}>
        <option value="unset">Not Set — Choose One</option>
        <option value="radius">Geographic Radius</option>
        <option value="region">Permitted States Or Regions</option>
        <option value="custom">Custom Geographic Restriction</option>
        <option value="none">No Geographic Restriction</option>
      </select>
      {a.mode === "radius" && (
        <div className="grid grid-cols-[80px_1fr] gap-1.5">
          <input className={input} type="number" min={1} placeholder="Miles" aria-label="Radius Miles" value={a.miles || ""} onChange={(e) => setA({ ...a, miles: Number(e.target.value) })} />
          <input className={input} placeholder="Center (e.g. Tampa, FL)" aria-label="Radius Center" value={a.center} onChange={(e) => setA({ ...a, center: e.target.value })} />
          <input className={`${input} col-span-2`} placeholder="Limited to state/region (optional)" aria-label="Radius Region" value={a.region} onChange={(e) => setA({ ...a, region: e.target.value })} />
        </div>
      )}
      {a.mode === "region" && <input className={input} placeholder="e.g. Florida" aria-label="Permitted States Or Regions" value={a.region} onChange={(e) => setA({ ...a, region: e.target.value })} />}
      {a.mode === "custom" && <input className={input} aria-label="Custom Service Area" value={a.text} onChange={(e) => setA({ mode: "custom", text: e.target.value })} />}
      {a.mode === "none" && <p className="text-[11px] text-[#B45309]">Choose this only when no geographic limit has been approved.</p>}
      <p className="text-muted-foreground">Prints as: <span className="font-medium text-foreground">{value || "Not Set"}</span></p>
    </div>
  );
}

/** Mileage Allowance: how far the renter may drive, plus the excess-mileage fee when limited. */
export function MileageField({ value, fee, onChange, onFee, missing }: {
  value: string; fee: string; onChange: (v: string) => void; onFee: (v: string) => void; missing?: boolean;
}) {
  const [m, setM] = useState<Mileage | { mode: "custom"; text: string }>(() => parseMileage(value));
  useEffect(() => {
    onChange(m.mode === "custom" ? m.text : composeMileage(m));
    if (m.mode === "unlimited") onFee("");
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [JSON.stringify(m)]);
  return (
    <div className={`space-y-1.5 rounded-md border p-2 text-[12px] ${missing ? "border-destructive" : ""}`}>
      <select aria-label="Mileage Allowance Type" className={input} value={m.mode} onChange={(e) => setM(
        e.target.value === "unlimited" ? { mode: "unlimited" } : e.target.value === "limited" ? { mode: "limited", miles: 0, period: "week" } : e.target.value === "custom" ? { mode: "custom", text: value } : { mode: "unset" })}>
        <option value="unset">Not Set — Choose One</option>
        <option value="unlimited">Unlimited Miles</option>
        <option value="limited">Limited Miles</option>
        <option value="custom">Custom Wording</option>
      </select>
      {m.mode === "limited" && (
        <>
          <div className="grid grid-cols-[1fr_120px] gap-1.5">
            <input className={input} type="number" min={1} placeholder="Allowed miles" aria-label="Allowed Miles" value={m.miles || ""} onChange={(e) => setM({ ...m, miles: Number(e.target.value) })} />
            <select aria-label="Mileage Period" className={input} value={m.period} onChange={(e) => setM({ ...m, period: e.target.value as MileagePeriod })}>
              {(Object.keys(PERIOD_LABEL) as MileagePeriod[]).map((p) => <option key={p} value={p}>{PERIOD_LABEL[p]}</option>)}
            </select>
          </div>
          <label className="block">Excess-Mileage Fee
            <input className={input} placeholder="e.g. $0.25 per mile over the allowance" aria-label="Excess-Mileage Fee" value={fee} onChange={(e) => onFee(e.target.value)} />
          </label>
          <p className="rounded bg-warning/10 px-2 py-1 text-[11px]">New contract wording: v1.10 and v1.10.2 have no excess-mileage clause. The fee is saved with the draft but is not printed or charged until an approved revised clause is added after Owner/legal review.</p>
        </>
      )}
      {m.mode === "custom" && <input className={input} aria-label="Custom Mileage Allowance" value={m.text} onChange={(e) => setM({ mode: "custom", text: e.target.value })} />}
      <p className="text-muted-foreground">Prints as: <span className="font-medium text-foreground">{value || "Not Set"}</span>{m.mode === "unlimited" ? " · no excess-mileage fee" : ""}</p>
    </div>
  );
}
