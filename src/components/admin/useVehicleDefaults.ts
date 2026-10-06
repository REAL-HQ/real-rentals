import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { listVehicleDefaults } from "@/lib/vehicle-defaults.functions";
import { DEFAULT_FIELDS, type DefaultField, type VehicleDefault } from "@/lib/vehicle-defaults";

type Prices = Record<DefaultField, string>;

/**
 * Pre-fills Weekly Rate / Monthly Rate / Deposit from the company default for
 * the chosen body type. Values are visible and editable before saving; a field
 * the user already typed in is never overwritten.
 */
export function useVehicleDefaultPrefill(bodyType: string, prices: Prices, setPrices: (next: Prices) => void) {
  const list = useServerFn(listVehicleDefaults);
  const [defaults, setDefaults] = useState<VehicleDefault[]>([]);
  const touched = useRef<Partial<Record<DefaultField, boolean>>>({});
  const filledFrom = useRef<string | null>(null);
  const [applied, setApplied] = useState<string | null>(null);

  useEffect(() => {
    list().then((r) => setDefaults(r.defaults)).catch(() => setDefaults([]));
  }, [list]);

  useEffect(() => {
    const def = defaults.find((d) => d.body_type === bodyType);
    if (!def || filledFrom.current === bodyType) return;
    const next = { ...prices };
    let any = false;
    for (const f of DEFAULT_FIELDS) {
      if (def[f] == null) continue;
      if (touched.current[f] && prices[f].trim()) continue; // never overwrite a typed value
      next[f] = String(def[f]);
      any = true;
    }
    filledFrom.current = bodyType;
    if (any) { setPrices(next); setApplied(bodyType); } else setApplied(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bodyType, defaults]);

  return {
    markTouched: (f: DefaultField) => { touched.current[f] = true; },
    appliedFrom: applied,
    hasDefault: (t: string) => defaults.some((d) => d.body_type === t),
  };
}
