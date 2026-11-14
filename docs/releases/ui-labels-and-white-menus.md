# t179: Explicit UI Labels and White Accessible Menus

Stack: `fix/app-ui-labels` → `fix/vehicles-toolbar-compact` (PR324 at `42c88b669b8d45502a5cbd22fffb6cbbea07b508`). PR320–323 are unchanged. PR324 now has the separately verified 14px List/Cards follow-up at `8f697a7ee0da263c2d9e82a6355061b36d2f98ac`; this branch retains that follow-up.

## Inventory and Scope

- Baseline **69 native select source sites in 46 callsite files**; **47 files including the new shared AppSelect for that native migration**. These are source sites, not a claim of 69 runtime instances. `docs/audits/ui-native-select-inventory.json` pins every original value/change/disabled/required/style contract.
- An additional existing custom partner-form popup wrapper (five rendered fields) now reuses AppSelect, preserves uppercase state abbreviations and uses three explicit owned option labels instead of lowercasing option text. This is **70 picker source sites / 47 callsite files**, plus the shared component; it is not misreported as another native select.
- All 69 native source sites use an accessible in-app white popup. The sole remaining native select in app source is the hidden raw-value event/form-validation bridge. Field names or existing label associations are present at every migrated site.
- **233 explicit source-label edits**, separately inventoried in `docs/audits/ui-static-label-changes.json`: owned headings, field labels, buttons, action links, options, accessible names, label declarations and conditional action labels. The read-only TypeScript AST audit covers semantic owners in components/routes; it is not a claim that every string or arbitrary customer-authored label was title-cased.
- Owned enum labels are explicit declarations in `src/lib/ui-display-labels.ts`; unknown values and customer names are returned unchanged. Existing specialized domain labels still take priority. API/database values and existing change handlers are unchanged.
- Removed blind CSS capitalization and 174 uppercase/lowercase JSX class overrides so explicit source casing is actually visible. The branded Logo's own uppercase treatment is intentionally retained; input normalization of VIN/state identifiers is unchanged.
- Consent sentences, version designators, plural/count fragments, full explanatory prose and customer content are deliberately not rewritten. The 23 remaining semantic-audit proposals are inventoried as preserved fragments, not hidden as a zero-findings claim. Dynamic data is not generically capitalized. Nonsemantic/custom render paths are not proven exhaustive by this audit.
- Shared Select, Dropdown Menu, Context Menu, Menubar and Popover open surfaces (and Command/navigation popup roots) are white with explicit readable dark text even in dark theme; the primary popup wrappers are with an explicit elevated popup layer. Disabled options/groups, keyboard/typeahead, labels, focus return and first-Escape-only popup dismissal remain available.

## Compatibility Details

AppSelect owns raw FormData values through a genuine select event bridge, not encoded Radix values or fabricated ChangeEvents. Required empty values validate through the raw bridge and focus the visible trigger with an accessible error. Controlled rejection, disabled controls, numeric/empty values, uncontrolled async options and native form resets are covered. Native reset defaults are raw and synchronous; visible React state follows the reset event. PDF preview page options now render from React state instead of mutating a trigger's innerHTML. The old custom native arrow in the hero quote field was removed to avoid duplicate chevrons.

## Reproduction

- `PG_BIN=/tmp/pgbin npm test`
- `npx tsc --noEmit`
- `npm run build`
- `node scripts/ui-labels.test.mjs` — 131 inventory/contract checks.
- `node scripts/app-select-browser.test.mjs` — 29 actual-component browser checks; actual AppSelect, shared modal and action menu, production CSS, synthetic data and blocked HTTP. No customer writes, service calls or uploads. Candidate: `.ui-label-browser/candidate.html`; screenshots beside it.
- `node scripts/ui-label-audit.mjs` — read-only proposal inventory, never a runtime label formatter.

No merge, deployment, live migrations, renter activation, messages, production uploads or customer records. t180 upload drag/drop remains a separate queued scope; this branch does not claim it complete.
