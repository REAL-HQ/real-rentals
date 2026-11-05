import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { LayoutGrid, List, Phone, Globe, MapPin } from "lucide-react";
import { getRenterVendors, setRenterVendorView } from "@/lib/renter-portal.functions";
import {
  VENDOR_VIEW_STORAGE_KEY,
  parseVendorView,
  vendorCategoryLabel,
  vendorInitials,
  type RenterVendor,
  type VendorView,
} from "@/lib/renter-portal";

export function VendorLogo({ vendor, size = 48 }: { vendor: Pick<RenterVendor, "name" | "logo_url">; size?: number }) {
  const [broken, setBroken] = useState(false);
  const style = { width: size, height: size };
  if (vendor.logo_url && !broken) {
    return (
      <img src={vendor.logo_url} alt="" style={style} referrerPolicy="no-referrer" loading="lazy"
        className="rounded-lg object-contain bg-white border border-border" onError={() => setBroken(true)} />
    );
  }
  return (
    <div style={style} className="rounded-lg bg-soft border border-border flex items-center justify-center font-semibold text-sm" aria-hidden>
      {vendorInitials(vendor.name)}
    </div>
  );
}

/** Recommended vendors. View is saved on the renter's profile, with localStorage as a fallback. */
export function RenterVendors() {
  const read = useServerFn(getRenterVendors);
  const save = useServerFn(setRenterVendorView);
  const { data, isLoading } = useQuery({ queryKey: ["renter-vendors"], queryFn: () => read() });
  const [view, setView] = useState<VendorView>("grid");

  useEffect(() => {
    const local = typeof window !== "undefined" ? parseVendorView(window.localStorage.getItem(VENDOR_VIEW_STORAGE_KEY)) : null;
    const v = data?.view ?? local;
    if (v) setView(v);
  }, [data?.view]);

  const choose = (v: VendorView) => {
    setView(v);
    try {
      window.localStorage.setItem(VENDOR_VIEW_STORAGE_KEY, v);
    } catch {
      /* private mode */
    }
    void save({ data: { view: v } }).catch(() => undefined);
  };

  if (isLoading) return <div className="text-sm text-muted-foreground">Loading…</div>;
  const vendors = data?.vendors ?? [];

  return (
    <div className="rounded-2xl border border-border bg-white p-5 max-w-4xl">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold">Recommended Vendors</h3>
          <p className="text-xs text-muted-foreground">Roadside help, lockouts, mechanics, car washes and more.</p>
        </div>
        <div className="inline-flex rounded-lg border border-border overflow-hidden" role="group" aria-label="View">
          {(["grid", "list"] as const).map((v) => (
            <button key={v} type="button" aria-pressed={view === v} onClick={() => choose(v)}
              className={`px-3 py-1.5 text-xs inline-flex items-center gap-1 ${view === v ? "bg-foreground text-background" : ""}`}>
              {v === "grid" ? <LayoutGrid className="w-3.5 h-3.5" /> : <List className="w-3.5 h-3.5" />}
              {v === "grid" ? "Grid" : "List"}
            </button>
          ))}
        </div>
      </div>

      {vendors.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">No vendors listed yet.</p>
      ) : view === "grid" ? (
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {vendors.map((v) => (
            <div key={v.id} className="rounded-xl border border-border p-4 flex flex-col gap-2">
              <div className="flex items-center gap-3">
                <VendorLogo vendor={v} />
                <div className="min-w-0">
                  <div className="font-medium truncate">{v.name}</div>
                  <div className="text-xs text-muted-foreground">{vendorCategoryLabel(v.category)}</div>
                </div>
              </div>
              <Contact v={v} />
            </div>
          ))}
        </div>
      ) : (
        <ul className="mt-4 divide-y divide-border">
          {vendors.map((v) => (
            <li key={v.id} className="py-3 flex items-start gap-3">
              <VendorLogo vendor={v} size={36} />
              <div className="min-w-0 flex-1">
                <div className="font-medium">{v.name} <span className="text-xs text-muted-foreground">· {vendorCategoryLabel(v.category)}</span></div>
                <Contact v={v} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Contact({ v }: { v: RenterVendor }) {
  return (
    <div className="text-xs space-y-1">
      {v.phone ? <a className="flex items-center gap-1 text-real-red hover:underline" href={`tel:${v.phone.replace(/[^0-9+]/g, "")}`}><Phone className="w-3 h-3" />{v.phone}</a> : null}
      {v.website ? <a className="flex items-center gap-1 text-real-red hover:underline" href={v.website} target="_blank" rel="noreferrer noopener"><Globe className="w-3 h-3" />Website</a> : null}
      {v.address ? <div className="flex items-center gap-1 text-muted-foreground"><MapPin className="w-3 h-3" />{v.address}</div> : null}
      {v.notes ? <div className="text-muted-foreground">{v.notes}</div> : null}
    </div>
  );
}
