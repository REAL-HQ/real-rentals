import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { UserPlus, X, Users, Mail, Clock, Trash2, ShieldCheck, AlertTriangle } from "lucide-react";
import { EmptyState, MicroLabel, StatusPill } from "./ui";
import {
  listTeam,
  inviteTeammate,
  revokeInvite,
  removeTeammate,
  ASSIGNABLE_ROLES,
  type TeamMember,
  type PendingInvite,
} from "@/lib/team.functions";

// Team management.
//
// The previous version of this panel listed eight invented teammates from a
// hardcoded DEMO_ROWS array so the table would "render populated", and its
// Grant button wrote to user_roles straight from the browser — which RLS
// refused, silently, every time. Nothing here is fabricated, and every write
// goes through a server function that checks the caller is an Owner.

const ROLE_TONE: Record<string, string> = {
  admin: "bg-[rgba(208,48,32,0.08)] text-[#D03020]",
  team: "bg-[rgba(37,99,235,0.08)] text-[#2563EB]",
  coordinator: "bg-[rgba(22,163,74,0.08)] text-[#16A34A]",
};

export function TeamPanel() {
  const load = useServerFn(listTeam);
  const invite = useServerFn(inviteTeammate);
  const revoke = useServerFn(revokeInvite);
  const remove = useServerFn(removeTeammate);

  const [members, setMembers] = useState<TeamMember[]>([]);
  const [invites, setInvites] = useState<PendingInvite[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await load({ data: undefined });
      setMembers(res.members);
      setInvites(res.invites);
      setCanManage(res.canManage);
    } catch (e: any) {
      toast.error(e?.message === "Forbidden" ? "You don't have access to the team list." : "Could not load the team.");
    } finally {
      setLoading(false);
    }
  }, [load]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function onRemove(m: TeamMember) {
    const who = m.email ?? m.user_id;
    if (!confirm(`Remove ${m.role_label} access from ${who}?\n\nThey keep their account but lose the back office.`)) return;
    const res = await remove({ data: { roleRowId: m.id } });
    if (!res.ok) return toast.error(res.error);
    toast.success(`Removed ${who}`);
    void refresh();
  }

  async function onRevoke(i: PendingInvite) {
    if (!confirm(`Revoke the invitation for ${i.email}? Their link will stop working.`)) return;
    await revoke({ data: { inviteId: i.id } });
    toast.success("Invitation revoked");
    void refresh();
  }

  const owners = members.filter((m) => m.role === "admin").length;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold">Team</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Who can get into the back office, and what they can reach.
          </p>
        </div>
        {canManage && (
          <button
            onClick={() => setShowForm(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-real-red text-white px-4 py-2 text-sm font-medium"
          >
            <UserPlus className="w-4 h-4" /> Invite Teammate
          </button>
        )}
      </div>

      {/* What each tier means, stated where the decision gets made rather than
          buried in documentation nobody opens. */}
      <div className="grid gap-3 sm:grid-cols-3">
        {ASSIGNABLE_ROLES.map((r) => (
          <div key={r.value} className="rounded-xl border border-border p-4">
            <span className={`inline-block rounded px-2 py-0.5 text-xs font-semibold ${ROLE_TONE[r.value]}`}>
              {r.label}
            </span>
            <p className="text-xs text-muted-foreground mt-2 leading-relaxed">{r.blurb}</p>
          </div>
        ))}
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <>
          <section>
            <MicroLabel>People with access ({members.length})</MicroLabel>
            {members.length === 0 ? (
              <EmptyState
                icon={<Users className="w-6 h-6" strokeWidth={1.75} />}
                title="Nobody has access yet"
                hint="Invite a teammate by email to get them into the back office."
              />
            ) : (
              <div className="mt-2 overflow-x-auto rounded-xl border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-[#FAFAFB] text-left">
                    <tr>
                      <th className="px-4 py-2.5 font-medium">Person</th>
                      <th className="px-4 py-2.5 font-medium">Role</th>
                      <th className="px-4 py-2.5 font-medium">Since</th>
                      <th className="px-4 py-2.5" />
                    </tr>
                  </thead>
                  <tbody>
                    {members.map((m) => (
                      <tr key={m.id} className="border-t border-border">
                        <td className="px-4 py-3">
                          <span className="font-medium">{m.email ?? "Unknown account"}</span>
                          {m.is_you && <span className="ml-2 text-xs text-muted-foreground">(you)</span>}
                          {!m.email && (
                            <span className="block text-xs text-muted-foreground font-mono mt-0.5">{m.user_id}</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-block rounded px-2 py-0.5 text-xs font-semibold ${ROLE_TONE[m.role] ?? ""}`}>
                            {m.role_label}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {new Date(m.created_at).toLocaleDateString()}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {canManage && (
                            <button
                              onClick={() => onRemove(m)}
                              title={
                                m.role === "admin" && owners <= 1
                                  ? "This is the only Owner — promote somebody else first"
                                  : "Remove access"
                              }
                              className="text-muted-foreground hover:text-[#D03020] disabled:opacity-30"
                              disabled={m.role === "admin" && owners <= 1}
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {canManage && invites.length > 0 && (
            <section>
              <MicroLabel>Invitations awaiting acceptance ({invites.length})</MicroLabel>
              <div className="mt-2 space-y-2">
                {invites.map((i) => (
                  <div
                    key={i.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-border px-4 py-3 flex-wrap"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <Mail className="w-4 h-4 text-muted-foreground shrink-0" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{i.email}</p>
                        <p className="text-xs text-muted-foreground">
                          {i.role_label}
                          {i.invited_by_email ? ` · invited by ${i.invited_by_email}` : ""}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {i.is_expired ? (
                        <StatusPill status="expired" tone="red">
                          Expired
                        </StatusPill>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                          <Clock className="w-3.5 h-3.5" />
                          expires {new Date(i.expires_at).toLocaleDateString()}
                        </span>
                      )}
                      <button
                        onClick={() => onRevoke(i)}
                        className="text-xs text-muted-foreground hover:text-[#D03020]"
                      >
                        Revoke
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {!canManage && (
            <p className="inline-flex items-start gap-2 text-xs text-muted-foreground">
              <ShieldCheck className="w-4 h-4 shrink-0 mt-px" />
              Only an Owner can invite or remove teammates.
            </p>
          )}
        </>
      )}

      {showForm && (
        <InviteForm
          onClose={() => setShowForm(false)}
          onSent={() => {
            setShowForm(false);
            void refresh();
          }}
          send={invite}
        />
      )}
    </div>
  );
}

function InviteForm({
  onClose,
  onSent,
  send,
}: {
  onClose: () => void;
  onSent: () => void;
  send: ReturnType<typeof useServerFn<typeof inviteTeammate>>;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<string>("coordinator");
  const [saving, setSaving] = useState(false);

  const chosen = ASSIGNABLE_ROLES.find((r) => r.value === role);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) return toast.error("Enter an email address");
    setSaving(true);
    try {
      const res = await send({ data: { email: trimmed, role: role as any } });
      if (!res.ok) return toast.error(res.error);
      toast.success(`Invitation sent to ${trimmed}`);
      onSent();
    } catch (e: any) {
      toast.error(e?.message === "Forbidden" ? "Only an Owner can invite teammates." : "Could not send the invitation.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <form onSubmit={submit} className="bg-white rounded-xl p-6 max-w-md w-full space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Invite a teammate</h3>
          <button type="button" onClick={onClose} aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">Email address</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@example.com"
            autoFocus
            className="w-full rounded-lg border border-border px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">Role</label>
          <div className="space-y-2">
            {ASSIGNABLE_ROLES.map((r) => (
              <label
                key={r.value}
                className={`flex gap-3 rounded-lg border p-3 cursor-pointer ${
                  role === r.value ? "border-[#D03020] bg-[rgba(208,48,32,0.03)]" : "border-border"
                }`}
              >
                <input
                  type="radio"
                  name="role"
                  value={r.value}
                  checked={role === r.value}
                  onChange={() => setRole(r.value)}
                  className="mt-1"
                />
                <span>
                  <span className="block text-sm font-medium">{r.label}</span>
                  <span className="block text-xs text-muted-foreground mt-0.5 leading-relaxed">{r.blurb}</span>
                </span>
              </label>
            ))}
          </div>
        </div>

        {chosen?.value === "admin" && (
          <p className="flex items-start gap-2 text-xs text-[#B45309] bg-[rgba(245,158,11,0.08)] rounded-lg p-3">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-px" />
            An Owner can invite and remove anybody, including you.
          </p>
        )}

        <p className="text-xs text-muted-foreground">
          They will get an email with a link that works for 7 days, and only from this address.
        </p>

        <button
          disabled={saving}
          className="w-full rounded-lg bg-real-red text-white py-2.5 text-sm font-medium disabled:opacity-60"
        >
          {saving ? "Sending…" : "Send invitation"}
        </button>
      </form>
    </div>
  );
}
