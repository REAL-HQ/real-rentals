# Vehicles: Compact Native-Zoom Toolbar (Review Only)

Separate child of PR 320, whose head remains `91e96f153face2cfeb2c7daffb90d5782234cb83`. PRs 321/322/323 untouched.

## Layout

Search, Status, Body Type, Partner, Sort and actions now follow the same visual/keyboard order. Content-sized groups share a row when they physically fit, or wrap a whole group coherently. No orphan Sort, midpoint actions, zoom, scaling or shrunken text. Main controls remain 36px tall, with 14px main control/table text. The shared default toolbar layout stays unchanged; Vehicles opts into compact layout.

Concise all-filter labels and a short search placeholder do not change stored values, queries, readiness, numbering, counts, clear-search or actions. Search's title still lists Unit, VIN, Plate, Year, Make and Model.

Readable table padding/minimum width are reduced. At native 1280/1440px the representative full table fits, including Open. At narrower widths its keyboard-accessible local scroll region retains all columns/actions without horizontal PAGE overflow. Fixture and real shell both use a 220px sidebar and 32px desktop main gutters.

## Native-Width Results

- 1280/1440/1600px: normal toolbar is ONE compact row; all representative columns fit.
- 1024px: Search + four filters form a row; List/Cards, Import and Add Vehicle form a clear second row. This is physical wrapping, not a claim the zoomed-out screenshot fits at native text size. Table scroll stays local.
- 320/390/768px: coherent groups and paired narrow filters; all actions reachable, no page overflow.
- Extra Maintenance Due button enabled ONLY in an offline synthetic variant verifies content-driven wrapping. No real flag/setting is changed.

## Validation

Passed full `PG_BIN=/tmp/pgbin npm test`, `npx tsc --noEmit`, `npm run build` and 23 actual-component browser scenarios across seven widths. Tests check native scale, readable fonts, geometry/non-overlap, visual/keyboard order, optional extra action, full table fit/Open reachability, plus existing white Body Type popup/value/keyboard behavior. The obsolete fixed 64rem source guard now tracks the readable 56rem minimum; actual browser geometry validates behavior.

Candidate: `.toolbar-layout-build/default.html`; screenshots `vehicles-390.png`, `vehicles-1024.png`, `vehicles-1280.png`, `vehicles-1440.png` alongside it. Real VehiclesPanel/AdminToolbar and production CSS, synthetic rows, inactive server/actions, no network. Human-browser review remains pending.

No merge/publish, migrations, production records or customer actions. App-wide labels/menus and existing-upload drag/drop remain separate preserved workstreams.
