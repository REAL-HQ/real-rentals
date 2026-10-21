# Driver Page Accessibility And Mobile Audit

Audited on `7e3e6eb` (the live driver site), locally, at a 390×844 phone viewport. Not run against production.

Tooling: axe-core 4.14.0 injected into the local Vite app through Chrome, plus a layout pass for tap targets, labels, alt text, horizontal overflow, and resource timing. Keyboard: 18 Tab presses per page. Pages: `/`, `/fleet`, `/apply`, `/portal` (signed out).

Severity:

- **Critical** — a control has no accessible name, so a screen reader cannot identify it.
- **Serious** — a WCAG A/AA failure on content a driver sees or hears.
- **Moderate** — landmarks, target size, or focus behavior that makes the page harder to use.
- **Low** — performance notes, incomplete axe checks, or an allowed exception.

## Counts

axe violation rules are counted per page (the same rule on two pages counts twice). Nodes are the individual elements.

| Page | Before rules | Before nodes | After rules | After nodes |
| --- | ---: | ---: | ---: | ---: |
| `/` | 3 | 16 | 1 | 12 |
| `/fleet` | 3 | 7 | 1 | 4 |
| `/apply` | 0 | 0 | 0 | 0 |
| `/portal` | 3 | 3 | 0 | 0 |
| **Total** | **9** | **26** | **2** | **16** |

The 16 nodes that remained after the label and tap-target pass were color contrast. The owner-review section records the shade used for each.

Manual tap targets under 44px: 27 on `/`, 17 on `/fleet`, 9 on `/apply`, 3 on `/portal` before. After: 0, 0, 0, 0.

Unlabeled inputs: 0 before and after. Images missing alt: 0. Page-level horizontal overflow: none before or after (`scrollWidth` 390). No keyboard trap on any of the four pages.

## Findings

### Critical

**Fleet Make menu had no accessible name.** The Radix combobox button on `/fleet` exposed neither the word Make nor the selected value. Fixed with `aria-label` that includes both (`Make, All`, or `Make` plus the chosen make). No change to what the menu filters.

### Serious

**Logo accessible name dropped the visible wordmark.** Header and footer marks used `aria-label="REAL RENTALS home"`, which replaced the visible text `REAL` / `RENTALS`. axe reported that the visible text was not in the name (`/`, `/fleet`, `/portal`). Fixed by removing the overriding label and adding a screen-reader-only “home” after the wordmark, so the visible words stay in the name.

**Sticky call button name did not include its visible label.** On `/`, the bottom bar shows “Call Now” but the accessible name was only “Call REAL RENTALS”. Fixed so the name starts with “Call Now” and still includes the phone number.

**Comparison table could not be scrolled from the keyboard.** The home comparison is a horizontal scroller with no focusable control inside it. Fixed with `tabIndex={0}`, `role="region"`, and `aria-label="Compare Rental Options"`, plus a visible focus outline. The table still scrolls sideways on a phone. That scroll is inside the region, not a page overflow.

**Decorative step numbers fail contrast.** The shade in the owner-review table replaces this color. Home steps 01–04 were `#f3f3f3` on white, ratio 1.1:1. They repeat the “STEP 01” text already next to them. `aria-hidden` stays set so a screen reader does not announce them twice. axe still measures the painted color.

**Comparison “yes” cells fail contrast.** The shade in the owner-review table replaces this green. Positive cells were green `#00a63e` on yellow `#fef9c2`, ratio 2.99:1 (needs 4.5:1). Seven cells on `/`. The yellow background is unchanged.

**Fleet category taglines fail contrast.** The owner-review table sets the selected tagline to solid white. “Great MPG · Uber & Lyft” and the two sibling lines are 10px white at 90% opacity on `#d03020`, ratio 4.36:1 (needs 4.5:1).

**Footer band subtitle fails contrast.** The owner-review table sets this line to solid white. “Get A Quote In Minutes…” is `text-white/90` on the red band, ratio 4.36:1. It is on `/` and `/fleet`.

### Moderate

**Signed-out portal had no main landmark.** `/portal` rendered the sign-in prompt outside `<main>`, so axe reported a missing main landmark and content outside landmarks. The loading state had the same shape. Both are wrapped in `<main>`. The signed-in dashboard was not exercised (no driver session).

**Tap targets under 44px.** Measured border boxes at 390px. Fixed with `min-h-11` / `min-w-11` (44px) and, for the two checkboxes a driver taps, a 44px box:

- Header phone icon (16×16), Book Now (36px tall), menu button (36×36)
- Location scroll buttons (40×40)
- Home FAQ summaries (24px tall), “View All”, “See All FAQs”
- Footer links, phone, and email (about 16–20px tall; short labels were also under 44px wide)
- Fleet Make trigger (`h-9`, 36px) and the Available Now Only checkbox (13px)
- Apply name, email, and phone fields (38px), the SMS consent checkbox (16px), and the help phone link (38px tall)

**Inline legal links.** On `/apply`, “Terms” and “Privacy Policy” sit inside the submission sentence and the SMS disclosure (four links). Each link keeps `display: inline` and gains 10px of padding above, 19px below, and 8px on each side. The horizontal padding is cancelled by a matching negative margin, and `box-decoration-break: clone` gives every wrapped line its own padding. Measured at 390px, the words, the line break (“Privacy” / “Policy”), and the line spacing match the unpadded sentence. Each line’s border box is at least 44px, and the boxes clear the Continue button.

**Focus indicator.** Tab order on all four pages walks the page and returns to the start. Nothing trapped focus. Several fields use `outline-none` and show focus by changing the border color (`focus:border-real-red`). That is a visible indicator, not a missing one. Not changed.

### Low

**No missing alt text** on images rendered on these four pages.

**No page overflow.** `documentElement.scrollWidth` equals the 390px layout width. The comparison table and the city row scroll inside their own regions.

**Render-blocking and third-party assets (not changed).** Each page loads `styles.css` and the Poppins stylesheet from the head without `async`. Google tag (`gtag/js`) is `async`. On this dev server the slowest calls were Supabase reads (about 90–250ms) and, on `/portal`, Stripe.js (about 30ms) even on the signed-out screen. Dev module loads are not production timings. Removing fonts, the tag, or Stripe would change behavior, so they are out of this pass.

**Incomplete contrast.** axe left one incomplete color-contrast result on `/` (it could not decide). Not counted as a violation.

## What this change does not do

No queries, validation, submission, auth, or copy changes. The Terms and Privacy words stay inside their sentences.

## Owner review: contrast shades

The 16 color-contrast nodes are recolored here, and nowhere else. Each new shade is the nearest step on the existing brand ramp that reaches WCAG AA (4.5:1, or 3:1 for the 48px bold step numbers). Brand red `#D03020` is unchanged. Dolmar decides whether these shades ship.

| Spot | Nodes | Old | New | Ratio |
| --- | ---: | --- | --- | --- |
| Home step numbers (48px bold on white) | 4 | `#F3F3F3` | `#949494` | 3.03:1 |
| Comparison cells (15px on `#FEF9C2`) | 7 | `#00A63E` | `#008347` | 4.51:1 |
| Footer subtitle on `#D03020` (`/` and `/fleet`) | 2 | `#FAEAE9` | `#FFFFFF` | 5.09:1 |
| Selected fleet chip taglines on `#D03020` | 3 | `#FAEAE9` | `#FFFFFF` | 5.09:1 |

`#949494` is the lightest neutral gray that clears 3:1 on white. The brand caption `#888888` also clears it (3.54:1) and is darker. `#008347` is `oklch(0.534 0.14 155)`, the same hue and chroma as `--success` (`#00884B`, 4.23:1 on the yellow cell, short of 4.5:1), one step darker. The footer and the selected taglines were white at 90% opacity; solid white is the same brand text on the same red. Unselected chip taglines stay at 90% opacity.
