/**
 * Does each guard actually have a test that fails without it?
 *
 * A green suite proves nothing on its own. This repository has produced
 * several assertions that passed because a filename matched a dropdown
 * option, because a regex found the test's own comment, or because a refusal
 * had simply found nothing to refuse. The only cure is to break the code on
 * purpose and insist the suite notices.
 *
 * For each entry below: edit one line out of the real source, run the suite
 * that claims to cover it, restore the file, and require that the run went
 * red. Any guard whose suite stays green is reported as a BLOCKER — the guard
 * may well work, but nothing is watching it.
 *
 * It edits tracked files in place and always restores them, so run it on a
 * clean tree and check `git status` afterwards if a run is interrupted.
 *
 * Run: node scripts/mutation-check.mjs   (npm run test:mutation)
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, copyFileSync, renameSync, existsSync } from "node:fs";

const RULES = "src/lib/fleet-inbox.ts";
const CORE = "src/lib/fleet-inbox-core.server.ts";
const INBOX = "src/lib/fleet-inbox.functions.ts";
const DOORWAY = "src/lib/vehicle-photo-analysis.functions.ts";
const PHOTOS = "src/components/admin/VehiclePhotos.tsx";
const PANEL = "src/components/admin/VehicleSuggestions.tsx";
const CAP = "src/lib/photo-reading.server.ts";
const RULES2 = "src/lib/photo-reading.ts";
const READY = "src/lib/vehicle-readiness.ts";
const INSPFN = "src/lib/inspections.functions.ts";
const INSPUI = "src/components/admin/InspectionsPanel.tsx";
const PROFILE = "src/components/admin/VehicleProfile.tsx";
const ADMIN = "src/routes/admin.tsx";
const AGFN = "src/lib/agreements.functions.ts";
const AGDATES = "src/lib/agreement-dates.ts";
const VEH = "src/lib/vehicles.functions.ts";
const EDITOR = "src/components/admin/AddVehicleDialog.tsx";
const LIST = "src/lib/vehicles-list.functions.ts";
const LISTRULES = "src/lib/vehicles-list.ts";
const PANELUI = "src/components/admin/VehiclesPanel.tsx";
const INBOXUI = "src/components/admin/FleetInboxPanel.tsx";
const BOOKFN = "src/lib/bookings.functions.ts";
const BOOKRULES = "src/lib/bookings-list.ts";
const BOOKPANEL = "src/components/admin/BookingsPanel.tsx";
const BOOKDRAWER = "src/components/admin/BookingDetails.tsx";
const PORTALFN = "src/lib/portal.functions.ts";
const BOOKACT = "src/components/admin/BookingActions.tsx";
const RENTALFN2 = "src/lib/rentals.functions.ts";
const CSFN = "src/lib/contact-status.functions.ts";
const CSRULES = "src/lib/contact-status.ts";
const DOCFN = "src/lib/documents.functions.ts";
const APPFN = "src/lib/applications.functions.ts";
const DLFN = "src/lib/drivers-list.functions.ts";
const DLRULES = "src/lib/drivers-list.ts";
const INSPFN2 = "src/lib/inspections.functions.ts";

const SERVER = "scripts/vehicle-photo-analysis.test.mjs";
const CHANNEL = "scripts/safe-autofill-channel.test.mjs";
const UI = "scripts/vehicle-photo-analysis-ui.test.mjs";
const CAPTEST = "scripts/photo-reading-cap.test.mjs";
const E2E = "scripts/vehicle-photo-read-e2e.test.mjs";
const PLATE_E2E = "scripts/vehicle-plate-editing-e2e.test.mjs";
const PHASE2_E2E = "scripts/vehicle-onboarding-phase2-e2e.test.mjs";
const READYTEST = "scripts/vehicle-readiness-phase1.test.mjs";
const MINTERM = "scripts/contract-min-term.test.mjs";
const PLATETEST = "scripts/vehicle-plate-editing.test.mjs";
const PHASE2 = "scripts/vehicle-onboarding-phase2.test.mjs";
const BOOKLIST = "scripts/bookings-list.test.mjs";
const BOOKDETAIL = "scripts/bookings-details.test.mjs";
const BOOKE2E = "scripts/bookings-e2e.test.mjs";
const BOOKACTTEST = "scripts/bookings-actions.test.mjs";
const INSPPERMS = "scripts/inspection-permissions.test.mjs";
const AGPDF = "scripts/agreement-pdf-access.test.mjs";
const CONTACT = "scripts/contact-status.test.mjs";
const IDENTITY = "scripts/identity-authorization.test.mjs";
const DLIST = "scripts/drivers-list-access.test.mjs";
const AOFN = "src/lib/admin-overview.functions.ts";
const AORULES = "src/lib/admin-overview.ts";
const AOPANEL = "src/components/admin/OverviewPanel.tsx";
const AREADS = "scripts/admin-reads-access.test.mjs";

/** [what it protects, file, exact line to remove or change, replacement, suite] */
const MUTATIONS = [
  ["a photo never yields registration, insurance, title or finance fields", RULES,
    "    if (photo && PHOTO_NEVER_FIELDS.has(field)) continue;", "", SERVER],
  ["a photo never outranks the registration card", RULES,
    "  license_plate: 35, plate_state: 35,", "  license_plate: 100, plate_state: 100,", SERVER],
  ["no photo-derived value is ever 'safe'", INBOX,
    "            && !isPhotoClass(it.doc_class),", "            ,", SERVER],
  ["a photo files no finance facts", CORE,
    "    const fin = isPhotoClass(docClass) ? [] : Object.entries(e.fields).filter(([k]) => isFinanceField(k));",
    "    const fin = Object.entries(e.fields).filter(([k]) => isFinanceField(k));", SERVER],
  ["the same photograph is never read twice", DOORWAY,
    "      if (priorItem) return { ok: true, mediaId: data.mediaId, itemId: priorItem.id as string, duplicate: true };",
    "      if (!priorItem) return { ok: false, mediaId: data.mediaId };", SERVER],
  ["only original photographs are read", DOORWAY,
    '    if (media.kind !== "original") {', "    if (false) {", SERVER],
  ["a photo cannot be filed as another vehicle's", DOORWAY,
    "    if (media.vehicle_id !== data.vehicleId) {", "    if (false) {", SERVER],
  ["the Photos tab is excluded from Safe Autofill", CORE,
    "  if (!isStaffReviewChannel(srcBatch?.source_channel)) await",
    '  if (srcBatch?.source_channel !== "vehicle_profile") await', CHANNEL],
  ["approving a field reloads the vehicle profile", PHOTOS,
    "                          window.dispatchEvent(new Event(\"vehicle-profile-refresh\"));\n                        }\n                      }}",
    "                        }\n                      }}", UI],
  ["an apply that wrote nothing does not claim a refresh", PHOTOS,
    "                        if (written > 0) {", "                        if (true) {", UI],
  ["only originals can be chosen for reading", PHOTOS,
    '              {picking && m.kind === "original" && (', "              {picking && (", UI],
  ["two simultaneous reads cannot both take the last slot", CAP,
    '      .eq("key", PHOTO_READING_KEY).eq("value->>version", String(current.version)).select("key");\n    // Exactly one writer sees rows come back',
    '      .eq("key", PHOTO_READING_KEY).select("key");\n    // Exactly one writer sees rows come back', CAPTEST],
  ["reading is off until an Owner turns it on", RULES2,
    '  if (!s.enabled) return "Photo Reading is switched off. An Owner can turn it on in Settings → Photo Reading.";',
    "", CAPTEST],
  ["the daily limit refuses the read that would exceed it", RULES2,
    "  if (remainingOn(s, day) <= 0) return `Today's limit of ${s.dailyLimit} photo${s.dailyLimit === 1 ? \"\" : \"s\"} has been reached. It resets at midnight UTC.`;",
    "", CAPTEST],
  ["a reserved slot is released when the item insert fails", DOORWAY,
    "    if (!item) {\n      await releasePhotoRead(sb, slot.day);",
    "    if (!item) {", CAPTEST],
  ["a reserved slot is released when the queue insert fails", DOORWAY,
    "      await sb.from(\"fleet_import_items\").update({ status: \"failed\", error: \"Could not queue the reading.\" }).eq(\"id\", item.id);\n      await releasePhotoRead(sb, slot.day);",
    "      await sb.from(\"fleet_import_items\").update({ status: \"failed\", error: \"Could not queue the reading.\" }).eq(\"id\", item.id);", CAPTEST],
  ["an inspection cannot be started against a vehicle that is not there", INSPFN,
    '    if (!vehicle) throw new Error("That vehicle no longer exists.");', "", READYTEST],
  ["an archived vehicle cannot be inspected", INSPFN,
    '    if (vehicle.archived_at)\n      throw new Error("That vehicle is archived — restore it before inspecting it.");',
    "", READYTEST],
  ["the inspection form prefers the vehicle it was sent", INSPUI,
    "useState(initialVehicleId ?? vehicles[0]?.id ?? \"\")", 'useState(vehicles[0]?.id ?? "")', READYTEST],
  ["a readiness Fix carries the vehicle id", PROFILE,
    "search: { tab: f.tab, id: v.id } as never", "search: { tab: f.tab } as never", READYTEST],
  ["the router lets the inspections tab keep the vehicle id", ADMIN,
    '  id: ["drivers", "vehicles", "inspections", "bookings"],', '  id: ["drivers", "vehicles"],', READYTEST],
  ["a title scan counts as a title on file", READY,
    "  if (t) return t.documentOnFile || t.metadataRecorded;", "  if (t) return t.metadataRecorded;", READYTEST],
  ["a missing registration expiry still blocks (no quiet downgrade)", READY,
    'checks.push(expiryCheck("registration", "Registration", v.registration_expires_on ?? null, slots.has("registration"), today, { kind: "edit", section: "dmv" }, "not_ready", "Open Registration"));',
    'checks.push(expiryCheck("registration", "Registration", v.registration_expires_on ?? null, slots.has("registration"), today, { kind: "edit", section: "dmv" }, "attention", "Open Registration"));', READYTEST],
  ["a missing insurance expiry still blocks (no quiet downgrade)", READY,
    'checks.push(expiryCheck("insurance", "Insurance", v.insurance_expires_on ?? null, slots.has("insurance_card"), today, { kind: "edit", section: "insurance" }, "not_ready", "Open Insurance"));',
    'checks.push(expiryCheck("insurance", "Insurance", v.insurance_expires_on ?? null, slots.has("insurance_card"), today, { kind: "edit", section: "insurance" }, "attention", "Open Insurance"));', READYTEST],
  ["every check carries a category", READY,
    '{ key: "safety", label: "Safety Issues", category: "operational", status: "ready"',
    '{ key: "safety", label: "Safety Issues", status: "ready"', READYTEST],
  ["the drawer that shows the plate can edit it", VEH,
    '    "license_plate",\n    "plate_state",\n    "seats",', '    "seats",', PLATETEST],
  ["a plate is stored upper-cased, so the unique index agrees with it", VEH,
    'const UPPERCASE_FIELDS = new Set(["vin", "license_plate", "plate_state", "registration_state"]);',
    'const UPPERCASE_FIELDS = new Set(["vin", "registration_state"]);', PLATETEST],
  ["what is never a plate is refused", VEH,
    "      const problem = plateProblem(nextPlate);\n      if (problem) return { ok: false, error: problem, field: \"license_plate\" };",
    "", PLATETEST],
  ["a plate state is one of the states", VEH,
    "      if (!isUsStateCode(nextPlateState))", "      if (false)", PLATETEST],
  ["two cars cannot wear one plate", VEH,
    '      ["license_plate", "license_plate", "plate"],\n', "", PLATETEST],
  ["Add Vehicle refuses what the drawer would refuse", VEH,
    "        const problem = plateProblem(data.license_plate.trim().toUpperCase());\n        if (problem) return { ok: false, error: problem, field: \"license_plate\" };",
    "", PLATETEST],
  ["editing a vehicle is Manager-only", VEH,
    "    const actor = await requireManager(context.userId);\n    const { supabaseAdmin } = await import(\"@/integrations/supabase/client.server\");\n    return applySection(supabaseAdmin, actor, {",
    "    const actor = await requireStaff(context.userId);\n    const { supabaseAdmin } = await import(\"@/integrations/supabase/client.server\");\n    return applySection(supabaseAdmin, actor, {",
    PLATETEST],
  ["the plate state dropdown offers the states", PROFILE,
    "            options={usStateOptions()}", '            options={[{ value: "", label: "—" }]}', PLATETEST],
  ["Edit Details points at the drawer that owns the expiry dates", PROFILE,
    'onOpenSection("dmv");', 'onOpenSection("identity");', PLATETEST],
  ["a handed-over drawer starts from the saved record", PROFILE,
    "          key={editing}\n", "", PLATETEST],
  ["an extracted plate is never swept in by Approve Safe Fields", INBOX,
    '            && !["license_plate", "plate_state", "current_odometer", "vin"].includes(c.field)',
    "            && true", PLATETEST],
  ["Add Vehicle chooses a state rather than typing one", EDITOR,
    "              {usStateOptions().map((o) => (", "              {[{ value: \"\", label: \"—\" }].map((o) => (", PLATETEST],
  ["a refused field is reported, not swallowed", VEH,
    '        if (!canTitle) rejected.push({ ...named(k), reason: "Title details are Owner-only." });',
    "        if (!canTitle) { /* nothing */ }", PHASE2],
  ["a field that did not move is not reported as saved", VEH,
    "      (changedKeys.includes(k) ? saved : unchanged).push(named(k));",
    "      saved.push(named(k));", PHASE2],
  ["a field this section does not own is reported as ignored", VEH,
    "      .filter((k) => !allowed.includes(k))", "      .filter(() => false)", PHASE2],
  ["the save answers about the fields the operator edited", VEH,
    "      intended: data.intended,", "      intended: undefined,", PHASE2],
  ["applying an extracted detail is Manager-and-above", INBOX,
    '    if (!isManager && data.decisions.some((d) => d.action !== "ignore")) {\n      throw new Error("Forbidden: applying extracted details to a vehicle is Manager-only.");\n    }',
    "", PHASE2],
  ["a Coordinator keeps dismissing a proposal", INBOX,
    'data.decisions.some((d) => d.action !== "ignore")', "data.decisions.length", PHASE2],
  ["the Fleet Inbox apply bar is Manager-only", INBOXUI,
    "      {isManager && selected.length > 0 && (", "      {selected.length > 0 && (", PHASE2],
  ["the accept checkboxes are Manager-only", INBOXUI,
    '                  {p.kind !== "new" && !done && isManager && (',
    '                  {p.kind !== "new" && !done && (', PHASE2],
  ["an extracted plate needs an individual tick", RULES,
    '  "vin", "license_plate", "title_number", "title_status", ...FINANCE_FIELDS,',
    '  "vin", "title_number", "title_status", ...FINANCE_FIELDS,', PHASE2],
  ["a high-risk field with no tick is reported as waiting", INBOX,
    "            if (HIGH_RISK.has(f) && !dec.confirmHighRisk.includes(f)) {\n              needsConfirmation.push(f);",
    "            if (HIGH_RISK.has(f) && !dec.confirmHighRisk.includes(f)) {", PHASE2],
  ["a conflicting value with no tick is reported as waiting", INBOX,
    '            if (c.kind === "conflict" && !dec.confirmHighRisk.includes(f)) {\n              needsConfirmation.push(f);',
    '            if (c.kind === "conflict" && !dec.confirmHighRisk.includes(f)) {', PHASE2],
  ["an Owner-only field dropped by the apply path says so", INBOX,
    '          refused.push({ field: f, label: labelOf(f), reason: "Owner only." });', "", PHASE2],
  ["a value the record already holds is not reported as applied", INBOX,
    "          if (!c) {\n            unchangedFields.push(f);", "          if (!c) {", PHASE2],
  ["a car that cannot be rented is not graded ready", LISTRULES,
    '  if (!isRentalReady(v)) return "not_ready";', '  if (false) return "not_ready";', PHASE2],
  ["an unpublished photo does not make a car listing ready", LISTRULES,
    '  return hasPublishedPhoto ? "listing_ready" : "rental_ready";', '  return "listing_ready";', PHASE2],
  ["only an explicitly published photo counts", LIST,
    '      supabaseAdmin.from("vehicle_media").select("vehicle_id").eq("published", true).limit(20000),',
    '      supabaseAdmin.from("vehicle_media").select("vehicle_id").limit(20000),', PHASE2],
  ["the readiness chips count the scope, not the page", LIST,
    "        READINESS_SWEEP_MAX + 1,", "        1,", PHASE2],
  ["the readiness filter reaches the query, so paging stays right", LIST,
    '      query = query.in("id", matching);', "", PHASE2],
  ["an unknown band is not a filter", LIST,
    '    const ready = isReadinessFilter(data.ready) ? data.ready : "all";',
    "    const ready = data.ready;", PHASE2],
  ["the review panel reads the itemised answer", PANEL,
    "          applied += Array.isArray(r.applied)",
    "          applied += (0, Array).isArray(r.applied)", PHASE2],
  ["the review panel reports a refused detail", PANEL,
    "      for (const r of refused) parts.push(`${titleCase(r.label)} was not saved: ${r.reason}`);",
    "", PHASE2],
  ["paperwork is offered after the car is saved", EDITOR,
    '    setCreated({ id, label });\n    setMode("docs");', "    onCreated(id);", PHASE2],
  // ---------------------------------------------------------------- Bookings
  // A booking is a rental, read. The money boundary, the application join and
  // the driver's own scope are the three things that must never slip.
  ["a Coordinator's booking list carries no money", BOOKFN,
    '    const canSeeMoney = tierAllows(actor.tier, "manager");\n    const sb = await admin();\n    const phase = isBookingPhaseFilter(data.phase) ? data.phase : "all";',
    '    const canSeeMoney = true;\n    const sb = await admin();\n    const phase = isBookingPhaseFilter(data.phase) ? data.phase : "all";', BOOKLIST],
  ["a Coordinator's booking detail carries no money", BOOKFN,
    '    const canSeeMoney = tierAllows(actor.tier, "manager");\n    const sb = await admin();\n\n    const { data: r } = await sb',
    '    const canSeeMoney = true;\n    const sb = await admin();\n\n    const { data: r } = await sb', BOOKDETAIL],
  ["only staff may list bookings", BOOKFN,
    "  .handler(async ({ data, context }): Promise<BookingListResult> => {\n    const actor = await requireStaff(context.userId);",
    '  .handler(async ({ data, context }): Promise<BookingListResult> => {\n    const actor = { tier: "owner" };', BOOKLIST],
  ["only staff may open a booking", BOOKFN,
    "  .handler(async ({ data, context }): Promise<BookingDetail | null> => {\n    const actor = await requireStaff(context.userId);",
    '  .handler(async ({ data, context }): Promise<BookingDetail | null> => {\n    const actor = { tier: "owner" };', BOOKDETAIL],
  ["the listed driver comes from application_id, not driver_id", BOOKFN,
    "      const app = r.application_id ? appById.get(String(r.application_id)) : undefined;",
    "      const app = r.driver_id ? appById.get(String(r.driver_id)) : undefined;", BOOKLIST],
  ["the opened driver comes from application_id, not driver_id", BOOKFN,
    '            .eq("id", String(rental.application_id))',
    '            .eq("id", String(rental.driver_id))', BOOKDETAIL],
  ["the counts count the filtered scope, not the whole fleet", BOOKFN,
    '    const { data: statusRows } = await scoped(sb.from("rentals").select("status")).limit(5000);',
    '    const { data: statusRows } = await sb.from("rentals").select("status").limit(5000);', BOOKLIST],
  ["a search that matched nobody returns nobody", BOOKFN,
    "    if (searchRentalIds && !searchRentalIds.length) {", "    if (false) {", BOOKLIST],
  ["both spellings of cancelled are read as cancelled", BOOKRULES,
    '  if (s === "cancelled" || s === "canceled" || s === "void" || s === "voided") return "cancelled";',
    '  if (s === "void" || s === "voided") return "cancelled";', BOOKLIST],
  ["an active rental's absent end date is open-ended, not a gap", BOOKRULES,
    '  if (b.phase !== "active" && !b.endDate) out.push("End date not recorded");',
    '  if (!b.endDate) out.push("End date not recorded");', BOOKDETAIL],
  ["a driver's history is their own rentals only", PORTALFN,
    '      .eq("driver_id", userId)\n      .order("start_date", { ascending: false, nullsFirst: false })',
    '      .order("start_date", { ascending: false, nullsFirst: false })', BOOKDETAIL],
  // ------------------------------------------------------- Bookings R1
  ["an inspection of a car that is OUT is filed against its rental", INSPFN2,
    '    let rentalId = data.rentalId ?? null;\n    if (!rentalId) {',
    "    let rentalId = data.rentalId ?? null;\n    if (false) {", BOOKACTTEST],
  ["the rental back-fill takes only the ACTIVE rental", INSPFN2,
    '        .eq("vehicle_id", data.vehicleId)\n        .eq("status", "active")\n        .maybeSingle();',
    '        .eq("vehicle_id", data.vehicleId)\n        .maybeSingle();', BOOKACTTEST],
  ["a Coordinator's incident carries no cost", BOOKFN,
    "      if (canSeeMoney) {\n        row.estimatedCost = i.estimated_cost == null ? null : Number(i.estimated_cost);",
    "      if (true) {\n        row.estimatedCost = i.estimated_cost == null ? null : Number(i.estimated_cost);", BOOKACTTEST],
  ["a Coordinator's service record carries no bill", BOOKFN,
    "      if (canSeeMoney) row.totalCost = m.total_cost == null ? null : Number(m.total_cost);",
    "      row.totalCost = m.total_cost == null ? null : Number(m.total_cost);", BOOKACTTEST],
  ["incidents and service are scoped to THIS rental", BOOKFN,
    '        .select(canSeeMoney ? INCIDENT_WITH_MONEY : INCIDENT_OPERATIONAL)\n        .eq("rental_id", data.rentalId)',
    "        .select(canSeeMoney ? INCIDENT_WITH_MONEY : INCIDENT_OPERATIONAL)", BOOKACTTEST],
  ["End Rental is a Manager action", RENTALFN2,
    '  const { requireManager } = await import("@/lib/roles.server");\n  return requireManager(userId);',
    '  const { requireStaff } = await import("@/lib/roles.server");\n  return requireStaff(userId);', BOOKACTTEST],
  // ------------------------------------ the Coordinator handoff permission
  ["destroying a condition photo stays Owner-or-Manager", INSPFN2,
    "async function isStaff(supabase: unknown, userId: string): Promise<boolean> {\n  return tierAllows(await staffTier(supabase, userId), \"manager\");",
    "async function isStaff(supabase: unknown, userId: string): Promise<boolean> {\n  return tierAllows(await staffTier(supabase, userId), \"coordinator\");", INSPPERMS],
  ["the handoff permission is Coordinator-and-above, not narrower", INSPFN2,
    "async function canInspect(supabase: unknown, userId: string): Promise<boolean> {\n  return tierAllows(await staffTier(supabase, userId), \"coordinator\");",
    "async function canInspect(supabase: unknown, userId: string): Promise<boolean> {\n  return tierAllows(await staffTier(supabase, userId), \"manager\");", INSPPERMS],
  ["the delete is the one endpoint still asking isStaff", INSPFN2,
    '    if (!(await isStaff(context.supabase, context.userId))) throw new Error("Forbidden");',
    '    if (!(await canInspect(context.supabase, context.userId))) throw new Error("Forbidden");', INSPPERMS],
  ["an upload is pinned to one vehicle's folder", INSPFN2,
    '    if (!data.path.startsWith(`${data.vehicleId}/`)) throw new Error("Invalid upload path");',
    "", INSPPERMS],
  ["a driver's upload cannot name another car", INSPFN2,
    '      if (!rental?.vehicle_id) throw new Error("No active rental on file");\n      vehicleId = rental.vehicle_id as string;',
    '      if (!rental?.vehicle_id) throw new Error("No active rental on file");',
    INSPPERMS],
  ["a driver reads only an inspection on the car they rent", INSPFN2,
    '      if (!rental || rental.vehicle_id !== inspection.vehicle_id) throw new Error("Forbidden");',
    "", INSPPERMS],
  ["a forged vehicle id cannot start an inspection", INSPFN2,
    '    if (!vehicle) throw new Error("That vehicle no longer exists.");', "", INSPPERMS],
  ["the signed agreement PDF is offered only to a Manager", BOOKDRAWER,
    "                  (d.canManage ? (", "                  (true ? (", AGPDF],
  ["the booking read serves agreement metadata, not the contract", BOOKFN,
    '        .select("id,title,status,sent_at,signed_at,voided_at,archive_status,document_id")',
    '        .select("id,title,status,sent_at,signed_at,voided_at,archive_status,document_id,body")', AGPDF],
  // --------------------------------------- the contract minimum-term date
  ["the minimum term is computed from the real start date", AGFN,
    "    const endIso = minTermEndIso(startIso, minTermWeeks(terms.min_term_weeks));",
    '    const endIso = minTermEndIso(data.start_date, minTermWeeks(terms.min_term_weeks));', MINTERM],
  ["the start date is threaded through, not recovered from the print", AGFN,
    "  return { data, app, vehicle, blockers, startIso: startDate ?? null };",
    "  return { data, app, vehicle, blockers, startIso: null };", MINTERM],
  ["applyPrep gets the real start date, so an expired licence is still caught", AGFN,
    "    const r = applyPrep(prep, { startIso: built.startIso, depositClause: String(terms?.deposit_clause ?? \"\") });",
    '    const r = applyPrep(prep, { startIso: null, depositClause: String(terms?.deposit_clause ?? "") });', MINTERM],
  ["a week is seven days", AGDATES,
    "  return isoOf(new Date(Date.UTC(p.y, p.m - 1, p.d + Math.floor(weeks) * 7)));",
    "  return isoOf(new Date(Date.UTC(p.y, p.m - 1, p.d + Math.floor(weeks) * 6)));", MINTERM],
  ["a day that does not exist is not rolled into the next month", AGDATES,
    "  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) {\n    return null;\n  }",
    "", MINTERM],
  ["a zero or missing term computes nothing", AGDATES,
    "  if (!Number.isFinite(weeks) || weeks <= 0) return null;", "", MINTERM],
  // ------------------------------------------------- Contact Status (1A)
  // Who may set it, that the server re-checks the popover's rules, and that
  // the dialling log never reaches the application lifecycle.
  ["only staff may set a contact status", CSFN,
    "    const actor = await requireStaff(context.userId);",
    '    const actor = { userId: context.userId, email: null, role: "admin", tier: "owner" } as never;', CONTACT],
  ["the server re-checks the field rules, not just the browser", CSFN,
    "    if (blockers.length) throw new Error(blockers.map((b) => b.why).join(\" \"));",
    "", CONTACT],
  ["the contact write carries no lifecycle column", CSFN,
    "      .update({\n        ...patch,",
    "      .update({\n        ...patch,\n        status: data.status,", CONTACT],
  ["the row records who set it", CSFN,
    "        contact_status_by: actor.userId,", "        contact_status_by: null,", CONTACT],
  ["a contact change is audited", CSFN,
    "    await logAudit(actor, {", "    await Promise.resolve({", CONTACT],
  ["a missing migration is reported as one, whichever way the server says it", CSFN,
    '  if (err.code === "42703" || err.code === "PGRST204") return true;', "", CONTACT],
  ["Follow-Up needs its date", CSRULES,
    '        followUp: "required",\n        noteLabel: "Note",\n        hint: "Pick the day to call them back.",',
    '        followUp: "optional",\n        noteLabel: "Note",\n        hint: "Pick the day to call them back.",', CONTACT],
  ["a status drops the values it has no use for", CSRULES,
    '    contact_follow_up_on: form.followUp === "off" || !followUp ? null : followUp,',
    "    contact_follow_up_on: followUp || null,", CONTACT],
  ["a database without the columns is not reported as supported", CSRULES,
    '  const supported = Object.prototype.hasOwnProperty.call(r, "contact_status");',
    "  const supported = true;", CONTACT],
  // ------------------------------------- identity documents are Manager+
  ["a driver's document vault is Manager-and-above", DOCFN,
    "    const { requireManager } = await import(\"@/lib/roles.server\");\n    await requireManager(context.userId);\n    const owner = await isOwner(context.supabase, context.userId);",
    "    const { requireStaff } = await import(\"@/lib/roles.server\");\n    await requireStaff(context.userId);\n    const owner = await isOwner(context.supabase, context.userId);", IDENTITY],
  ["staff uploading a document must be a Manager", DOCFN,
    "    {\n      const { getActor, requireManager } = await import(\"@/lib/roles.server\");\n      if (await getActor(context.userId)) await requireManager(context.userId);\n    }\n    let applicationId = data.applicationId ?? null;",
    "    let applicationId = data.applicationId ?? null;", IDENTITY],
  ["staff confirming a document must be a Manager", DOCFN,
    "    {\n      const { getActor, requireManager } = await import(\"@/lib/roles.server\");\n      if (await getActor(context.userId)) await requireManager(context.userId);\n    }\n    const staff = admin || (await isStaffUser(context.userId));",
    "    const staff = admin || (await isStaffUser(context.userId));", IDENTITY],
  ["retitling a document is Manager-and-above", DOCFN,
    "    const { requireManager } = await import(\"@/lib/roles.server\");\n    await requireManager(context.userId);\n    await assertMayTouch(context.userId, data.documentId);",
    "    const { requireStaff } = await import(\"@/lib/roles.server\");\n    await requireStaff(context.userId);\n    await assertMayTouch(context.userId, data.documentId);", IDENTITY],
  ["verifying an identity document is Manager-and-above", DOCFN,
    "    const { requireManager } = await import(\"@/lib/roles.server\");\n    const { logAudit } = await import(\"@/lib/audit.server\");\n    const actor = await requireManager(context.userId);",
    "    const { requireStaff } = await import(\"@/lib/roles.server\");\n    const { logAudit } = await import(\"@/lib/audit.server\");\n    const actor = await requireStaff(context.userId);", IDENTITY],
  ["reissuing an applicant link is Manager-and-above", APPFN,
    "    const { requireManager } = await import(\"@/lib/roles.server\");\n    const actor = await requireManager(context.userId);\n    const { supabaseAdmin } = await import(\"@/integrations/supabase/client.server\");\n    const { revokeResumeTokens, issueResumeToken, resumeUrl } =",
    "    const { requireStaff } = await import(\"@/lib/roles.server\");\n    const actor = await requireStaff(context.userId);\n    const { supabaseAdmin } = await import(\"@/integrations/supabase/client.server\");\n    const { revokeResumeTokens, issueResumeToken, resumeUrl } =", IDENTITY],
  // ------------------------------- the Drivers list under 0031
  ["the Drivers list read is staff-gated on the server", DLFN,
    "    const actor = await requireStaff(context.userId);",
    '    const actor = { tier: "coordinator" } as never;', DLIST],
  ["a Coordinator's rows carry no identity fields", DLFN,
    '    const canSeeSensitive = tierAllows(actor.tier, "manager");',
    "    const canSeeSensitive = true;", DLIST],
  ["the projection drops the fields, it does not blank them", DLRULES,
    "  if (canSeeSensitive) return row;\n  const out: DriverListRow = {};",
    "  if (canSeeSensitive) return row;\n  const out: DriverListRow = { ...row };", DLIST],
  // ------------------------- the admin dashboard reads under 0030
  ["the Overview applicant read is staff-gated on the server", AOFN,
    "    const actor = await requireStaff(context.userId);",
    '    const actor = { tier: "coordinator" } as never;', AREADS],
  ["the notification read is staff-gated on the server", AOFN,
    "    await requireStaff(context.userId);", "", AREADS],
  ["a Coordinator is sent no readiness verdict", AOFN,
    '    const canSeeReadiness = tierAllows(actor.tier, "manager");',
    "    const canSeeReadiness = true;", AREADS],
  ["the applicant projection drops the readiness evidence", AORULES,
    "export function projectOverviewApplicant(row: RawRow): OverviewApplicantRow | null {\n  const id = str(row.id);\n  if (!id) return null;\n  return {",
    "export function projectOverviewApplicant(row: RawRow): OverviewApplicantRow | null {\n  const id = str(row.id);\n  if (!id) return null;\n  return {\n    ...(row as object),", AREADS],
  ["the notification projection drops everything but the contact details", AORULES,
    "export function projectNotification(row: RawRow): NotificationRow | null {\n  const id = str(row.id);\n  if (!id) return null;\n  return {",
    "export function projectNotification(row: RawRow): NotificationRow | null {\n  const id = str(row.id);\n  if (!id) return null;\n  return {\n    ...(row as object),", AREADS],
  ["a failed applicant read is raised, not rendered as zero", AOFN,
    "    for (const q of [newAppsQ, pendingAppsQ, appsQ]) {\n      if (q.error) throw new Error(q.error.message);\n    }",
    "", AREADS],
  ["a failed screening or document read is raised too", AOFN,
    "      for (const q of [screeningsQ, leadDocsQ]) {\n        if (q.error) throw new Error(q.error.message);\n        if (!q.data) throw new Error(\"Readiness evidence unavailable\");\n      }",
    "", AREADS],
  ["the counts begin unknown rather than zero", AOPANEL,
    "  const [newApps, setNewApps] = useState<number | null>(null);",
    "  const [newApps, setNewApps] = useState<number | null>(0);", AREADS],
  ["the evidence thumbnail uses the staff storage download", PANEL,
    "    void loadStaffPhoto(path).then((u) => { if (live) setUrl(u); });",
    "    void Promise.resolve(null).then((u) => { if (live) setUrl(u); });", UI],
];

// Browser-level safeguards. These need `npm run dev` running and take about
// a minute and a half each, so they are opt-in: MUTATE_E2E=1 node scripts/mutation-check.mjs
const E2E_MUTATIONS = [
  ["the Owner's switch actually disables the button", PHOTOS,
    "                      disabled={reading || !!readingStatus?.refusal}", "                      disabled={reading}", E2E],
  ["only original photographs can be chosen for reading", PHOTOS,
    '              {picking && m.kind === "original" && (', "              {picking && (", E2E],
  ["Edit Details really has somewhere to type a plate", PROFILE,
    '              label="License Plate"\n              value={str("license_plate")}',
    '              label="Listing Name"\n              value={str("nickname")}', PLATE_E2E],
  ["the plate state is chosen, not typed", PROFILE,
    "            <Choice\n              label=\"Plate State\"\n              value={str(\"plate_state\")}\n              onChange={(v) => set(\"plate_state\", v)}\n              options={usStateOptions()}",
    "            <Text\n              label=\"Plate State\"\n              value={str(\"plate_state\")}\n              onChange={(v) => set(\"plate_state\", v)}\n              hint={undefined}", PLATE_E2E],
  ["a drawer handed to another section does not carry stale edits", PROFILE,
    "          key={editing}\n", "", PLATE_E2E],
  ["the vehicles tab owns the readiness filter, so the router keeps it", ADMIN,
    '  ready: ["vehicles"],', "", PHASE2_E2E],
  ["the readiness chip actually filters", PANELUI,
    '                    onClick={() => setList({ ready: active ? "all" : band })}',
    "                    onClick={() => setList({})}", PHASE2_E2E],
  ["the drawer tells the server which fields were edited", PROFILE,
    "values: f, intended: edited }", "values: f, intended: [] }", PHASE2_E2E],
  ["a save with nothing changed does not claim one", PROFILE,
    '        toast.info("No changes to save");', '        toast.success("Saved");', PHASE2_E2E],
  ["the Bookings phase filter survives the admin router", ADMIN,
    '  phase: ["bookings"],\n', "", BOOKE2E],
  ["the money columns are not rendered for a Coordinator", BOOKPANEL,
    '                {money && <th className="px-3 py-2 font-medium">Weekly</th>}',
    '                <th className="px-3 py-2 font-medium">Weekly</th>', BOOKE2E],
  ["the Payments and Activity tabs are not offered to a Coordinator", BOOKDRAWER,
    "  const tabs = TABS.filter((t) => !t.money || money);", "  const tabs = TABS;", BOOKE2E],
  ["End Rental and Settle Deposit are not offered to a Coordinator", BOOKACT,
    "        {d.canManage && active && (", "        {active && (", BOOKE2E],
  ["the handoff carries the rental, not just the vehicle", BOOKACT,
    "        data: { vehicleId, templateId, rentalId, odometer: odo > 0 ? odo : null },",
    "        data: { vehicleId, templateId, odometer: odo > 0 ? odo : null },", BOOKE2E],
  ["accepting a detail reloads the vehicle profile", PHOTOS,
    "                          window.dispatchEvent(new Event(\"vehicle-profile-refresh\"));\n                        }\n                      }}",
    "                        }\n                      }}", E2E],
];

const ALL = process.env.MUTATE_E2E ? [...MUTATIONS, ...E2E_MUTATIONS] : MUTATIONS;

let blockers = 0;
for (const [what, file, from, to, suite] of ALL) {
  const src = readFileSync(file, "utf8");
  if (!src.includes(from)) {
    console.log(`  BLOCKER  ${what}\n           anchor no longer present in ${file} — update scripts/mutation-check.mjs`);
    blockers++;
    continue;
  }
  const bak = `${file}.mutbak`;
  copyFileSync(file, bak);
  try {
    writeFileSync(file, src.replace(from, to));
    // A browser suite asks the dev server for the file it is mid-way through
    // recompiling, and a page that failed to build fails every assertion —
    // including the ones this mutation was not about. Observed: a dropdown
    // mutation whose first red line was a field three checks earlier. Let HMR
    // settle so the suite goes red for the reason under test.
    if (/-e2e\.test\.mjs$/.test(suite)) await new Promise((r) => setTimeout(r, 6000));
    const run = spawnSync("node", [suite], { encoding: "utf8" });
    if (run.status === 0) {
      console.log(`  BLOCKER  ${what}\n           ${suite.split("/").pop()} still passed with the guard removed`);
      blockers++;
    } else {
      console.log(`  PASS     ${what}`);
    }
  } finally {
    renameSync(bak, file);
  }
}
for (const f of [RULES, CORE, INBOX, DOORWAY, PHOTOS, PANEL, CAP, RULES2, READY, INSPFN, 
  INSPUI, PROFILE, ADMIN, VEH, EDITOR, LIST, LISTRULES, PANELUI, INBOXUI, BOOKFN, BOOKRULES, 
  BOOKPANEL, BOOKDRAWER, PORTALFN, BOOKACT, INSPFN2, RENTALFN2, AGFN, AGDATES, CSFN, CSRULES, DOCFN, APPFN, DLFN, DLRULES]) {
  if (existsSync(`${f}.mutbak`)) { console.log(`  BLOCKER  ${f} was left mutated`); blockers++; }
}
console.log(blockers ? `\n${blockers} guard(s) not covered by a failing test` : "\nevery guard has a test that fails without it");
process.exit(blockers ? 1 : 0);
