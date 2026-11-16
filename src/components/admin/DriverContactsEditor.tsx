import { useCallback, useEffect, useState } from "react";
import { Mail, Phone, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  type DriverContact,
  type DriverContactKind,
  formatDriverPhone,
  normalizeDriverContact,
} from "@/lib/driver-contacts";
import {
  addDriverContact,
  findDuplicateDrivers,
  listDriverContactsClient,
  removeDriverContact,
  updateDriverContact,
} from "@/lib/driver-contacts.functions";

type Props = {
  applicationId: string;
  primaryPhone: string | null;
  primaryEmail: string | null;
  canEdit: boolean;
  onPrimaryChange?: (patch: { phone?: string; email?: string }) => void | Promise<boolean>;
};

function fallbackContacts(phone: string | null, email: string | null, applicationId: string): DriverContact[] {
  const now = new Date(0).toISOString();
  const rows: DriverContact[] = [];
  if (phone) {
    rows.push({
      id: "primary-phone",
      application_id: applicationId,
      kind: "phone",
      value: phone,
      label: null,
      is_primary: true,
      receives_messages: true,
      consented_at: null,
      created_by: null,
      created_at: now,
      updated_at: now,
    });
  }
  if (email) {
    rows.push({
      id: "primary-email",
      application_id: applicationId,
      kind: "email",
      value: email,
      label: null,
      is_primary: true,
      receives_messages: true,
      consented_at: null,
      created_by: null,
      created_at: now,
      updated_at: now,
    });
  }
  return rows;
}

function displayValue(kind: DriverContactKind, value: string) {
  return kind === "phone" ? formatDriverPhone(value) : value;
}

export function DriverContactsEditor({
  applicationId,
  primaryPhone,
  primaryEmail,
  canEdit,
  onPrimaryChange,
}: Props) {
  const [contacts, setContacts] = useState<DriverContact[]>(() => fallbackContacts(primaryPhone, primaryEmail, applicationId));
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState<DriverContactKind | null>(null);
  const [draftValue, setDraftValue] = useState("");
  const [draftLabel, setDraftLabel] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      const rows = await listDriverContactsClient(applicationId);
      setContacts(rows.length ? rows : fallbackContacts(primaryPhone, primaryEmail, applicationId));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load contacts");
    } finally {
      setLoading(false);
    }
  }, [applicationId, primaryPhone, primaryEmail]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const phones = contacts.filter((c) => c.kind === "phone");
  const emails = contacts.filter((c) => c.kind === "email");

  async function warnDuplicates(kind: DriverContactKind, value: string) {
    const dups = await findDuplicateDrivers(kind, value, applicationId);
    if (dups.length) {
      const names = dups.map((d) => d.full_name || "another driver").join(", ");
      toast.warning(`This ${kind} is also on ${names}'s profile`);
    }
    return dups;
  }

  async function handleAdd(kind: DriverContactKind) {
    const value = normalizeDriverContact(kind, draftValue);
    if (!value) {
      toast.error(kind === "phone" ? "Enter a valid US phone number" : "Enter a valid email address");
      return;
    }
    setBusy(true);
    try {
      await warnDuplicates(kind, value);
      const res = await addDriverContact({
        applicationId,
        kind,
        value,
        label: draftLabel,
      });
      if (res.duplicates.length) {
        const names = res.duplicates.map((d) => d.full_name || "another driver").join(", ");
        toast.warning(`Saved. This ${kind} is also on ${names}'s profile`);
      } else {
        toast.success(kind === "phone" ? "Phone added" : "Email added");
      }
      setDraftValue("");
      setDraftLabel("");
      setAdding(null);
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not add contact");
    } finally {
      setBusy(false);
    }
  }

  async function handleMakePrimary(c: DriverContact) {
    if (c.is_primary) return;
    setBusy(true);
    try {
      const patch = c.kind === "phone" ? { phone: c.value } : { email: c.value };
      const ok = await onPrimaryChange?.(patch);
      if (ok === false) return;
      toast.success("Primary contact updated");
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not change primary");
    } finally {
      setBusy(false);
    }
  }

  async function handleToggleMessages(c: DriverContact, on: boolean) {
    if (c.is_primary) return;
    setBusy(true);
    try {
      await updateDriverContact(c.id, { receives_messages: on });
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update contact");
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveEdit(c: DriverContact) {
    const value = normalizeDriverContact(c.kind, editValue);
    if (!value) {
      toast.error(c.kind === "phone" ? "Enter a valid US phone number" : "Enter a valid email address");
      return;
    }
    setBusy(true);
    try {
      if (c.is_primary) {
        const patch = c.kind === "phone" ? { phone: value } : { email: value };
        const ok = await onPrimaryChange?.(patch);
        if (ok === false) return;
      } else {
        await warnDuplicates(c.kind, value);
        await updateDriverContact(c.id, { value });
      }
      setEditingId(null);
      toast.success("Contact updated");
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update contact");
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove(c: DriverContact) {
    if (c.is_primary) {
      toast.error("Make another contact primary before removing this one");
      return;
    }
    setBusy(true);
    try {
      await removeDriverContact(c.id);
      toast.success("Contact removed");
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not remove contact");
    } finally {
      setBusy(false);
    }
  }

  function renderGroup(kind: DriverContactKind, rows: DriverContact[], title: string, Icon: typeof Phone) {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-[12px] font-medium text-[#111114]">
            <Icon className="w-3.5 h-3.5 text-[#9A9AA3]" />
            {title}
          </div>
          {canEdit && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-[11px]"
              disabled={busy}
              onClick={() => {
                setAdding(adding === kind ? null : kind);
                setDraftValue("");
                setDraftLabel("");
              }}
              aria-label={`Add ${kind}`}
            >
              <Plus className="w-3.5 h-3.5 mr-1" />
              Add
            </Button>
          )}
        </div>
        <ul className="space-y-2">
          {rows.map((c) => (
            <li key={c.id} className="rounded-md border border-border/70 bg-background px-3 py-2">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                {editingId === c.id ? (
                  <form
                    className="flex flex-wrap items-center gap-2 flex-1 min-w-[12rem]"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void handleSaveEdit(c);
                    }}
                  >
                    <input
                      autoFocus
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      className="h-7 flex-1 min-w-[10rem] rounded border border-input bg-background px-2 text-[12px]"
                      aria-label={kind === "phone" ? "Phone number" : "Email address"}
                    />
                    <Button type="submit" size="sm" className="h-7 px-2 text-[11px]" disabled={busy}>
                      Save
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-[11px]"
                      onClick={() => setEditingId(null)}
                    >
                      Cancel
                    </Button>
                  </form>
                ) : (
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span className="text-[12px] text-[#111114] truncate">{displayValue(kind, c.value)}</span>
                    {c.label && <span className="text-[11px] text-muted-foreground truncate">{c.label}</span>}
                    {c.is_primary && (
                      <span className="text-[10px] uppercase tracking-wide text-[#55555E] border border-border rounded px-1.5 py-0.5">
                        Primary
                      </span>
                    )}
                  </div>
                )}
                {canEdit && editingId !== c.id && (
                  <div className="flex flex-wrap items-center gap-2 ml-auto">
                    {!c.is_primary && (
                      <button
                        type="button"
                        className="text-[11px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                        disabled={busy}
                        onClick={() => void handleMakePrimary(c)}
                      >
                        Make primary
                      </button>
                    )}
                    <button
                      type="button"
                      className="text-[11px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                      disabled={busy}
                      onClick={() => {
                        setEditingId(c.id);
                        setEditValue(c.value);
                      }}
                    >
                      Edit
                    </button>
                    {!c.is_primary && (
                      <button
                        type="button"
                        className="text-[11px] text-muted-foreground hover:text-destructive"
                        disabled={busy}
                        aria-label="Remove contact"
                        onClick={() => void handleRemove(c)}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                )}
              </div>
              {kind === "phone" && !c.is_primary && canEdit && (
                <label className="mt-2 flex items-start gap-2 text-[11px] text-muted-foreground">
                  <Switch
                    checked={c.receives_messages}
                    disabled={busy}
                    onCheckedChange={(on) => void handleToggleMessages(c, on)}
                    aria-label="Also send messages here"
                  />
                  <span>
                    Also send messages here
                    <span className="block text-[10px] leading-snug">
                      Texts go out only after this number has opted in (they text START, or they originally consented on it). Emails can go now.
                    </span>
                  </span>
                </label>
              )}
              {kind === "email" && !c.is_primary && canEdit && (
                <label className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
                  <Switch
                    checked={c.receives_messages}
                    disabled={busy}
                    onCheckedChange={(on) => void handleToggleMessages(c, on)}
                    aria-label="Also send messages here"
                  />
                  Also send messages here
                </label>
              )}
            </li>
          ))}
          {!rows.length && <li className="text-[12px] text-muted-foreground">None on file</li>}
        </ul>
        {canEdit && adding === kind && (
          <form
            className="flex flex-wrap items-end gap-2 rounded-md border border-dashed border-border px-3 py-2"
            onSubmit={(e) => {
              e.preventDefault();
              void handleAdd(kind);
            }}
          >
            <label className="flex-1 min-w-[10rem] text-[11px] text-muted-foreground">
              {kind === "phone" ? "Phone" : "Email"}
              <input
                autoFocus
                value={draftValue}
                onChange={(e) => setDraftValue(e.target.value)}
                placeholder={kind === "phone" ? "(555) 010-0000" : "name@example.com"}
                className="mt-1 h-7 w-full rounded border border-input bg-background px-2 text-[12px] text-foreground"
              />
            </label>
            <label className="w-32 text-[11px] text-muted-foreground">
              Label
              <input
                value={draftLabel}
                onChange={(e) => setDraftLabel(e.target.value)}
                placeholder="Optional"
                className="mt-1 h-7 w-full rounded border border-input bg-background px-2 text-[12px] text-foreground"
              />
            </label>
            <Button type="submit" size="sm" className="h-7 px-3 text-[11px]" disabled={busy}>
              Save
            </Button>
            <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-[11px]" onClick={() => setAdding(null)}>
              Cancel
            </Button>
          </form>
        )}
      </div>
    );
  }

  return (
    <div className={`space-y-5 ${loading ? "opacity-70" : ""}`}>
      {renderGroup("phone", phones, "Phone numbers", Phone)}
      {renderGroup("email", emails, "Email addresses", Mail)}
    </div>
  );
}
