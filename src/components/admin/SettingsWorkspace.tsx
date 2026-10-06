import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronDown, ChevronRight } from "lucide-react";
import { SettingsPanel, SECTION_KEY } from "@/components/admin/SettingsPanel";
import { AutomationsPanel } from "@/components/admin/AutomationsPanel";
import { TeamPanel } from "@/components/admin/TeamPanel";
import { VehicleDefaultsPanel } from "@/components/admin/VehicleDefaultsPanel";
import { MaintenanceDefaultsPanel } from "@/components/admin/MaintenanceDefaultsPanel";
import { visibleSettingsSections } from "@/components/admin/nav-config";
import type { StaffTier } from "@/lib/roles";

const DESCRIPTIONS: Record<string, string> = {
  company: "Company name and support contact.",
  vehicle_defaults: "Set standard pricing for each vehicle type. These values pre-fill new vehicles and can always be changed before saving. Existing vehicles never change.",
  maintenance: "Company maintenance intervals by miles, time or both. A vehicle can override an interval from its Service tab.",
  rental_terms: "Minimum term, return notice and the terms text.",
  deposits: "Default deposit and refund window.",
  applications: "Who qualifies to apply.",
  esign: "Who countersigns agreements. Captured when a document is sent — changing it never alters documents already sent or signed.",
  payments: "Late fees, grace period and default payment method.",
  partners: "Default revenue share and contract term for vehicle partners.",
  notifications: "Where applicant alerts go, and whether email delivery is working.",
  automations: "Automatic SMS and email follow-up sequences.",
  team: "Invite staff, set their tier and remove access.",
};

/**
 * Settings workspace: left settings menu + selected section. The menu is
 * presentation only — every section's server functions / RLS still decide
 * what a caller may read or change.
 */
export function SettingsWorkspace({ tier, section }: { tier: StaffTier | null; section: string | null }) {
  const items = visibleSettingsSections(tier);
  const current = items.find((s) => s.id === section) ?? items[0];
  const groups = Array.from(new Set(items.map((s) => s.group)));
  if (!current) return <p className="text-[13px] text-[#55555E]">No settings are available for your role.</p>;
  const wide = current.id === "automations" || current.id === "team";

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
          {groups.map((g) => (
            <div key={g}>
              <div className="px-3 mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#9A9AA3]">{g}</div>
              <div className="space-y-0.5">
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
              </div>
            </div>
          ))}
        </div>
      </nav>
      <section className={`flex-1 min-w-0 ${wide ? "" : "max-w-3xl"}`}>
        <div className="mb-4">
          <h2 className="text-[17px] font-semibold text-[#111114]">{current.label}</h2>
          <p className="text-[13px] text-[#55555E] mt-0.5">{DESCRIPTIONS[current.id]}</p>
        </div>
        {current.id === "automations" ? (
          <AutomationsPanel />
        ) : current.id === "vehicle_defaults" ? (
          <VehicleDefaultsPanel />
        ) : current.id === "maintenance" ? (
          <MaintenanceDefaultsPanel />
        ) : current.id === "team" ? (
          <TeamPanel />
        ) : (
          <div className="rounded-xl border border-[#EDEDF0] bg-white p-5">
            <SettingsPanel only={SECTION_KEY[current.id]} />
          </div>
        )}
      </section>
    </div>
  );
}
