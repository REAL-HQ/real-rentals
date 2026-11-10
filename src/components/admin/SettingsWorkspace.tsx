import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronDown, ChevronRight } from "lucide-react";
import { SettingsPanel, SECTION_KEY } from "@/components/admin/SettingsPanel";
import { AutomationsPanel } from "@/components/admin/AutomationsPanel";
import { AutomationsCatalog } from "@/components/admin/AutomationsCatalog";
import { RentReminderTemplates } from "@/components/admin/RentReminderTemplates";
import { TeamPanel } from "@/components/admin/TeamPanel";
import { VehicleDefaultsPanel } from "@/components/admin/VehicleDefaultsPanel";
import { MaintenanceDefaultsPanel } from "@/components/admin/MaintenanceDefaultsPanel";
import { SafeAutofillPanel } from "@/components/admin/SafeAutofillPanel";
import { PhotoReadingPanel } from "@/components/admin/PhotoReadingPanel";
import { PhotoEnhancePanel } from "@/components/admin/PhotoEnhancePanel";
import { PhotoStudioSettingsCard } from "@/components/admin/PhotoStudioSettingsCard";
import { WebsitesPanel } from "@/components/admin/WebsitesPanel";
import { ActivityPanel } from "@/components/admin/ActivityPanel";
import { AgreementTemplatesPanel } from "@/components/admin/AgreementTemplatesPanel";
import { RentalActivationSettingsPanel } from "@/components/admin/RentalActivationSettingsPanel";
import { ReservationDepositSettingsPanel } from "@/components/admin/ReservationDepositSettingsPanel";
import { PendingSignatures } from "@/components/admin/PendingSignatures";
import { AGREEMENT_PENDING_SIGNATURE_ENABLED } from "@/lib/agreement-pending-signatures-flag";
import { resolveSettingsSection, visibleSettingsSections } from "@/components/admin/nav-config";
import type { StaffTier } from "@/lib/roles";

const DESCRIPTIONS: Record<string, string> = {
  company: "Company name and support contact.",
  website: "Market-specific marketing sites and their waitlist demand.",
  activity: "Who did what, and what is about to expire.",
  vehicle_defaults: "Set standard pricing for each vehicle type. These values pre-fill new vehicles and can always be changed before saving. Existing vehicles never change.",
  maintenance: "Company maintenance intervals by miles, time or both. A vehicle can override an interval from its Service tab.",
  safe_autofill: "Owner-only. Automatically fill blank, non-sensitive vehicle details from trusted documents. Off by default.",
  vehicle_photos: "Owner-only. Listing photo enhancement, studio backgrounds, and reading details off a photograph. Enhancement is free and on-device; reading costs money and has a daily limit. All off by default.",
  rental_terms: "Minimum term, return notice, the terms text and rental activation rules.",
  deposits: "Default deposit, refund window, and optional reservation deposit.",
  applications: "Who qualifies to apply.",
  agreements: "Owner-only. Who countersigns, agreement wording, versions and approval. Changing the signer never alters documents already sent. Drafts never change what drivers receive.",
  payments: "Late fees, grace period and default payment method.",
  partners: "Default revenue share and contract term for vehicle partners.",
  notifications: "Where applicant alerts go, and whether email delivery is working.",
  automations: "Every automated email and text, its templates, and an on/off switch for each.",
  team: "Invite staff, set their tier and remove access.",
};

/**
 * Settings workspace: left settings menu + selected section. The menu is
 * presentation only — every section's server functions / RLS still decide
 * what a caller may read or change.
 */
export function SettingsWorkspace({ tier, section }: { tier: StaffTier | null; section: string | null }) {
  const items = visibleSettingsSections(tier);
  const resolved = resolveSettingsSection(section);
  const current = items.find((s) => s.id === resolved) ?? items[0];
  const groups = Array.from(new Set(items.map((s) => s.group)));
  // Collapsible groups: only the first starts open; the group holding the
  // active section always opens so deep links never land on a hidden item.
  const [closedGroups, setClosedGroups] = useState<Set<string>>(
    () => new Set(groups.slice(1)),
  );
  if (!current) return <p className="text-[13px] text-[#55555E]">No settings are available for your role.</p>;
  const wide = ["automations", "team", "website", "activity", "agreements", "vehicle_photos"].includes(current.id);
  const toggleGroup = (g: string) =>
    setClosedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(g)) next.delete(g);
      else next.add(g);
      return next;
    });

  return (
    <div className="flex flex-col md:flex-row gap-4 md:gap-8">
      <nav aria-label="Settings sections" className="md:w-[220px] shrink-0">
        {/* Mobile: compact select-like horizontal list */}
        <div className="md:hidden -mx-4 px-4 overflow-x-auto">
          <div className="flex gap-1.5 w-max pb-1">
            {items.map((s) => (
              <Link key={s.id} to="/admin" search={{ tab: "settings", section: s.id }}
                className={`h-10 px-3.5 inline-flex items-center rounded-full text-[13px] font-medium whitespace-nowrap border ${s.id === current.id ? "bg-[#111114] text-white border-[#111114]" : "bg-white text-[#55555E] border-[#EDEDF0]"}`}>
                {s.label}
              </Link>
            ))}
          </div>
        </div>
        <div className="hidden md:block sticky top-20 space-y-4">
          {groups.map((g) => {
            const containsActive = items.some((s) => s.group === g && s.id === current.id);
            const open = containsActive || !closedGroups.has(g);
            return (
            <div key={g}>
              <button type="button" onClick={() => toggleGroup(g)} aria-expanded={open}
                className="w-full flex items-center justify-between px-3 mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#9A9AA3] hover:text-[#55555E]">
                {g}
                {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
              </button>
              {open && <div className="space-y-0.5">
                {items.filter((s) => s.group === g).map((s) => {
                  const active = s.id === current.id;
                  return (
                    <Link key={s.id} to="/admin" search={{ tab: "settings", section: s.id }} aria-current={active ? "page" : undefined}
                      className={`relative block px-3 py-1.5 rounded-lg text-[13px] font-medium ${active ? "bg-white text-[#111114] shadow-[0_0_0_1px_#EDEDF0]" : "text-[#55555E] hover:bg-[#F4F4F6] hover:text-[#111114]"}`}>
                      {active && <span className="absolute left-0 top-1/2 -translate-y-1/2 h-4 w-[3px] rounded-r bg-[#D03020]" />}
                      {s.label}
                    </Link>
                  );
                })}
              </div>}
            </div>
            );
          })}
        </div>
      </nav>
      <section className={`flex-1 min-w-0 ${wide ? "" : "max-w-3xl"}`}>
        <div className="mb-4">
          <h2 className="text-[17px] font-semibold text-[#111114]">{current.label}</h2>
          <p className="text-[13px] text-[#55555E] mt-0.5">{DESCRIPTIONS[current.id]}</p>
        </div>
        {current.id === "automations" ? (
          <div className="space-y-8"><AutomationsCatalog /><RentReminderTemplates /><AutomationsPanel /></div>
        ) : current.id === "vehicle_defaults" ? (
          <VehicleDefaultsPanel />
        ) : current.id === "safe_autofill" ? (
          <SafeAutofillPanel />
        ) : current.id === "vehicle_photos" ? (
          <div className="space-y-5"><PhotoEnhancePanel /><PhotoStudioSettingsCard /><PhotoReadingPanel /></div>
        ) : current.id === "maintenance" ? (
          <MaintenanceDefaultsPanel />
        ) : current.id === "website" ? (
          <WebsitesPanel />
        ) : current.id === "activity" ? (
          <ActivityPanel />
        ) : current.id === "agreements" ? (
          <div className="space-y-8">
            <div className="rounded-xl border border-[#EDEDF0] bg-white p-5">
              <SettingsPanel only={SECTION_KEY.esign} />
              {AGREEMENT_PENDING_SIGNATURE_ENABLED === true ? <PendingSignatures /> : null}
            </div>
            <AgreementTemplatesPanel />
          </div>
        ) : current.id === "team" ? (
          <TeamPanel />
        ) : (
          <div className="rounded-xl border border-[#EDEDF0] bg-white p-5">
            <SettingsPanel only={SECTION_KEY[current.id]} />
            {current.id === "rental_terms" ? <RentalActivationSettingsPanel /> : null}
            {current.id === "deposits" ? <ReservationDepositSettingsPanel /> : null}
          </div>
        )}
      </section>
    </div>
  );
}
