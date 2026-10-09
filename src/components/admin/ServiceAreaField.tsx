import { useEffect, useState } from "react";
import { composeServiceArea, parseServiceArea, type ServiceArea } from "@/lib/service-area";

const input = "h-8 w-full rounded-md border bg-background px-2 text-[12px]";

/** Service Area / Mileage Limit: explicit choice only — never defaults to a restriction. */
export function ServiceAreaField({ value, onChange, missing }: { value: string; onChange: (v: string) => void; missing?: boolean }) {
  const parsed = parseServiceArea(value);
  const [a, setA] = useState<ServiceArea | { mode: "custom"; text: string }>(parsed);
  useEffect(() => { if (a.mode !== "custom") onChange(composeServiceArea(a)); else onChange(a.text); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [JSON.stringify(a)]);
  const mode = a.mode;
  const pick = (m: string) => setA(
    m === "radius" ? { mode: "radius", miles: 0, center: "", region: "" }
      : m === "region" ? { mode: "region", region: "", weeklyMiles: null }
      : m === "unlimited" ? { mode: "unlimited", region: "" }
      : m === "custom" ? { mode: "custom", text: value }
      : { mode: "unset" });
  return (
    <div className={`space-y-1.5 rounded-md border p-2 text-[12px] ${missing ? "border-destructive" : ""}`}>
      <select aria-label="Service Area Type" className={input} value={mode} onChange={(e) => pick(e.target.value)}>
        <option value="unset">Not Set — Choose One</option>
        <option value="radius">Mileage Radius</option>
        <option value="region">Geographic Area</option>
        <option value="unlimited">Unlimited Mileage</option>
        <option value="custom">Custom Wording</option>
      </select>
      {a.mode === "radius" && (
        <div className="grid grid-cols-[80px_1fr] gap-1.5">
          <input className={input} type="number" min={1} placeholder="Miles" aria-label="Radius Miles" value={a.miles || ""} onChange={(e) => setA({ ...a, miles: Number(e.target.value) })} />
          <input className={input} placeholder="Center (e.g. Tampa, FL)" aria-label="Radius Center" value={a.center} onChange={(e) => setA({ ...a, center: e.target.value })} />
          <input className={`${input} col-span-2`} placeholder="Limited to state/region (optional)" aria-label="Radius Region" value={a.region} onChange={(e) => setA({ ...a, region: e.target.value })} />
        </div>
      )}
      {a.mode === "region" && (
        <div className="grid grid-cols-[1fr_120px] gap-1.5">
          <input className={input} placeholder="Area (e.g. Florida)" aria-label="Geographic Area" value={a.region} onChange={(e) => setA({ ...a, region: e.target.value })} />
          <input className={input} type="number" min={1} placeholder="Miles / week" aria-label="Weekly Mileage Limit" value={a.weeklyMiles ?? ""} onChange={(e) => setA({ ...a, weeklyMiles: e.target.value ? Number(e.target.value) : null })} />
        </div>
      )}
      {a.mode === "unlimited" && (
        <input className={input} placeholder="Limited to state/region (optional)" aria-label="Unlimited Region" value={a.region} onChange={(e) => setA({ ...a, region: e.target.value })} />
      )}
      {a.mode === "custom" && (
        <input className={input} aria-label="Custom Service Area" value={a.text} onChange={(e) => setA({ mode: "custom", text: e.target.value })} />
      )}
      <p className="text-muted-foreground">Prints as: <span className="font-medium text-foreground">{value || "Not Set"}</span></p>
    </div>
  );
}
