import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Search, Loader2, X, Users, Car, Handshake } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { listDriverRows } from "@/lib/drivers-list.functions";
import { listVehicles } from "@/lib/vehicles-list.functions";
import { searchDestination, searchResults, type SearchKind, type SearchResult } from "./admin-search";

const GROUPS = [
  { kind: "drivers", label: "Drivers", icon: Users },
  { kind: "vehicles", label: "Vehicles", icon: Car },
  { kind: "partners", label: "Partners", icon: Handshake },
] as const;

export function AdminGlobalSearch({ userId, allowed, onSelect }: {
  userId: string;
  allowed: readonly SearchKind[];
  onSelect: (result: SearchResult) => void;
}) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const loadDrivers = useServerFn(listDriverRows);
  const loadVehicles = useServerFn(listVehicles);
  const kinds = GROUPS.filter((group) => allowed.includes(group.kind));
  const scope = kinds.map((group) => group.kind).join(",");
  const cleanQuery = query.trim();

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(cleanQuery), 250);
    return () => clearTimeout(timer);
  }, [cleanQuery]);

  const results = useQuery({
    queryKey: ["admin-global-search", userId, scope, debounced],
    enabled: open && !!debounced && cleanQuery === debounced,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: async () => Promise.all(kinds.map(async ({ kind }) => {
      try {
        let rows: Record<string, unknown>[];
        if (kind === "drivers") {
          rows = (await loadDrivers()).rows;
        } else if (kind === "vehicles") {
          rows = (await loadVehicles({ data: { q: debounced.slice(0, 100), page: 1, pageSize: 100 } })).rows;
        } else {
          const response = await supabase.from("partners").select("id,name,email,phone").order("name");
          if (response.error) throw response.error;
          rows = response.data ?? [];
        }
        return { kind, matches: searchResults(kind, rows, debounced), failed: false };
      } catch {
        return { kind, matches: [] as SearchResult[], failed: true };
      }
    })),
  });
  const pending = cleanQuery !== debounced || results.isPending || results.isFetching;
  const show = open && !!cleanQuery;

  function moveFocus(backward: boolean) {
    const links = Array.from(box.current?.querySelectorAll<HTMLAnchorElement>("[data-search-result]") ?? []);
    if (!links.length) return;
    const index = links.findIndex((link) => link === document.activeElement);
    const next = backward ? index - 1 : index + 1;
    if (next < 0) input.current?.focus();
    else links[next % links.length]?.focus();
  }

  return (
    <div ref={box} className="relative w-[340px] max-w-full min-w-0"
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}
      onKeyDown={(event) => {
        if (event.key === "Escape") { setOpen(false); input.current?.focus(); }
        if (show && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
          event.preventDefault();
          moveFocus(event.key === "ArrowUp");
        }
      }}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-[17px] w-[17px] -translate-y-1/2 text-muted-foreground" strokeWidth={1.75} />
      <input ref={input} type="search" aria-label="Search drivers, vehicles and partners"
        aria-expanded={show} aria-controls={show ? "admin-search-results" : undefined}
        placeholder="Search Drivers, Vehicles, Partners…" value={query}
        onFocus={() => setOpen(true)}
        onChange={(event) => { setQuery(event.target.value); setOpen(true); }}
        className="w-full rounded-full border border-border bg-popover py-2 pl-10 pr-9 text-[13px] text-popover-foreground outline-none placeholder:text-muted-foreground focus:border-brand/40 focus:ring-2 focus:ring-brand/20 [&::-webkit-search-cancel-button]:appearance-none" />
      {!!query && <Button type="button" variant="ghost" size="icon" aria-label="Clear Search"
        className="absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2 rounded-full text-muted-foreground hover:bg-muted hover:text-popover-foreground"
        onClick={() => { setQuery(""); setOpen(false); input.current?.focus(); }}><X /></Button>}
      {show && <div id="admin-search-results" aria-label="Search Results"
        className="absolute left-0 top-full z-50 mt-2 max-h-[min(28rem,65vh)] w-[28rem] max-w-[calc(100vw-4rem)] overflow-y-auto rounded-lg border border-border bg-popover text-popover-foreground shadow-lg">
        {pending ? <div role="status" className="flex items-center gap-2 p-4 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Searching…</div>
          : <>
            {kinds.map(({ kind, label, icon: Icon }) => {
              const group = results.data?.find((item) => item.kind === kind);
              if (!group?.matches.length && !group?.failed) return null;
              return <section key={kind} aria-label={label}>
                <div className="flex items-center gap-2 border-b border-border bg-muted px-3 py-2 text-xs font-semibold"><Icon className="h-3.5 w-3.5" />{label}</div>
                {group.failed ? <div role="status" className="px-3 py-3 text-xs text-destructive">Could Not Search {label}</div>
                  : group.matches.map((result) => <Link key={result.id} to="/admin" search={searchDestination(result)}
                    data-search-result onClick={() => { onSelect(result); setQuery(""); setOpen(false); }}
                    className="block border-b border-border px-3 py-2.5 outline-none last:border-0 hover:bg-muted focus-visible:bg-muted">
                    <div className="text-[13px] font-medium">{result.label}</div>
                    {!!result.detail && <div className="break-words text-xs text-muted-foreground">{result.detail}</div>}
                  </Link>)}
              </section>;
            })}
            {!results.data?.some((group) => group.matches.length || group.failed) && <div role="status" className="p-4 text-sm text-muted-foreground">No Matches Found</div>}
          </>}
      </div>}
    </div>
  );
}