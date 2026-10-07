import { createServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toBusinessPhone, type BusinessPhone } from "@/lib/company";

/** Public: returns only the company phone, nothing else from settings. */
export const getPublicBusinessPhone = createServerFn({ method: "GET" }).handler(
  async (): Promise<BusinessPhone> => {
    const { getBusinessPhone } = await import("@/lib/company.server");
    return getBusinessPhone();
  },
);

/**
 * The company phone for display. Starts on the default (so SSR and first
 * paint agree) and switches to the saved setting once read.
 */
export function useBusinessPhone(): BusinessPhone {
  const [phone, setPhone] = useState<BusinessPhone>(() => toBusinessPhone(null));
  useEffect(() => {
    let alive = true;
    getPublicBusinessPhone()
      .then((p) => alive && setPhone(p))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  return phone;
}
