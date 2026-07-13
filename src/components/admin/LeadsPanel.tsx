import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { MoreVertical } from "lucide-react";

type Lead = {
  id: string;
  name: string;
  email: string;
  phone?: string | null;
  message?: string | null;
  created_at?: string | null;
  capital_range?: string | null;
  vehicles_interested?: number | null;
};

export function LeadsPanel({ table, label }: { table: "contact_leads" | "investor_leads"; label: string }) {
  const [rows, setRows] = useState<Lead[]>([]);

  useEffect(() => {
    supabase.from(table).select("*").order("created_at", { ascending: false })
      .then(({ data }) => setRows((data as Lead[]) || []));
  }, [table]);

  async function remove(id: string) {
    if (!confirm(`Delete this ${label.toLowerCase()}?`)) return;
    const { error } = await supabase.from(table).delete().eq("id", id);
    if (error) return toast.error(error.message);
    setRows((r) => r.filter((x) => x.id !== id));
    toast.success("Deleted");
  }

  return (
    <div className="rounded-lg border border-border overflow-hidden bg-white">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-soft text-[11px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="text-left font-medium px-4 py-2.5 border-b border-border">Name</th>
              <th className="text-left font-medium px-4 py-2.5 border-b border-border">Email</th>
              <th className="text-left font-medium px-4 py-2.5 border-b border-border">Phone</th>
              <th className="text-left font-medium px-4 py-2.5 border-b border-border">Details</th>
              <th className="text-left font-medium px-4 py-2.5 border-b border-border">Message</th>
              <th className="text-left font-medium px-4 py-2.5 border-b border-border">Created</th>
              <th className="px-2 py-2.5 border-b border-border w-10"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} className="border-b border-border last:border-0 hover:bg-soft/60 transition-colors align-top">
                <td className="px-4 py-2.5 font-medium whitespace-nowrap">{c.name}</td>
                <td className="px-4 py-2.5 whitespace-nowrap"><a href={`mailto:${c.email}`} className="hover:underline">{c.email}</a></td>
                <td className="px-4 py-2.5 whitespace-nowrap text-muted-foreground">{c.phone ? <a href={`tel:${c.phone}`} className="hover:underline">{c.phone}</a> : "—"}</td>
                <td className="px-4 py-2.5 whitespace-nowrap text-muted-foreground text-xs">
                  {c.capital_range && <div>{c.capital_range}</div>}
                  {c.vehicles_interested != null && <div>{c.vehicles_interested} vehicles</div>}
                  {!c.capital_range && c.vehicles_interested == null && "—"}
                </td>
                <td className="px-4 py-2.5 text-xs max-w-xs">
                  <div className="line-clamp-2 whitespace-pre-wrap">{c.message || "—"}</div>
                </td>
                <td className="px-4 py-2.5 text-[11px] text-muted-foreground whitespace-nowrap">{c.created_at && new Date(c.created_at).toLocaleDateString()}</td>
                <td className="px-2 py-2.5 text-right">
                  <DropdownMenu>
                    <DropdownMenuTrigger className="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-soft text-muted-foreground">
                      <MoreVertical className="w-4 h-4" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem className="text-real-red focus:text-real-red" onClick={() => remove(c.id)}>Delete</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-sm text-muted-foreground">No {label.toLowerCase()} yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}