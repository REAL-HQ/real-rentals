import { useState, type KeyboardEvent, type MouseEvent } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { MoreVertical, ExternalLink, Copy, Mail, CalendarClock, ThumbsDown, Ban, Trash2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { setContactStatus } from "@/lib/contact-status.functions";
import { restoreDriver } from "@/lib/driver-deletion.functions";
import type { ContactStatusDraft } from "@/lib/contact-status";
import { displayPersonName } from "@/lib/display-normalize";
import { formatPhoneForDisplay } from "@/lib/us-phone";
import type { StaffTier } from "@/lib/roles";
import {
  LEAD_FOLLOW_UP_PRESETS,
  LEAD_MENU_LABELS,
  followUpDraft,
  leadDisplayName,
  leadDraftProblems,
  leadMenuGroups,
  notAFitDraft,
  notInterestedDraft,
  undoDraft,
  type LeadMenuAction,
  type LeadMenuLead,
} from "@/lib/lead-card-menu";
import { DeleteDriverDialog } from "./DeleteDriverDialog";

const ICONS: Record<LeadMenuAction, typeof Copy> = {
  open: ExternalLink,
  copy_phone: Copy,
  copy_email: Mail,
  follow_up: CalendarClock,
  not_interested: ThumbsDown,
  not_a_fit: Ban,
  delete: Trash2,
};

/** Clicks and keys inside the menu never reach the card underneath. */
const stop = (e: MouseEvent | KeyboardEvent) => e.stopPropagation();

/**
 * The ⋮ menu in a lead card's top-right corner. Options and the exact Contact
 * Status writes come from lib/lead-card-menu.ts; every save goes through the
 * existing server functions, which re-check the caller.
 */
export function LeadCardMenu({
  lead,
  today,
  tier,
  onChanged,
}: {
  lead: LeadMenuLead;
  today: string;
  tier: StaffTier | null;
  onChanged: () => void;
}) {
  const save = useServerFn(setContactStatus);
  const restore = useServerFn(restoreDriver);
  const navigate = useNavigate();
  const [fitOpen, setFitOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const groups = leadMenuGroups(lead, tier);
  if (!groups.length) return null;
  const name = lead.full_name ? displayPersonName(lead.full_name) : leadDisplayName(null);

  async function write(draft: ContactStatusDraft, done: string, undoable = true) {
    const problems = leadDraftProblems(draft);
    if (problems.length) return void toast.error(problems.join(" "));
    if (busy) return;
    setBusy(true);
    const before = undoDraft(lead);
    try {
      await save({ data: { applicationId: lead.id, ...draft } });
      toast.success(done, {
        action: undoable
          ? {
              label: "Undo",
              onClick: () => {
                save({ data: { applicationId: lead.id, ...before } })
                  .then(() => {
                    toast.success("Change Undone");
                    onChanged();
                  })
                  .catch((e: unknown) => toast.error(e instanceof Error ? e.message : "Could not undo."));
              },
            }
          : undefined,
      });
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function copy(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${what} Copied`);
    } catch {
      toast.error(`Could not copy the ${what.toLowerCase()}.`);
    }
  }

  function run(action: LeadMenuAction) {
    switch (action) {
      case "open":
        return void navigate({ to: "/admin", search: { tab: "drivers", id: lead.id } });
      case "copy_phone":
        return void copy(formatPhoneForDisplay(lead.phone) || String(lead.phone ?? ""), "Phone");
      case "copy_email":
        return void copy(String(lead.email ?? "").trim(), "Email");
      case "not_interested":
        return void write(notInterestedDraft(lead), `${name} Marked Not Interested`);
      case "not_a_fit":
        setReason("");
        return setFitOpen(true);
      case "delete":
        return setDeleting(true);
      case "follow_up":
        return;
    }
  }

  return (
    <div className="-mr-1.5 -mt-1.5 shrink-0" onClick={stop} onKeyDown={stop} onPointerDown={stop} data-lead-menu>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger
          aria-label={`Lead Actions For ${name}`}
          title="Lead Actions"
          disabled={busy}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-secondary hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
        >
          <MoreVertical aria-hidden="true" className="h-4 w-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52" onClick={stop}>
          {groups.map((group, gi) => (
            <div key={group.join(",")} role="none">
              {gi > 0 && <DropdownMenuSeparator />}
              {group.map((action) => {
                const Icon = ICONS[action];
                if (action === "follow_up")
                  return (
                    <DropdownMenuSub key={action}>
                      <DropdownMenuSubTrigger>
                        <Icon aria-hidden="true" /> {LEAD_MENU_LABELS[action]}
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent className="w-40">
                        {LEAD_FOLLOW_UP_PRESETS.map((p) => (
                          <DropdownMenuItem
                            key={p.days}
                            onSelect={() =>
                              void write(followUpDraft(lead, today, p.days), `Follow-Up Set For ${name}`)
                            }
                          >
                            {p.label}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                  );
                return (
                  <DropdownMenuItem
                    key={action}
                    data-lead-menu-item={action}
                    className={action === "delete" ? "text-real-red focus:text-real-red" : undefined}
                    onSelect={() => run(action)}
                  >
                    <Icon aria-hidden="true" /> {LEAD_MENU_LABELS[action]}
                  </DropdownMenuItem>
                );
              })}
            </div>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {fitOpen && (
        <Dialog open onOpenChange={(o) => !o && setFitOpen(false)}>
          <DialogContent className="max-w-md" onClick={stop}>
            <DialogHeader>
              <DialogTitle>Mark {name} Not A Fit</DialogTitle>
              <DialogDescription>
                Sets Contact Status to Unqualified and removes them from Lead Priorities. This changes no application
                status and sends nothing.
              </DialogDescription>
            </DialogHeader>
            <label className="block text-sm">
              <span className="text-muted-foreground">Reason</span>
              <Textarea
                autoFocus
                value={reason}
                maxLength={1000}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Why they are not a fit right now"
              />
            </label>
            <DialogFooter>
              <Button variant="outline" onClick={() => setFitOpen(false)}>
                Cancel
              </Button>
              <Button
                disabled={!reason.trim() || busy}
                onClick={() => {
                  setFitOpen(false);
                  void write(notAFitDraft(reason), `${name} Marked Not A Fit`);
                }}
              >
                Mark Not A Fit
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {deleting && (
        <DeleteDriverDialog
          applicationId={lead.id}
          mode="soft"
          subject="Lead"
          onClose={() => setDeleting(false)}
          onDone={() => {
            setDeleting(false);
            toast.success(`${name} Deleted`, {
              description: "Hidden from lists. Restore anytime from Drivers → Recently Deleted.",
              action: {
                label: "Undo",
                onClick: () => {
                  restore({ data: { applicationId: lead.id } })
                    .then((r) => {
                      if (!r.ok) return void toast.error(r.error);
                      toast.success(`${name} Restored`);
                      onChanged();
                    })
                    .catch(() => toast.error("Could not restore. Use Drivers → Recently Deleted."));
                },
              },
            });
            onChanged();
          }}
        />
      )}
    </div>
  );
}
