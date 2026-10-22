import { Phone } from "lucide-react";
import { useBusinessPhone } from "@/lib/company.functions";
import type { PickupChecklistItem } from "@/lib/portal-pickup-checklist";

/** Read-only. The phone is the company number from useBusinessPhone(). */
export function PickupChecklistCard({ items }: { items: PickupChecklistItem[] }) {
  const businessPhone = useBusinessPhone();
  return (
    <section className="rounded-2xl border border-border bg-white p-5">
      <div className="text-[11px] uppercase tracking-[0.25em] font-semibold text-real-red">You're Approved</div>
      <h2 className="mt-3 text-lg font-semibold">Get Ready For Pickup</h2>
      {items.length > 0 ? (
        <ul className="mt-4 divide-y divide-border">
          {items.map((item) => (
            <li key={item.id} className="flex items-baseline justify-between gap-3 py-3">
              <span className="text-sm font-medium">{item.label}</span>
              <span className="text-sm text-muted-foreground text-right">{item.detail}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <a
        href={businessPhone.tel}
        className="mt-4 inline-flex min-h-11 items-center gap-2 text-sm font-medium text-real-red"
      >
        <Phone className="w-4 h-4" />
        Call Support
        <span className="text-muted-foreground font-normal">{businessPhone.display}</span>
      </a>
    </section>
  );
}
