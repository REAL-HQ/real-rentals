import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { Scale } from "lucide-react";
import { listCollections, type CollectionItemRow } from "@/lib/collections.functions";
import { collectionBalance, collectionReasonLabel, collectionStatusLabel, collectionsTotal, isOpenCollectionStatus } from "@/lib/collections";

const usd = (v: number) => `$${v.toFixed(2)}`;
export const COLLECTIONS_ITEM_HREF = (itemId: string) => `/admin?tab=payments&filter=collections-tab&id=${itemId}`;

/**
 * Renter profile card: what this renter still owes in Collections, each line linking to it on
 * Payments > Collections. Managers and Owners only; renders nothing when there are no open lines.
 */
export function CollectionsCard({ applicationId, canSee }: { applicationId: string; canSee: boolean }) {
  const load = useServerFn(listCollections);
  const [items, setItems] = useState<CollectionItemRow[] | null>(null);
  useEffect(() => {
    if (!canSee) return;
    let live = true;
    load({ data: { applicationId } })
      .then((d) => { if (live) setItems(d.items); })
      .catch(() => { if (live) setItems([]); });
    return () => { live = false; };
  }, [load, applicationId, canSee]);
  if (!canSee || !items) return null;
  const open = items.filter((i) => isOpenCollectionStatus(i.status));
  if (open.length === 0) return null;
  return (
    <section data-testid="collections-card" className="rounded-xl border border-rose-200 bg-rose-50 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Scale className="h-4 w-4 text-rose-800" />
        <h3 className="text-sm font-semibold text-rose-900">Collections</h3>
        <span className="ml-auto text-sm font-semibold tabular-nums text-[#D03020]" data-testid="collections-card-total">{usd(collectionsTotal(open))}</span>
      </div>
      <p className="mt-1 text-xs text-rose-900/80">Owed after the rental ended. Not part of Overdue, and never texted or emailed automatically.</p>
      <ul className="mt-2 space-y-1">
        {open.map((i) => (
          <li key={i.id} className="flex items-center gap-2 text-[12px]">
            <Link to="/admin" search={{ tab: "payments", filter: "collections-tab", id: i.id } as never} className="font-medium text-[#111114] hover:underline">
              {collectionReasonLabel(i.reason)}
            </Link>
            <span className="text-muted-foreground">{collectionStatusLabel(i.status)}</span>
            <span className="ml-auto tabular-nums">{usd(collectionBalance(i))}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
