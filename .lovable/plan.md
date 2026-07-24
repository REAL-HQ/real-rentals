# Back-Office Redesign — Overview + Driver Profile

Scope: visual/UX redesign only. No changes to data queries, routes, auth, ApplicationWizard, or the public site.

## 1. Design tokens (reuse existing)
- Canvas `#FAFAFB`, surface `#FFFFFF`, border `#EDEDF0`, text `#111114 / #55555E / #9A9AA3`
- Accent `#CC0000` — only primary actions, urgent counts, current lifecycle stage, selected nav
- 8px spacing scale, 12–16px radius, `shadow-sm` max, Lucide icons only
- Extend `src/components/admin/ui.tsx` with: `SectionCard`, `MetricCard`, `LifecycleRail`, `QueueRow`, `ReadinessSummary`, `Drawer` (right-side, 760px), `Timeline` (already exists — polish)

## 2. Overview Dashboard (`src/components/admin/OverviewPanel.tsx`)
Rebuild layout top→bottom:

**Row A — 4 operational metric cards** (equal width)
1. Available Vehicles — count + "Ready to rent"
2. Active Rentals — count + utilization %
3. Drivers Awaiting Action — count + "X docs · Y interviews · Z approvals"
4. Weekly Rental Revenue — $ + WoW delta

Icon + label + big value + one supporting line. No full-red backgrounds unless urgent.

**Row B — two columns**
- Left (2/3): **Revenue & Collections** consolidated card — Revenue / Collected / Outstanding / Expenses / Net + inline sparkline + period selector
- Right (1/3): **Fleet Activity** — keep existing donut/logic, wrap in redesigned card with Available/Active/Maintenance/Reserved, utilization %, current vs potential weekly earnings

**Row C — Action Queue** (single card, list rows)
Each row: icon · count · label · muted description · right-aligned "View" link. Items: missing docs, incomplete interviews, ready for approval, insurance verify, payments due, late payments, maintenance due.

**Row D — Recent Applications** (5–7 rows)
Columns: Driver · Stage · Readiness · Needed By · Blocker · Last Activity · Assignee · row-click. Remove phone/email. Footer link "View all drivers".

Keep all existing queries; just reshape the presentation and derive the new fields from data already loaded (fall back to `—` when unavailable).

## 3. Driver Profile (`src/components/admin/DriversPanel.tsx` → DriverDetail)

**Header** (compact, single row)
- Left: avatar/initials · name · status pill · city · phone · email · source · applied date · last contact
- Right: ONE contextual primary button (Continue Application / Continue Interview / Review Documents / Approve / Assign Vehicle) + icon buttons Call · Text · Email · More (dropdown)

**Lifecycle Rail** (below header, full width)
Stages: Applied → Contacted → Screening → Documents → Insurance → Approved → Pickup → Active. Completed = green check, current = red filled with % + time-in-stage + blocker caption, future = gray. Horizontal rail with connecting lines and stage labels.

**Two-column body**

Left sticky sidebar (~320px):
- Driver Summary (avatar, contacts, city, source, tags)
- Rental Need (needed-by, weekly rate, FT/PT, current vehicle, card-on-file)
- Readiness (level, app %, docs %, insurance, screening)
- Quick Actions (Continue Interview / Request Docs / Run Screening / Add Note / Assign Vehicle)

Right main workspace:
- **Driver Readiness Summary** card at top: status line, Blockers list, Positive indicators list, Recommended next action + primary CTA
- **Tabs**: Overview · Application · Documents · Screening · Rental · Payments · Activity · Notes (remove permanent Interview tab)

Tab contents:
- **Overview**: Readiness Summary (compact) → Driver Facts grid → Requirements Checklist → Recent Activity timeline
- **Documents**: compact list rows (license, insurance, proof of address, gig screenshots, payment auth, signed agreement, MVR auth) with status pill, upload/expiration, actions View/Replace/Request
- **Screening / Application / Rental / Payments / Activity / Notes**: keep existing panels wrapped in new `SectionCard`

## 4. Interview Drawer
- New `InterviewDrawer` component (right-side sheet, 760px desktop, full-screen mobile) using shadcn `Sheet`
- Triggered by "Continue Interview" button anywhere in profile
- Steps: Gig Activity → Vehicle Need → License → Insurance → Driving History → Payment Readiness → Notes & Decision
- One step visible at a time; progress bar top; sticky footer: Save & Close · Previous · Next · Complete
- Suggested call script hidden behind "View Suggested Script" collapsible per step
- Autosave indicator, validation inline
- Reuses existing `DriverScreening` field data — moves it out of main profile

## 5. Readiness (formerly AI Prospect Score)
- Rename UI label to "Driver Readiness"
- Component shows: label · score (small) · confidence · helping factors · hurting factors · missing info · recommended next step
- Distinguish "missing info" vs "risk" visually (gray vs amber)

## 6. Gig platform logos
- Add `src/components/admin/PlatformLogo.tsx` entries for Uber/Lyft/DoorDash/Instacart/Amazon Flex/Walmart Spark/Shipt/Roadie (component already exists — extend). Use official SVG marks only.

## 7. What is NOT changing
- ApplicationWizard
- Data schemas, queries, RPCs, routes, auth
- Public marketing site
- Fleet donut chart logic
- Admin sidebar structure (already redesigned)

## Files touched
- `src/components/admin/ui.tsx` (add primitives)
- `src/components/admin/OverviewPanel.tsx` (rebuild)
- `src/components/admin/DriversPanel.tsx` (DriverDetail rebuild; list untouched)
- `src/components/admin/DriverScreening.tsx` (extract interview into drawer form)
- New: `src/components/admin/InterviewDrawer.tsx`
- New: `src/components/admin/ReadinessSummary.tsx`
- New: `src/components/admin/LifecycleRail.tsx`
- `src/components/admin/PlatformLogo.tsx` (extend)

## Delivery order
1. Add tokens/primitives in `ui.tsx`
2. Rebuild Overview
3. Build LifecycleRail + ReadinessSummary + InterviewDrawer
4. Rebuild DriverDetail layout, wire drawer, consolidate tabs
5. Polish: hover/focus, empty states, toasts, keyboard nav
