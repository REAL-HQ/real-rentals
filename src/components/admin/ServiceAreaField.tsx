import { useEffect, useRef, useState } from "react";
import { areaConfigFrom, composeAreaConfig, type ServiceAreaConfig, composeMileage, parseMileage, PERIOD_LABEL, type Mileage, type MileagePeriod } from "@/lib/service-area";

const input = "h-8 w-full rounded-md border bg-background px-2 text-[12px]";

/**
 * Service Area: where the renter may drive. The ONE shared control for every
 * agreement template. Explicit choice only — never defaults to a restriction.
 * Each mode keeps its own inputs, so switching modes never discards what was
 * typed; only the selected mode prints.
 */
export function ServiceAreaField({ value, config, onChange, onConfig, missing }: {
  value: string; config?: string; onChange: (v: string) => void; onConfig?: (c: string) => void; missing?: boolean;
}) {
  const [c, setC] = useState<ServiceAreaConfig>(() => areaConfigFrom(config, value));
  const opened = useRef(true);
  useEffect(() => {
    // Opening a saved draft must not mark it changed; only real edits report.
    if (opened.current) { opened.current = false; return; }
    onChange(composeAreaConfig(c));
    onConfig?.(JSON.stringify(c));
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [JSON.stringify(c)]);
  const radiusIncomplete = c.mode === "radius" && (!(c.radius.miles > 0) || !c.radius.center.trim());
  return (
    <div className={`space-y-1.5 rounded-md border p-2 text-[12px] ${missing ? "border-destructive" : ""}`} data-testid="service-area-field">
      <select aria-label="Service Area Type" className={input} value={c.mode} onChange={(e) => setC({ ...c, mode: e.target.value as ServiceAreaConfig["mode"] })}>
        <option value="unset">Not Set — Choose One</option>
        <option value="radius">Geographic Radius</option>
        <option value="region">Permitted States / Regions</option>
        <option value="custom">Custom Geographic Restriction</option>
        <option value="none">No Geographic Restriction</option>
      </select>
      {c.mode === "radius" && (
        <div className="grid grid-cols-[90px_1fr] gap-1.5">
          <label className="block">Radius (Miles)<input className={input} type="number" min={1} aria-label="Radius Miles" value={c.radius.miles || ""} onChange={(e) => setC({ ...c, radius: { ...c.radius, miles: Number(e.target.value) } })} /></label>
          <label className="block">Center Location<input className={input} placeholder="e.g. Tampa, FL" aria-label="Radius Center" value={c.radius.center} onChange={(e) => setC({ ...c, radius: { ...c.radius, center: e.target.value } })} /></label>
          <label className="col-span-2 block">Permitted State / Region (Optional)<input className={input} placeholder="e.g. Florida" aria-label="Radius Region" value={c.radius.region} onChange={(e) => setC({ ...c, radius: { ...c.radius, region: e.target.value } })} /></label>
          {radiusIncomplete && <p className="col-span-2 text-[11px] text-destructive">Enter both the radius and the center location.</p>}
        </div>
      )}
      {c.mode === "region" && (
        <label className="block">Permitted States / Regions<input className={input} placeholder="e.g. Florida, Georgia" aria-label="Permitted States Or Regions" value={c.region} onChange={(e) => setC({ ...c, region: e.target.value })} /></label>
      )}
      {c.mode === "custom" && (
        <label className="block">Custom Restriction Wording<input className={input} placeholder="e.g. Hillsborough, Pinellas and Pasco counties only" aria-label="Custom Service Area" value={c.custom} onChange={(e) => setC({ ...c, custom: e.target.value })} /></label>
      )}
      {c.mode === "none" && <p className="text-[11px] text-[#B45309]">Choose this only when no geographic limit has been approved.</p>}
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
