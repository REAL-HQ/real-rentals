import { useCallback, useEffect, useState } from "react";
import { MapPin, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  type AddressParts,
  type DriverAddress,
  formatAddress,
  normalizeAddress,
} from "@/lib/driver-addresses";
import {
  addDriverAddress,
  fallbackAddress,
  listDriverAddressesClient,
  removeDriverAddress,
  updateDriverAddress,
} from "@/lib/driver-addresses.functions";

type Props = {
  applicationId: string;
  primary: AddressParts | null;
  canEdit: boolean;
  onPrimaryChange?: (parts: AddressParts) => void | Promise<boolean>;
};

function emptyDraft(): AddressParts & { label: string } {
  return { line1: "", line2: "", city: "", state: "", zip: "", label: "" };
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  className,
  autoFocus,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
}) {
  return (
    <label className={`text-[11px] text-muted-foreground ${className ?? ""}`}>
      {label}
      <input
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1 h-7 w-full rounded border border-input bg-background px-2 text-[12px] text-foreground"
      />
    </label>
  );
}

export function DriverAddressesEditor({ applicationId, primary, canEdit, onPrimaryChange }: Props) {
  const [rows, setRows] = useState<DriverAddress[]>(() => {
    const fb = fallbackAddress(applicationId, primary);
    return fb ? [fb] : [];
  });
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState(emptyDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [edit, setEdit] = useState(emptyDraft);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      const list = await listDriverAddressesClient(applicationId);
      const fb = fallbackAddress(applicationId, primary);
      setRows(list.length ? list : fb ? [fb] : []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load addresses");
    } finally {
      setLoading(false);
    }
  }, [applicationId, primary]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function handleAdd() {
    const parts = normalizeAddress(draft);
    if (!parts) {
      toast.error("Enter an address");
      return;
    }
    setBusy(true);
    try {
      await addDriverAddress({ applicationId, parts, label: draft.label });
      toast.success("Address added");
      setDraft(emptyDraft());
      setAdding(false);
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not add address");
    } finally {
      setBusy(false);
    }
  }

  async function handleMakePrimary(row: DriverAddress) {
    if (row.is_primary) return;
    setBusy(true);
    try {
      const parts = normalizeAddress(row);
      if (!parts) {
        toast.error("Enter an address");
        return;
      }
      const ok = await onPrimaryChange?.(parts);
      if (ok === false) return;
      toast.success("Primary address updated");
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not change primary");
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveEdit(row: DriverAddress) {
    const parts = normalizeAddress(edit);
    if (!parts) {
      toast.error("Enter an address");
      return;
    }
    setBusy(true);
    try {
      if (row.is_primary) {
        const ok = await onPrimaryChange?.(parts);
        if (ok === false) return;
      } else {
        await updateDriverAddress(row.id, { ...parts, label: edit.label });
      }
      setEditingId(null);
      toast.success("Address updated");
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update address");
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove(row: DriverAddress) {
    if (row.is_primary) {
      toast.error("Make another address primary before removing this one");
      return;
    }
    setBusy(true);
    try {
      await removeDriverAddress(row.id);
      toast.success("Address removed");
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not remove address");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`space-y-2 ${loading ? "opacity-70" : ""}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[12px] font-medium text-[#111114]">
          <MapPin className="w-3.5 h-3.5 text-[#9A9AA3]" />
          Addresses
        </div>
        {canEdit && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-[11px]"
            disabled={busy}
            onClick={() => {
              setAdding((open) => !open);
              setDraft(emptyDraft());
            }}
            aria-label="Add address"
          >
            <Plus className="w-3.5 h-3.5 mr-1" />
            Add address
          </Button>
        )}
      </div>
      <ul className="space-y-2">
        {rows.map((row) => (
          <li key={row.id} className="rounded-md border border-border/70 bg-background px-3 py-2">
            {editingId === row.id ? (
              <form
                className="grid grid-cols-1 sm:grid-cols-2 gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void handleSaveEdit(row);
                }}
              >
                <Field label="Street" value={edit.line1 ?? ""} onChange={(v) => setEdit((d) => ({ ...d, line1: v }))} className="sm:col-span-2" autoFocus />
                <Field label="City" value={edit.city ?? ""} onChange={(v) => setEdit((d) => ({ ...d, city: v }))} />
                <div className="grid grid-cols-2 gap-2">
                  <Field label="State" value={edit.state ?? ""} onChange={(v) => setEdit((d) => ({ ...d, state: v }))} placeholder="FL" />
                  <Field label="ZIP" value={edit.zip ?? ""} onChange={(v) => setEdit((d) => ({ ...d, zip: v }))} />
                </div>
                <Field label="Label" value={edit.label} onChange={(v) => setEdit((d) => ({ ...d, label: v }))} placeholder="Optional" />
                <div className="flex items-end gap-2">
                  <Button type="submit" size="sm" className="h-7 px-2 text-[11px]" disabled={busy}>
                    Save
                  </Button>
                  <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-[11px]" onClick={() => setEditingId(null)}>
                    Cancel
                  </Button>
                </div>
              </form>
            ) : (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <span className="text-[12px] text-[#111114]">{formatAddress(row)}</span>
                  {row.label && <span className="text-[11px] text-muted-foreground truncate">{row.label}</span>}
                  {row.is_primary && (
                    <span className="text-[10px] uppercase tracking-wide text-[#55555E] border border-border rounded px-1.5 py-0.5">
                      Primary
                    </span>
                  )}
                </div>
                {canEdit && (
                  <div className="flex flex-wrap items-center gap-2 ml-auto">
                    {!row.is_primary && (
                      <button
                        type="button"
                        className="text-[11px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                        disabled={busy}
                        onClick={() => void handleMakePrimary(row)}
                      >
                        Make primary
                      </button>
                    )}
                    <button
                      type="button"
                      className="text-[11px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                      disabled={busy}
                      onClick={() => {
                        setEditingId(row.id);
                        setEdit({
                          line1: row.line1 ?? "",
                          line2: row.line2 ?? "",
                          city: row.city ?? "",
                          state: row.state ?? "",
                          zip: row.zip ?? "",
                          label: row.label ?? "",
                        });
                      }}
                    >
                      Edit
                    </button>
                    {!row.is_primary && (
                      <button
                        type="button"
                        className="text-[11px] text-muted-foreground hover:text-destructive"
                        disabled={busy}
                        aria-label="Remove address"
                        onClick={() => void handleRemove(row)}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </li>
        ))}
        {!rows.length && <li className="text-[12px] text-muted-foreground">None on file</li>}
      </ul>
      {canEdit && adding && (
        <form
          className="grid grid-cols-1 sm:grid-cols-2 gap-2 rounded-md border border-dashed border-border px-3 py-2"
          onSubmit={(e) => {
            e.preventDefault();
            void handleAdd();
          }}
        >
          <Field label="Street" value={draft.line1 ?? ""} onChange={(v) => setDraft((d) => ({ ...d, line1: v }))} className="sm:col-span-2" autoFocus placeholder="Street address" />
          <Field label="City" value={draft.city ?? ""} onChange={(v) => setDraft((d) => ({ ...d, city: v }))} />
          <div className="grid grid-cols-2 gap-2">
            <Field label="State" value={draft.state ?? ""} onChange={(v) => setDraft((d) => ({ ...d, state: v }))} placeholder="FL" />
            <Field label="ZIP" value={draft.zip ?? ""} onChange={(v) => setDraft((d) => ({ ...d, zip: v }))} />
          </div>
          <Field label="Label" value={draft.label} onChange={(v) => setDraft((d) => ({ ...d, label: v }))} placeholder="Optional" />
          <div className="flex items-end gap-2">
            <Button type="submit" size="sm" className="h-7 px-3 text-[11px]" disabled={busy}>
              Save
            </Button>
            <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-[11px]" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
