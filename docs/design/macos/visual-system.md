# macOS visual system for Promotion Desk

Status: specification for the redesign batch after 0.8.0 (Copilot Cockpit plan, step "Define the macOS visual system").
Written 2026-11-14 against `main` 6d6e471 (installed build 0.8.0). Recorded as DEC-023 (proposed); it extends DEC-022 and does not replace its principles.

The owner's goal, in English: *"Change the UI so that it is a professional application that looks like a very expensive,
very neat macOS application."*

This document is the contract for the implementation and verification steps. It has:

- the list of all seven sections and their nested screens with the target pattern and the one main action of each (§10);
- the token table (§5), the type scale (§6) and the component table with sizes and states (§7);
- the baseline screenshots of 0.8.0 (`baseline/`) and the target mock (`mock.html`, `target/`) (§2, §3);
- numbered, measurable requirements (§12) and the texts the two QA scenarios depend on (§13).

---

## 1. What stays and what changes

**Stays (DEC-022 and the lessons):** one token layer in `src/renderer/src/styles.css` with the old names as aliases; one
filled (accent) button per screen and it is the next step, never an AI helper; red only for failures, amber for "decide or
fix", neutral for the owner's own choices; the same visible focus ring on every interactive element; motion only for a change
of state and 0 ms under Reduce motion; the launch path Product → Passport → Goal → Channel → Publication with its counts
computed in the renderer; nothing smaller than 13 px (BUG-025); one size for every control, variants change colour only
(lessons 11–13); the page follows the window width, the menu can be hidden (lesson 37); the version, the AI engine and the
automation state are visible in the top band (lesson 85); all texts, accessible names, roles and `data-testid` the QA
scenarios read (§13).

**Changes:** the look moves from a web admin panel to a native macOS document window:

| Today (0.8.0) | Target |
|---|---|
| Solid sidebar, text-only menu, a brand block on top, a full-width "Hide menu" button at the bottom | Translucent sidebar (window vibrancy), one 16 px line icon per item, a section header "Promotion Desk", Log and Settings pinned to the bottom, the sidebar toggle next to the window buttons |
| Web top bar with coloured pills | 52 px unified toolbar band: quiet status on the leading side, automation on the trailing side, no filled button |
| Body 14 px; sizes 13/14/16/19/24/32 | macOS scale: body 13 px; 13/15/17/22/26 |
| Controls 36 px, web-like | 28 px controls (macOS large size), bezel with a hairline and a soft shadow |
| Underline tabs | Segmented control with a raised neutral thumb |
| Bordered cards nested in bordered cards | Group boxes on a neutral page; rows split by inset hairlines; no card inside a card |
| Dashed disabled buttons, dashed empty-state frames | Flat disabled bezel with tertiary label; empty states without a frame |
| Indigo `#4f46e5` / `#7c83ff` accent everywhere | Restrained system indigo `#5856d6` / `#5e5ce6`, used for the one main action, selection, focus, links and sidebar icons only |
| Pointer cursor on buttons | Arrow cursor on controls (macOS); pointer only on text links |

---

## 2. Baseline: 0.8.0 as it is

Captured on 2026-11-14 with `scripts/design/tour.mjs` and `scripts/design/native.mjs` from ONE own instance of the installed
`/Applications/Product Promotion Desk.app` 0.8.0 (own `PPD_DATA_DIR` in the session scratchpad, own debugging port, demo data
with `example.com` names, automation paused, nothing sent). The owner's application and data were not touched. Full set: 72
page shots (7 sections and nested screens × dark/light × 1320×880/980×640) + 4 native window shots; 34 of them are kept in
`baseline/`, with the measurements of all 72 in `baseline/metrics.json`.

| Shot | What it shows |
|---|---|
| `baseline/native-1320-passport.png`, `native-980-passport.png`, `native-980-attention.png` | The real window: window buttons, title band, solid sidebar |
| `baseline/dark-1320-01-attention.png` … `dark-1320-09-menu-hidden.png` (19) | Every section and nested screen, dark, 1320×880 |
| `baseline/light-1320-*.png` (5) | Attention, Passport, Channels, Accounts, Settings in light |
| `baseline/dark-980-*.png` (6), `light-980-03-product-passport.png` | The minimum window |

Findings (measured, not guessed):

1. **Type.** Text nodes use 13 px (2 318), 14 px (2 610), 16 px (262), 19 px (20) and 24 px (72) over 72 screens: body is 14 px,
   five sizes in use. No text under 13 px (BUG-025 holds).
2. **Chrome.** Top bar 53 px + page header about 80 px. At 980×640 the product tabs end at about y = 560 px
   (`native-980-passport.png`): only ~80 px of a tab's content is visible without scrolling.
3. **Filled buttons per screen** (`metrics.json → filledButtons`, dark 1320): Products 2 (New product + the tab's action),
   Channels tab 5 (New product, Connect channel, Activate, Assess channel, Save settings), New account 3 (Add account twice +
   Open browser to sign in), Profiles 4 (incl. a platform toggle shown as primary), Publications 2, Attention 1 per review
   card. The one-main-action rule of DEC-022 is broken mostly by page-header buttons and per-row actions.
4. **Admin-panel cues:** underline tabs; bordered cards inside bordered cards (statement rows, channel rows, engine rows);
   dashed borders for disabled buttons and empty states; coloured pills on every status (product rows carry a pill and a
   coloured dot row and a "Next" line); a full-width "Hide menu" button; 36 px controls; a classic scrollbar track.
5. **Minimum window:** the product list turns into horizontal cards above the detail and the website wraps inside a word
   (`northwind.example.co` / `m/`, `native-980-passport.png`).
6. **What already holds and must keep holding:** no horizontal overflow on any of the 72 screens (document and `.content`),
   no clipped button, nothing interactive under the window buttons, the dark window colour matches `--surface-0`.

---

## 3. Target look

`mock.html` is a static picture of the target built only from the tokens of §5 (open it with `?screen=products`,
`?screen=settings` or `?screen=empty`). `target/` holds its captures in a real Electron window with the window options of §4.1
(vibrancy sidebar, window buttons at the spec position), made with `scripts/design/mock-capture.mjs`:

| Shot | Measured in the window |
|---|---|
| `target/mock-products-dark-1320.png`, `mock-products-light-1320.png` | toolbar items do not overlap; launch path one row; tabs end at y = 262 |
| `target/mock-products-dark-980.png`, `mock-products-light-980.png` | no overlap; path one row; tabs end at y = 292 (baseline ~560); no horizontal scroll |
| `target/mock-settings-*.png` | grouped form, switches, one-line group titles |
| `target/mock-empty-light-1320.png`, `mock-empty-dark-980.png` | empty state with one filled action; disabled header button |

Text sizes in every mock shot: only 13, 15, 17 and 22 px.

The ten principles:

1. **Native frame.** A hidden-inset title bar, the window buttons in a 52 px band, a translucent sidebar, an opaque content column.
2. **Quiet chrome, loud content.** The toolbar and the sidebar carry state in text-2 with small dots; colour is spent in the page.
3. **System typography.** The system font (SF Pro) at 13 px body; hierarchy by weight (400/500/600) and by text-1/2/3, not by many sizes.
4. **Calm surfaces.** A neutral page (`--surface-0`), white or graphite group boxes (`--surface-1`), hairline separators; no shadow on content, shadows only on what floats.
5. **One accent, used sparingly.** System indigo for the one main action, selection in lists, focus, links and sidebar icons.
6. **One control size.** 28 px buttons, fields, pop-up buttons and segmented controls; 13 px labels; radius 8.
7. **Same components everywhere.** Group box, list panel, segmented control, tag, status dot, empty state, menu, sheet: one look each.
8. **Moderate density.** 20 px window gutter, 12–16 px inside groups, 28 px rows in the sidebar and tables, 44 px form rows.
9. **States you can see.** Hover fill, pressed fill, a 2 px focus ring, a raised thumb or a tint for selection, a flat bezel for disabled.
10. **The way through stays visible.** The launch path under the product name and as dots on each product row; empty states name the next step and offer it.

---

## 4. Window and shell

### 4.1 Window (main process, `src/main/index.ts` `createWindow`)

| Option | Today | Target |
|---|---|---|
| `titleBarStyle` | `hiddenInset` | `hiddenInset` (unchanged) |
| `trafficLightPosition` | `{ x: 20, y: 18 }` | `{ x: 20, y: 19 }`: the buttons' vertical centre on the centre of the 52 px band (±1 px) |
| `vibrancy` | none | `'sidebar'`, `visualEffectState: 'followWindow'` |
| `backgroundColor` | `#121418` | `#00000000` (transparent; the material shows behind the sidebar, the content column paints itself) |
| `width/height`, `minWidth/minHeight` | 1320×880, 980×640 | unchanged |

The account browser windows (`src/browser/user-window.ts`) and the menu-bar item are out of scope.

### 4.2 Native or web chrome

`main.tsx` sets `document.documentElement.dataset.chrome = window.ppd ? 'native' : 'web'` before the first render. Under
`[data-chrome='native']` the sidebar background is transparent (vibrancy) and `body` is transparent; under `web` (the local web
access of Settings) and under `@media (prefers-reduced-transparency: reduce)` the sidebar uses the opaque `--sidebar` colour.
The content column (`.main`) always paints `--surface-0`.

### 4.3 Sidebar (`App.tsx`, `.sidebar`)

- Width `--sidebar-w` 224 px; full window height; right edge a 1 px `--line`; drag region except its controls.
- **Band** (top 52 px): the window buttons on the left (drawn by macOS), the sidebar toggle on the right: a 28 px icon button
  (`sidebar.left` glyph), accessible name and tooltip **"Hide menu"** (text unchanged, `data-testid="menu-hide"` kept).
- **Section header**: the brand mark (16 px accent tile with the three rising bars, `data-testid="brand-mark"` kept) and the text
  **"Promotion Desk"** in 13/600 `--text-2`, 28 px row.
- **Items** (`nav-item`, order unchanged): 28 px rows, 10 px side padding, radius 6, gap 8; a 16 px icon in `--accent-on-tint`,
  label 13 px `--text-1`. Hover `--hover-fill`; selected `--selection` (neutral) and weight 500 with `aria-current="page"`
  kept; focus ring (§7). Attention keeps its count capsule on the right (20 px tall, amber with `--on-attention`, red only
  while an item is a failure, BUG-016) and tabular numbers.
- Groups: Attention, Products, Accounts, Opportunities, Publications at the top; **Log and Settings pinned to the bottom**
  (same order of the seven entries).

### 4.4 Toolbar band (`.topbar` → toolbar)

- Height `--toolbar-h` 52 px, `--surface-0` background, 1 px `--line` at the bottom, padding 0 20 px, one line, drag region
  except its controls. No filled button ever lives here.
- **Leading:** the version tag (`v0.8.0`, 22 px capsule in `--segment-track`, tabular numbers, `data-testid="app-version-header"`),
  a 16 px vertical hairline, the group **"AI engine"** (label `--text-2`, status dot, value 13/500 `--text-1`; link to
  Settings when none is selected), a hairline, the group **"Accounts"** (same; link to Accounts). Group accessible names stay
  (`engineGroupName`, `accountsGroupName`).
- **Trailing:** the AI pill while an AI help runs (a toolbar capsule with a progress ring and accent text, never filled), the
  "Background" tag when shown, the automation state (dot + **"Automation paused/running"**, `data-testid="automation-state"`)
  and the toolbar button **"Pause automation" / "Resume automation"** (pill-shaped bezel with a pause/play glyph,
  `data-testid="pause-toggle"`).
- **Narrow rules** (container query on the content column): below 840 px the automation words collapse into the dot's tooltip
  and accessible text (as today, BUG-023); below 720 px the labels "AI engine" and "Accounts" do the same. Measured in the
  mock: no overlap at 980×640.
- **Menu hidden:** the toolbar starts after the window buttons (`--window-buttons-w` 84 px); its first item is the same
  sidebar toggle with accessible name **"Menu"** or **"Menu · N"** (N = attention count, shown as the sidebar's count capsule
  beside the glyph, not as a dot on it: the digits stay 13 px), `data-testid="menu-show"`. Both toggles are `IconButton`s: the
  glyph is decorative and the name is a visually hidden text inside the button, so the accessibility tree keeps a button titled
  "Hide menu" / "Menu · N" exactly as with the old text buttons (read with an AXUIElement dump of the packaged build).

### 4.5 Content column and page header

- `.content` scrolls; padding `--gutter` 20 px, bottom 24 px; native scrollbars (no custom styling, the system setting decides).
- **Page header** (`Page` in `ui.tsx`): h1 22/600, letter-spacing −0.01em; subtitle 13 px `--text-2`, one or two lines;
  page-level create actions on the right as **bezel buttons with a plus glyph** ("New product", "Add account"), never filled.
  Margin below 16 px.
- **Object header** inside a detail pane (product, account): name 17/600, a meta line in `--text-2` (website link, status
  tags), actions on the right (bezel). No card around it.

---

## 5. Tokens

All values live in `:root` (light) and `@media (prefers-color-scheme: dark)` of `styles.css`. Names in **bold** are new; the
others keep their DEC-022 names with new values. Contrast ratios are computed (WCAG formula) for the pairs that carry text, over the
background the text really sits on: a translucent fill (`--hover-fill` stripe, `--segment-track` tag, `--accent-tint`) is stacked on
its card first, so a figure for a token pair alone is not enough (BUG-049, lesson 114).

### 5.1 Colour

| Token | Light | Dark | Role |
|---|---|---|---|
| `--surface-0` | `#f5f5f7` | `#1e1e20` | Page and toolbar background (window colour) |
| `--surface-1` | `#ffffff` | `#28282b` | Group boxes, list panels |
| `--surface-2` | `#f0f0f2` | `#313135` | Wells (read-only text, previews, code) |
| `--surface-3` | `#ffffff` | `#2c2c2f` | Menus, popovers, sheets (with `--shadow-pop`) |
| **`--sidebar-solid`** | `#e8e8ed` | `#252528` | The opaque sidebar colour |
| **`--sidebar`** | `var(--sidebar-solid)` | `var(--sidebar-solid)` | What `.sidebar` paints: opaque (web mode, Reduce transparency); `transparent` under `html[data-chrome='native']` |
| **`--field`** | `#ffffff` | `#323236` | Text fields, text areas, pop-up buttons |
| **`--field-border`** | `#a8a8ae` | `#636369` | Field edge (2.4:1 / 2.1:1 against its surroundings; a native-looking edge, the focus ring carries 3:1+) |
| **`--bezel`** | `#ffffff` | `#3a3a3e` | Push-button face |
| `--line` | `#e3e3e8` | `#38383c` | Separators, group borders |
| `--line-strong` | `#c7c7cc` | `#4b4b50` | Bezel edges, switch track off |
| `--text-1` | `#1d1d1f` | `#f2f2f7` | Primary text (15.5:1 / 14.9:1 on surface-0) |
| `--text-2` | `#5f5f64` | `#b4b4ba` | Secondary text. On a plain surface (surface-0/1/2/3, field) ≥ 5.2:1 light and ≥ 6.1:1 dark; on the stacks of fills that occur (tag, table stripe, selected row, tab track) ≥ 5.1:1 light and ≥ 4.78:1 dark, the lowest being the neutral tag over a striped table row (dark `#434346`: card + stripe + tag) |
| `--text-3` | `#6c6c71` | `#9e9ea4` | Disabled labels and values, placeholders (≥ 4.59:1 light and ≥ 4.79:1 dark on surface-0/1/2/3 and field; the lowest are the disabled value on surface-2 and the placeholder on field). Not for text on a tag, a hovered row or a selected row |
| `--accent` | `#5856d6` | `#5e5ce6` | Filled main action, switch on, brand tile |
| `--on-accent` | `#ffffff` | `#ffffff` | Label on the accent (5.65:1 / 5.06:1) |
| `--accent-tint` | `rgb(88 86 214 / 12%)` | `rgb(94 92 230 / 26%)` | Selected list row, pressed toggle, "Next" capsule |
| `--accent-on-tint` | `#4e4cc8` | `#a5a3ff` | Accent text: links, sidebar icons, quiet buttons, text on the tint (≥ 5.1:1 on the tint over `--surface-0`; `#5856d6` gave 4.41:1 there, measured on the packaged build) |
| `--focus` | `#5856d6` | `#a5a3ff` | Focus ring (≥ 5.2:1 against surface-0 and surface-1) |
| **`--selection`** | `rgb(0 0 0 / 7%)` | `rgb(255 255 255 / 10%)` | Neutral selection (sidebar item) |
| `--hover-fill` | `rgb(0 0 0 / 4.5%)` | `rgb(255 255 255 / 6%)` | Hover on rows, sidebar items, toolbar and quiet buttons |
| **`--press-fill`** | `rgb(0 0 0 / 9%)` | `rgb(255 255 255 / 12%)` | Pressed (`:active`) |
| **`--segment-track`** | `rgb(0 0 0 / 5.5%)` | `rgb(255 255 255 / 7%)` | Segmented track, neutral tag, version tag |
| **`--segment-thumb`** | `#ffffff` | `#545458` | Selected segment |
| **`--bezel-hover`**, **`--bezel-press`** | bezel mixed with 5 % / 10 % `--text-1` | same rule | Face of a bezel button on hover and press (made from the tokens, so a theme changes them with the rest) |
| **`--accent-hover`**, **`--accent-press`** | accent mixed with 8 % `--on-accent` / 8 % black | same rule | Face of the filled button on hover and press |
| **`--scrim`** | `rgb(0 0 0 / 20%)` | `rgb(0 0 0 / 40%)` | Veil behind a sheet |
| **`--glyph-updown`** | up/down chevron, stroke `--text-2` | stroke `--text-2` | Background glyph of a pop-up button (a CSS background cannot take `currentColor`, so each theme has its own) |
| `--success` / `--success-bg` | `#17733f` / `#e3f5eb` | `#5fd39a` / `#173326` | Done, healthy (5.20:1 / 7.33:1) |
| `--attention` / `--attention-bg` | `#8a5c00` / `#fdf1d6` | `#f2c14e` / `#3a2f12` | Needs a decision (5.19:1 / 7.84:1) |
| `--on-attention` | `#ffffff` | `#241a00` | Count capsule label (5.81:1 / 10.2:1) |
| `--error` / `--error-bg` | `#b42318` / `#fde8e6` | `#ff8a80` / `#3d1b19` | Failures only (5.59:1 / 6.72:1) |
| `--info` / `--info-bg` | `#2457c5` / `#e5edfd` | `#8ab0ff` / `#172544` | Neutral information (5.51:1 / 7.03:1) |

Light `--success` and `--attention` are darker than in 0.8.0 (`#1a7f4b`, `#9a6700` gave 4.43:1 and 4.34:1 on their
backgrounds). The dark window colour changes from `#121418` to `#1e1e20`.

### 5.2 Elevation, shape, space, size, motion

| Token | Value | Use |
|---|---|---|
| **`--shadow-control`** | light `0 0.5px 1px rgb(0 0 0 / 12%)`; dark `0 0.5px 1px rgb(0 0 0 / 40%), inset 0 0.5px 0 rgb(255 255 255 / 8%)` | Bezel buttons |
| **`--shadow-thumb`** | light `0 1px 2px rgb(0 0 0 / 14%), 0 0 0 0.5px rgb(0 0 0 / 6%)`; dark `0 1px 2px rgb(0 0 0 / 40%)` | Segmented thumb, switch knob |
| `--shadow-pop` | light `0 0 0 0.5px rgb(0 0 0 / 12%), 0 10px 30px rgb(0 0 0 / 16%), 0 2px 6px rgb(0 0 0 / 8%)`; dark `0 0 0 0.5px rgb(255 255 255 / 10%), 0 12px 32px rgb(0 0 0 / 50%)` | Menus, popovers, sheets |
| `--focus-ring` | `outline: 2px solid var(--focus); outline-offset: 1px` | Every interactive element (`:focus-visible`) |
| `--radius-sm` / `-md` / `-lg` / `-pill` | 6 / 8 / 12 / 999 px | Sidebar items, segments / controls, list rows / group boxes, menus, sheets / tags, toolbar buttons |
| `--radius` (alias) | `var(--radius-lg)` | Old name |
| `--space-1` … `--space-7` | 4, 8, 12, 16, 24, 32, 48 px | Unchanged 4 px grid |
| **`--gutter`** | 20 px | Window margin of the content column (macOS standard) |
| `--control-h` | 28 px (was 36) | Buttons, fields, pop-up buttons, segmented control, toolbar buttons |
| `--control-radius` | `var(--radius-md)` 8 px | Controls |
| `--control-pad-x` | 12 px (was 14) | Controls |
| `--control-min-w` | 72 px (was 88) | Buttons with a label |
| **`--toolbar-h`** | 52 px (`--titlebar-h` stays as an alias) | Toolbar band, sidebar band |
| **`--sidebar-w`** | 224 px (was 216 inline in `.shell`) | Sidebar |
| **`--row-h`** | 28 px | Sidebar items, table rows, menu items without a note |
| `--window-buttons-w` | 84 px (was 100) | Toolbar start when the menu is hidden |
| `--dur-fast` / `--dur-base`, `--ease-out` | 120 / 180 ms, `cubic-bezier(0.2, 0.8, 0.2, 1)`; 0 ms under Reduce motion | Unchanged |
| **`--dur-spin`** | 900 ms; 0 ms under Reduce motion | The turn of the busy ring in the AI capsule (the only looping motion) |
| **`--icon-gap`** | 6 px | The one half step off the 4 px grid: between a glyph and its label |

---

## 6. Typography

Font stack `-apple-system, BlinkMacSystemFont, system-ui, 'Helvetica Neue', sans-serif` (SF Pro on macOS); monospace
`ui-monospace, 'SF Mono', Menlo, monospace` only for paths, addresses, ids and secrets. `-webkit-font-smoothing: antialiased`.
Numbers in counts, versions, times and tables use `font-variant-numeric: tabular-nums`.

| Token | Size / line | Weight | Use (macOS name) |
|---|---|---|---|
| `--fs-body` | 13 / 19 px (`--lh-prose` 1.45) | 400 | Body, labels, rows, buttons (500), table cells (Body) |
| `--fs-caption` | 13 / 19 px | 400 | Hints, meta lines, table headers (600), in `--text-2` (nothing smaller, BUG-025) |
| `--fs-title` | 15 / 19 px (`--lh-title` 1.25) | 600 | Group box titles, dialog titles, empty-state titles (Title 3) |
| `--fs-section` | 17 / 21 px | 600 | Object names in a detail pane, page sections (Title 2) |
| `--fs-page` | 22 / 28 px | 600, −0.01em | Page title h1 (Title 1) |
| `--fs-display` | 26 / 32 px | 600, −0.01em | "Getting started" headline only (Large Title) |

Weights: 400 text, 500 buttons, selected sidebar item, segment labels and toolbar values, 600 titles and table headers.

---

## 7. Components

Every control is `--control-h` tall, 13 px, weight 500 for labels; variants change colour only; a button never shrinks or
wraps (lessons 11–13). Cursor: arrow on controls, rows and tabs; pointer only on text links. States: **rest / hover / pressed
/ focus-visible / selected / disabled**.

| Component (file) | Shape and size | Rest | Hover / pressed | Selected / on | Disabled |
|---|---|---|---|---|---|
| **Button, default bezel** (`Button` ghost, `ui.tsx`) | 28 px, radius 8, pad 12, min 72 | `--bezel`, 0.5 px `--line-strong`, `--shadow-control`, `--text-1` | bezel + 5 % text colour / + 10 % | — | no shadow, transparent, `--line` edge, `--text-3` label; the reason beside it as a Hint |
| **Button, primary** (the one main action) | same | `--accent`, `--on-accent` | accent + 8 % white / − 8 % | — | same as a disabled bezel (neutral), reason beside it |
| **Button, secondary** (helpers, AI ideas, approving one item; the same action on a non-first review card) | same | bezel with `--accent-on-tint` label | as bezel | — | as bezel |
| **Button, danger** | same | bezel with `--error` label | as bezel | — | as bezel |
| **Button, quiet** (third actions, "Add statement") | 28 px, no frame, pad 8, min 0 | `--accent-on-tint` or `--text-2` | `--hover-fill` / `--press-fill` | — | `--text-3` |
| **Toolbar button** | 28 px, radius pill, optional 16 px glyph | as bezel | as bezel | — | as bezel |
| **Icon button** (sidebar toggle, row "more") | 28 × 28, radius 6, 16 px glyph | transparent, `--text-2` | `--hover-fill` + `--text-1` / `--press-fill` | — | `--text-3` |
| **Text field / text area** (`.input`) | 28 px (area ≥ 64 px), radius 8, pad 10 | `--field`, 1 px `--field-border` | edge `--text-3` | focus ring | `--surface-2` fill, `--text-3` |
| **Pop-up button** (`select.input`) | as field, `appearance: none`, an up/down chevron glyph at 10 px from the right | as field | as field | — | as field |
| **Checkbox / radio** | 16 px, whole row clickable (≥ 28 px) | system, `accent-color: var(--accent)` | — | accent | system |
| **Switch** (`Switch`) | track 32 × 18, knob 14 with `--shadow-thumb` | track `--line-strong` | — | track `--accent` | 50 % opacity |
| **Segmented control** (`SegmentedControl`, all `.tabs`, Opportunities filters, Profiles platform toggles) | track `--segment-track`, radius 8, pad 2, segments 24 px, pad 12, radius 6 | labels `--text-2` | label `--text-1` + `--hover-fill` | thumb `--segment-thumb`, `--shadow-thumb`, label `--text-1` | `--text-3` |
| **Tag** (`Badge`) | 22 px capsule, pad 8, 13 px | neutral `--segment-track`/`--text-2`; good/warn/bad/info: `*-bg` + colour | — | — | — |
| **Status dot** (`.dot`) | 8 px circle | `--text-3`, good, warn, bad | — | — | — |
| **Count** (sidebar) | 20 px capsule, min 20, 13/600, tabular | `--attention` + `--on-attention`; `--error` + `--on-error` | — | — | — |
| **Group box** (`Card` → group) | `--surface-1`, 1 px `--line`, radius 12; head pad 12/16, title 15/600 one line; body pad 8/16/12 | — | — | — | — |
| **Group row** | min 44 px, label left (title + `--text-2` line), control right, inset hairline between rows | — | row hover only when the row itself is clickable | — | — |
| **List panel + row** (product list, account list, profile list, channel list) | panel `--surface-1`, radius 12, pad 6; row radius 8, pad 8/10; title 13/600 one line with ellipsis, up to two `--text-2` lines | — | `--hover-fill` / `--press-fill` | `--accent-tint`, `aria-current` or `aria-selected` | — |
| **Table** (`table.table`) | header 13/600 `--text-2`, rows ≥ 28 px, pad 6/12, zebra rows `--hover-fill` on even rows, long text wraps (never sideways) | — | — | — | — |
| **Disclosure / More** | chevron 12 px rotating 90° in `--dur-base`; summary ≥ 28 px; Disclosure 13/600 `--text-1`, More 13 px `--accent-on-tint` | — | `--hover-fill` | open | — |
| **Note** (`.note`) | radius 8, pad 12, 16 px glyph in the tone, no side bar; info/warn/good on `*-bg` with `--text-1` text | — | — | — | — |
| **Error note** | as Note in `--error-bg`, glyph and first words in `--error` | — | — | — | — |
| **Empty state** (`EmptyState`) | no frame; centred; 40 px line drawing in `--text-3`; title 15/600; one sentence in `--text-2`, max 46ch; one action (filled only if it is the screen's main action) | — | — | — | — |
| **Menu** (`RowMenu`, `MenuItem`) | `--surface-3`, radius 12, pad 6, `--shadow-pop`; items radius 6, 28 px (more with a note line) | `--text-1`, note `--text-2` | **accent fill with `--on-accent` text** (macOS menu highlight) | — | `--text-3` |
| **Sheet** (`AgentQuestionDialog`, `.modal`) | 480 px, radius 12, pad 20, `--surface-3`, `--shadow-pop`; backdrop `rgb(0 0 0 / 20%)` light, `40%` dark; actions right-aligned, the filled one last | — | — | — | — |
| **Confirmation** (`ConfirmAction`, `ConfirmBar`; BUG-059) | in the place of the pressed button: a 13 px `--text-1` question that wraps, a danger bezel with the verb, and "Cancel"; no box, no dialog, no system sheet | the removal button | as bezel; focus starts on "Cancel", Escape cancels | — | as bezel |
| **Launch path** (`LaunchPath`) | stages 28 px pills, 14 px marks, joints 18 px (10 px in a detail pane under 560 px), "Next" capsule 20 px | stage `--text-2` | `--hover-fill` | done: green check + `--text-1`; current: accent ring + `--accent-tint` halo, 600 | — |
| **Launch dots** (product rows) | five 7 px circles, gap 3 | `--line-strong` ring | — | done green; current accent ring | — |
| **Focus ring** | `outline: 2px solid var(--focus); outline-offset: 1px`, follows the radius | on every `a[href]`, button, summary, field, tab, segment (via `:has(:focus-visible)`), switch, list row | | | |

Implementation notes (step "shell and shared components"): the segmented track is 28 px and its segments 24 px, so the sweep measures the
track, not the segment; a switch has its label on the left and the switch on the right (the DOM order stays input, track, text); a menu
entry under the pointer or the keyboard is the accent with `--on-accent` text, danger entries included; sheet actions are Stop the AI
(danger), Show the browser, I’m done (filled, last); the AI capsule is a toolbar bezel with an accent label and a ring that turns at
`--dur-spin`; toolbar items that carry a tooltip (version, automation state) are no-drag so the pointer reaches them.

Motion: background, border and colour transitions in `--dur-fast`; disclosure chevrons, menus, popovers and the sheet fade/slide
4 px in `--dur-base`; all 0 ms under Reduce motion. No other animation.

---

## 8. Icons

- One component `Icon` in a new `src/renderer/src/icons.tsx` with a fixed set of inline SVG glyphs, drawn for this app in the
  SF Symbols manner: 16 × 16 view box, 1.5 px stroke in `currentColor`, round caps and joins, no fill (except tiny dots).
  **No icon library** (no new dependency; SF Symbols are not embedded). The set is in `mock.html` (`<symbol id="i-…">`).
- Navigation: Attention = bell, Products = box, Accounts = person in a circle, Opportunities = speech bubble, Publications =
  paper plane, Log = bulleted list, Settings = gear. Chrome and actions: sidebar.left, plus, play, pause, chevron right, chevron
  down, up/down chevrons (pop-up button), checkmark, xmark, ellipsis, info, warning triangle, sparkles (AI).
- All glyphs share the same box and optical weight; in the sidebar they sit at the same x (left padding 10 px) and are
  vertically centred on the 28 px row.
- The empty-state drawings (`empty-art.tsx`) stay, recoloured to `--text-3` and sized 40 px.
- Text glyphs used as icons ("✓", "→", "×", "+ " in labels) are replaced by `Icon` where they stand for an icon; the
  accessible text stays the same (e.g. "+ Add statement" keeps the accessible name "Add statement to {Section}").

---

## 9. Layout patterns

| Pattern | Where | Rules |
|---|---|---|
| **List + detail** | Products, Accounts, Profiles | Columns `clamp(208px, 27%, 300px)` and `minmax(0, 1fr)`, gap 16; **side by side down to 980×640 with the menu shown** (no stacked cards); list panel sticky; rows one-line titles with ellipsis; the detail is a container (`container-type: inline-size`) for its own narrow rules |
| **Detail pane** | product, account, channel | Object header (§4.5) → launch path (product only) → segmented tabs → group boxes; at 980×640 the tab row ends at y ≤ 300 px |
| **Group-box form** | Settings, account steps, channel settings, goal cards, create/edit forms | Group box per topic; label-left rows for switches and short values; label-above fields in `.form-row` grids for text (labels top-aligned, lesson 25); the open form owns the filled button |
| **Review list** | Attention, Opportunities, Publications | One group box per item: head row (tags, channel, time), body (thread / draft fields), actions right-aligned at the bottom; the main action is filled only on the first item, the same action is `secondary` on the others |
| **Table** | Log tabs, Results metrics, channel capability | Full width inside a group box; zebra; wrap long text; no sideways scroll |
| **Empty state** | every list and page | §7; in the free height of its column (`fill`) |
| **Getting started** | Attention, first run | Group box with eyebrow, 26 px headline that names the newest product ("Launch Northwind Notes", "Launch your first product" while there is none; a long name wraps inside the card), the launch path, one filled button for the next step, the step list |

---

## 10. Screens: all seven sections and their nested screens

"Filled" names the one main action of the screen in the target (the next step); everything else is bezel, secondary or quiet.
Texts are the current ones and do not change.

### 10.1 Attention (`#/attention`, `pages/Attention.tsx`)

| Screen / state | Target pattern | Filled | Empty state → next step |
|---|---|---|---|
| Getting started (a launch step open) | Getting-started group box | the next step: "Add a product", then the newest product's next stage of the launch path ("Build the passport" / "Write a goal" / "Connect a channel", `startSteps`), then "Connect an account" / "Resume automation" | — |
| All done | Empty state | none (only "Open Opportunities" bezel) | "Nothing needs you right now" → "Open Opportunities" |
| Connections and accounts | Group box, one row per problem: tag, title, product line, fix button on the right | none (fix buttons bezel) | — |
| Needs your decision | Review list | "Approve" of the first card | — |

### 10.2 Products (`#/products/<id>/<tab>`, `pages/Products.tsx`)

| Screen / state | Target pattern | Filled | Empty state → next step |
|---|---|---|---|
| No products | Page header + empty state | "Add your first product" ("New product" is bezel) | "No products yet" → "Add your first product" |
| New product form (`CreateProduct`) | Group box form at the top of the page | "Create product" | — |
| List + detail | List + detail; product rows: name + launch dots, the website's host (full address and full name in the tooltip) or "No website yet", "Next: …" (the next stage of the launch path in the words of its action: "Next: build the passport", "write a goal", "connect a channel", "write a publication" / "approve a draft"; §11) | per tab | — |
| Product header (`ProductHeader`), Edit details form | Object header; edit form as a group box | "Save" while editing | — |
| Launch path + tabs | Stepper + segmented control (Sources, Passport, Analysis, Goal, Channels, Results) | — | — |
| Sources (`SourcesTab`, `AddSource`, `SourcePreviewPanel`) | "Add a source" group box (kind as segmented control), "Sources" group box with rows (Edit/Remove on the right), preview as a well | "Add source" while the product has no source, afterwards the link to the next stage (§11); "Save" while an inline edit is open | "No sources yet" → the add form |
| Passport, empty | Group box with the lead line, the Sections checklist, Versions | "Open Analysis" ("Approve passport" bezel, disabled with its reason) | "No passport yet." → "Open Analysis" |
| Passport with statements (`ClaimRow`, `ClaimForm`) | "Product passport" group box (version line, Approve all / Approve passport); one group box per section with statement rows (tags, text, source line; Approve secondary, Edit, More menu) | "Approve passport" (when allowed) while the passport is the next stage, afterwards the link to the next stage (§11); "Add"/"Save" of an open form | per section: "nothing here yet" + quiet "Add statement" |
| Analysis | Group box with steps and progress | "Start analysis" / "Resume analysis" / "Run again" while the passport is the next stage, afterwards the link to the next stage (§11) | "No AI engine is selected." → link to Settings |
| Goal | One group box per goal; saved goal compact (Edit, quiet Remove, "Show on Results") | "Add goal" / "Save goal" of the open form; the lone first-goal form while Goal is the next stage, otherwise the link to the next stage (§11) | "Add a goal" |
| Channels (`ChannelsPanel` and `channels/*`) | Accounts strip (group box), "Connect a channel" group box, channel list panel + channel detail group boxes (status, capability, plan, mode, settings), "Ideas from the AI" disclosure | exactly one, by setup stage, while Channel is the path's next stage: "Add an account" (no account) → "Connect channel"; once a channel is connected "Assess channel" and "Activate" are bezels (they stay available) and the link to the next stage is filled (§11); "Save settings" only while the settings form has changes | "No channels yet" → "Connect your first channel above." |
| Results | Group boxes: goals, metrics table, conversions note | "Connect a channel" when there is no channel and Channel is the path's next stage; otherwise the link to the next stage, or none when the path is complete ("Refresh all" bezel) | "No channels for this product yet" → "Connect a channel" |

### 10.3 Accounts (`#/accounts`, `#/accounts/new`, `pages/Accounts.tsx`)

| Screen / state | Target pattern | Filled | Empty state → next step |
|---|---|---|---|
| Tabs Accounts / Profiles / Mailboxes | Segmented control under the page header | — | — |
| No accounts / New account (`CreateAccount`) | Group-box form | "Add account" in the form (the header "Add account" is bezel) | the form itself |
| List + detail (`AccountDetail`) | List + detail; detail = object header, "Next:" note, numbered step group boxes 1 Role, 2 Profile, 3 E-mail, 4 Password, [Browser: an unnumbered setting, §20], 5 Sign-in (a login that signs in through another account has 3 Signs in with and 4 Sign-in, §20) (the number sits in a 24 px column, `--step-gutter`; everything below a step's head, in every step, is indented to start under its title), "More" disclosure | the next step only (from `next-step.ts`); other step buttons bezel | — |
| Profiles (`ProfilesPanel`, `ProfileDetail`, `ProfileAccounts`) | List + detail; "New profile" above the list as a bezel button with a plus glyph; platform toggles as a toggle group (pressed = tint, not filled) | "Make the profile" / "Propose a profile" / "Approve" / "Make an account" — one at a time by stage | no profile: the new-profile form opens by itself (as today); "Select a profile" when none is picked |
| Mailboxes (`MailboxesCard`) | Group box with rows + add field | "Add mailbox" | today a sentence only; target: the sentence and the add field as the next step |

### 10.4 Opportunities (`#/opportunities`)

| Screen / state | Target pattern | Filled | Empty state → next step |
|---|---|---|---|
| Filters + Check now | Segmented filter (selected = raised thumb), "Check now" bezel | — | — |
| Items | Review list (`ReviewCard`, `ThreadView`, `DraftEditor`, `ReviewButtons`, `ScheduleControl`, `ResolveUnknown`) | main action of the first card | "Nothing here" → "Connect a channel" (no channel) / "No items match this filter." |
| Older discussions | Disclosure + rows | — | "No discussions recorded yet" |

### 10.5 Publications (`#/publications/<productId>`)

| Screen / state | Target pattern | Filled | Empty state → next step |
|---|---|---|---|
| Toolbar (product filter, "Suggest with AI", "Write one myself") | Pop-up button + bezel/secondary buttons (an AI helper is never filled); while the empty state below offers "Write one myself" the toolbar leaves its own out, so one button of that name is on screen (BUG-057) | — | — |
| New publication (`PublicationForm`) | Group-box form | "Save as draft" | — |
| Drafts, approved and scheduled; Sent; Rejected | Review list + row lists | main action of the first draft | "No channels yet" → "Connect a channel"; "No drafts" ("Ask the AI for a suggestion or write one yourself.") → "Write one myself", filled, as its action (`write-publication-empty`; the toolbar's `write-publication` is not drawn while it shows) |
| Posting not available | Note (warn) | — | — |

### 10.6 Log (`#/logs`)

| Screen / state | Target pattern | Filled | Empty state → next step |
|---|---|---|---|
| Tabs Runs / Action history / Events | Segmented control; each tab a table in a group box | none | "No runs yet", "Nothing has been sent yet", "No events" + their sentences (records appear by themselves: no action needed) |

In the three tables a cell is `log-fit` or `log-text` (`logs.css`, BUG-045). `log-fit` is a value that is never broken: the time
(Events Time, Runs Started, History When), a source, a kind; it stays on one line and the table gives it its width. `log-text` is
free text, a name or an address (Message, Result, What was sent, Where, Channel, On what basis): it wraps at word boundaries,
a long address breaks at any character, and a short word (up to 14 characters) is never split by a squeezed column. Measured
at 1320×880 and 980×640 in both themes with long messages and a long channel address: no time wrapped, no source or kind word
split, no sideways scroll.

### 10.7 Settings (`#/settings`)

| Screen / state | Target pattern | Filled | Empty state → next step |
|---|---|---|---|
| AI engine | Group box; one row per engine (name, version, tags, two `--text-2` lines, Details disclosure; "In use" check or "Use this engine") | "Use this engine" only when recommended and none is selected | "No AI engines found" |
| Notifications, local web access | Group boxes with label-left rows and switches; Port field (1024–65535, applied on blur or Enter; a refused port shows its reason under the label in `--error` and the switch stays off, BUG-044) | none | — |
| What the AI learned (`LessonsCard`) | Group box: add row (field + pop-up + "Add the rule" secondary), saved rules as rows | none | "Nothing learned yet." |
| About | Group box of label/value rows | none | — |

### 10.8 Global overlays

| Overlay | Target |
|---|---|
| AI pill and its panel (`AiProgress.tsx`) | Toolbar capsule (progress ring, accent text); panel = popover on `--surface-3` with `--shadow-pop`; lines in 13 px interface font; Stop as bezel |
| Agent question (`AgentQuestionDialog`) | Sheet (§7); "I’m done" filled, "Stop the AI" danger bezel |
| Row menu (`RowMenu`) | Menu (§7) |

---

## 11. Launch path

Kept exactly as DEC-022 decides (stages, counts, links, "approved publication" meaning); only the look changes: stepper of
§7 under the object header, the five dots on each product row, and the getting-started block on Attention. At 980×640 with the
menu shown the stepper stays on one row (mock: `pathRows: 1`).

**One next step (BUG-064).** The launch path is the single source of "what next". `launchStages` gives every stage its state and the
words of its button (`action`: "Add a source", "Build the passport", "Write a goal", "Connect a channel", "Write a publication" or
"Approve a draft"), and `nextStage` is the first stage that is not done. The "Next: …" row of a product in the list is that stage's
action in lower case ("Next: build the passport"; `nextProductStep`), with no rule of its own, so the row, the path above the tabs
and the "Next" tag cannot name different steps. The passport stage reads "Build and approve the passport." because the passport is
built by the AI from the sources or by hand and then approved; the row does not know a hand-built draft (that would need a field
in `products.list`), so it keeps saying "build the passport" until the passport is approved.

**One filled button per product tab (BUG-065).** The tab of the path's next stage keeps its own filled action (`tabAccent`: Sources is
Product, Passport and Analysis are Passport, Goal is Goal, Channels and Results are Channel). Every other tab, one whose stage is done
(a finished Sources or Passport tab) as well as one the path has not reached, draws its own actions as bezels, so no disabled filled
"Add source" or "Approve passport" holds the main slot, and shows `NextStage` under the tab row: one filled link-button in the words of
the next stage's action ("Write a goal", "Connect a channel"), with "Next on the launch path: Goal" beside it. While the passport is the
next stage the words beside the link are "or add statements yourself" (the Passport tab: the route that needs no AI is said in the open,
BUG-064). That link is not in the Status row of the header: beside "Open Analysis" it wraps the row at 980×640 with the menu shown and
pushes the tab row from 308 to 335 px (V-18). The link takes the variant of a resting main action, so it also steps back while an
on-demand form is open. On Channels with a connected channel "Assess channel"
(and its reason, BUG-055) and "Activate" stay available as bezels. Once every stage is done no tab is filled. A saved goal keeps its
"Goal saved. It now appears on the Results tab." note with "Show on Results" as a bezel; the filled "Connect a channel" is the link above it.

**Getting started takes the same step (BUG-058).** `startSteps` puts the newest product's next stage, while it is Product, Passport, Goal
or Channel, right after "Add a product" and ahead of "Connect an account" and "Resume automation", with the stage's action as its title and
button and its `todo` as the hint. The first open step is then the stage that carries the path's "Next" tag and the stage the filled button
names. Publication is not a setup step: a path that has reached it leaves the checklist to the account and the automation. The headline
names the product ("Launch Northwind Notes"; with two products of one name, the label of BUG-054).

---

## 12. Verifiable requirements

Measured on the packaged build of the branch with `scripts/design/tour.mjs` (72 screens: dark/light × 1320×880/980×640) and
`scripts/design/native.mjs`, plus the targeted checks named in the method column. "Every screen" means every route of the tour.

| Id | Requirement | Method | Pass |
|---|---|---|---|
| V-01 | Window: hidden-inset title, vibrancy sidebar, transparent window colour, min size 980×640 | read `createWindow`; native capture | as §4.1 |
| V-02 | Window buttons centred on the 52 px band and nothing interactive under them | native capture: centre y of the red button ±1 px of 26 px (measured 25.6); tour `underLights` (x < 84; the buttons end near x = 79) | empty on every screen |
| V-03 | Window drag works on the sidebar band and the toolbar; the toggle, links and buttons inside them are no-drag | computed `-webkit-app-region`; drag the window by the toolbar in the native window | drag moves the window; every control clicks |
| V-04 | Sidebar: 7 items in today's order, each with one 16×16 icon at the same x; Log and Settings at the bottom; neutral selection with `aria-current`; "Promotion Desk" visible; hide/show works and keeps the route | DOM read + click | all true, both themes |
| V-05 | Toolbar 52 px, one line, no overlap of its items at 1320 and 980 wide, with the menu shown and hidden; version, AI engine and Accounts groups and the automation toggle present | bounding boxes of `.topbar` children | no overlap; heights 52 |
| V-06 | No horizontal overflow of the document or `.content`; no clipped or cut button; no button wrapped to two lines | tour `hOverflow`, `cutButtons`, `tallButtons` (textareas excluded) | 0 on every screen |
| V-07 | Text sizes only 13, 15, 17, 22, 26 px; nothing under 13 px; body 13 px | tour `fontSizes` | set ⊆ {13,15,17,22,26} on every screen |
| V-08 | Font is the system font | computed `font-family` of `body` starts with `-apple-system` | true |
| V-09 | Every button, field and pop-up button 28 px tall (text areas excluded); segmented control 28 px; labels 13 px | measure all controls on every screen | 100 % |
| V-10 | At most one filled (`.btn-primary`) button visible per screen, none in the toolbar or sidebar, and it is never an optional AI helper ("Suggest with AI", "Draft with AI", "Let the AI …"); the step's own next action stays filled even when the AI carries it out ("Propose a profile", "Assess channel", "Start analysis"); with several on-demand forms open, the one opened last owns it and the others show their submit as a bezel; on a product tab the launch path decides (§11): the tab of the path's next stage keeps its own filled action, every other tab shows its actions as bezels and one filled link to that stage | tour `filledButtons` | ≤ 1 everywhere; = 1 where §10 names one |
| V-11 | Tokens: no hex or `rgb()` colour and no px font size outside the token block in `styles.css`, `products.css`, `channels.css` and the renderer `.tsx` files; no inline `style` setting colour or font size | grep | 0 hits |
| V-12 | Contrast in both themes, over each text's real stacked background (every translucent fill composited: card, table stripe, tag, tab track, selected row): text-1/text-2 ≥ 4.5:1 on surface-0/1/2/3 and field and on a tag over a striped row (dark `#b4b4ba` on `#434346` = 4.78:1); text-3 ≥ 4.5:1 on surface-0/1/2/3 and field (dark: placeholder 4.79:1, disabled value 4.86:1; light 4.59:1 on surface-2); on-accent on accent ≥ 4.5:1; every tag colour on its background ≥ 4.5:1; focus ring ≥ 3:1 against its surroundings | every text node, input value and placeholder of the rendered page (not the source) against its composited ancestors, both themes, 1320×880 and 980×640, every route of the tour | none under 4.5:1 (6 910 text nodes in the BUG-049 pass) |
| V-13 | Themes: every screen renders fully in light and in dark with no mix (native selects and scrollbars follow `color-scheme`) | tour in both themes; native capture after switching macOS appearance | no element keeps the other theme's colours |
| V-14 | Hover changes the background of every button variant, sidebar item, segment, list row, menu item and disclosure, without changing the label colour of primary and danger (lesson 112) | CDP hover on each variant, computed colours before/after, both themes | all change; labels kept |
| V-15 | Focus: Tab reaches every control; each shows the 2 px `--focus` ring | Tab through Products, Accounts, Settings; computed outline | 100 % |
| V-16 | Disabled differs from enabled at a glance (no shadow, not faded, `--text-3` label, `--line` edge) and stays ≥ 4.5:1 on its own fill: a button label on surface-0/1, a field or pop-up value on `--surface-2` (the browser's own 70 % fade of a disabled pop-up button is switched off: it gave 2.7:1); its reason is visible beside it: a sentence next to the button, or, for a button that sits beside its own empty field ("Add" an image, "Schedule"), that field | computed styles of disabled vs enabled of each variant | distinct; reason present |
| V-17 | Reduce motion: every `transition-duration` and `animation-duration` is 0 s; Reduce transparency: the sidebar is opaque `--sidebar` | `Emulation.setEmulatedMedia` for both features | true |
| V-18 | Products at 980×640 with the menu shown: list and detail side by side, the tab row ends at y ≤ 310 px (measured 308 with a product that has a website, a description and a status row; the first guess of 300 was not reachable without dropping the status row), the launch path is one row, no word broken inside a URL | DOM measure on the Passport tab | all true |
| V-19 | Launch path visible under the product header, as dots on every product row, and on the first-run Attention; counts unchanged | DOM read; existing launch-path unit tests | true |
| V-20 | Every empty state of §10 has a title, one sentence and the named next-step action (or says none is needed) | tour on a fresh data folder and on the seeded one | 100 % |
| V-21 | QA-bound texts, accessible names, roles and `data-testid` of §13 unchanged. Decided exceptions after the QA walk: the send button of an edited draft reads "Save, approve and send" (was "Save and approve and send", BUG-057); the toolbar's "Write one myself" is not drawn while the empty list offers its own (BUG-057); the row of a product with no approved passport reads "Next: build the passport" (was "Next: run the analysis" / "Next: approve the passport", BUG-064); the Getting started headline names the newest product ("Launch Northwind Notes", was "Launch your first product") and its checklist puts that product's next launch-path stage between "Add a product" and "Connect an account" (BUG-058) | `grep` of each string in the renderer + both QA scenarios run | all found; scenarios pass |
| V-22 | No new runtime or dev dependency; icons are local SVG | `git diff main -- package.json package-lock.json` | no dependency change |
| V-23 | Web mode (`PPD_WEB_MODE=1`) renders the same layout with an opaque sidebar | open the web address in the MarkView browser tab | sidebar opaque, no transparency holes |
| V-24 | `npm run verify` green, CI green | as DoD | green |

---

## 13. QA scenarios: what must survive

Both scenarios (`.markview/qa/scenarios/promotion-desk-designer-brand-launch.json`, `promotion-desk-v0-7-1-docs-bugs.json`)
drive the macOS accessibility tree. The redesign changes **no visible text and no accessible name**. In particular these stay
exactly as they are:

- Shell: window title "Product Promotion Desk"; "Promotion Desk"; the seven menu labels; `aria-current` on the active item; the
  Attention count; "Hide menu"; "Menu" / "Menu · N"; the version tag `vX.Y.Z`; "AI engine" and "Accounts" groups with their
  accessible names ("AI engine: …", "Accounts: …"); "None selected" / "None connected"; "Automation running/paused";
  "Pause automation" / "Resume automation"; "Background".
- Page titles and subtitles of all seven sections; every button, tab, field label, hint, empty-state title and body listed in
  §10; the test ids `shell`, `sidebar`, `topbar`, `nav-*`, `attention-count`, `menu-hide`, `menu-show`,
  `app-version-header`, `accounts-summary`, `connect-account-link`, `automation-state-pill`, `automation-state`,
  `pause-toggle`, `brand-mark`, `launch-stage-*`, `launch-dots-*`, `attention-launch-path`, `approve-blocker` and every other
  `data-testid` already in the renderer.
- Tabs keep `role="tablist"` / `role="tab"` and `aria-selected`; segmented choices keep their radio inputs; toggles keep
  `aria-pressed`; the switch keeps `role="switch"`; the sheet keeps `role="alertdialog"`.

Layout and visual checks of the scenarios that this spec serves directly: 980×640 without overlap or clipping (V-05, V-06,
V-18); the window buttons never cover "Promotion Desk", the menu or "Menu" (V-02, V-04); text ≥ 13 px and readable in dark
(V-07, V-12); disabled buttons distinct with a visible reason (V-16); exactly one filled accent button and it is the next step
(V-10); red only for errors (§5.1); focus and hover everywhere (V-14, V-15); theme consistency (V-13).

For the step that edits the scenarios under the supervisor's rules (not decided here):

- `docs-bugs` c19 describes the dark window as `#14161a`; 0.8.0 already uses `#121418` and the target uses `#1e1e20`. The
  check's meaning (consistently dark or fully adapting, no mix) is kept by V-13.
- `docs-bugs` expects the active Opportunities filter "as primary" and the Resume button as primary; the target marks the
  active filter with the segmented thumb and keeps the toolbar free of filled buttons (DEC-022, and c10 of the other
  scenario). The meaning (the selection and the action are visible) is kept.
- Pre-existing differences found by the inventory, not caused by this redesign: "Select a product" no longer appears (a
  product opens by itself, BUG-037); "Website: Not set" is "No website yet"; the URL source kind is "Website"; "Suggest
  roles/channels" are "Suggest roles/channels with AI"; "Assess" is "Assess channel"; "Pending" is "Waiting"; the
  "No sources yet" body says "above" while there are fewer than 3 sources.

---

## 14. Implementation plan and boundaries

Order (each step keeps `npm run verify` green and the texts of §13):

1. Tokens and base rules in `styles.css` (§5, §6), `data-chrome` in `main.tsx`, window options in `src/main/index.ts` (§4.1).
2. Shell: sidebar with icons and the band toggle, toolbar band, hidden-menu state (`App.tsx`, new `icons.tsx`).
3. Shared components in `ui.tsx` and their CSS: Button variants and states, fields, pop-up button, segmented control used for
   all three `.tabs`, Switch, Tag, group box (`Card`), list panel rows, table, Disclosure/More, Note, EmptyState, Menu, sheet.
4. Pages: Products (list + detail, header, path, tabs and every tab), Accounts, Attention, Opportunities, Publications, Log,
   Settings; the one-filled-button rule per §10; `products.css` and `channels.css` onto the tokens (the 8 px / 6 px / 999 px
   literals, the monospace stack at `channels.css:120`, the duplicate `.mode-option`); the 14 inline `style` attributes.
5. Sweep (§12) on the packaged build in both themes and both sizes, then the QA scenarios.

Out of scope: an imitation of the macOS 26 "Liquid Glass" material in CSS (it reads as fake in a web view; the real material
comes from the window's vibrancy); new libraries; changes to texts, routes, the API or the core; the account browser windows and
the menu-bar item.

Risks: vibrancy shows through anything transparent in the content column (the content column must always paint
`--surface-0`); 28 px controls shrink click targets (the whole row of checkboxes and switches stays clickable, menu items and
summaries stay ≥ 28 px); the one-filled-button rule on review lists needs the "first card" flag; container queries need the
content column as a container.

---

## 15. Reproduce

```
# Baseline or after: every screen, both themes, both sizes, with metrics (own instance, demo data, nothing sent)
node scripts/design/tour.mjs "<app>/Contents/MacOS/Product Promotion Desk" <scratch dir> [port]
# Native window shots of the same data folder
node scripts/design/native.mjs "<app>/Contents/MacOS/Product Promotion Desk" <scratch dir> [prefix] [port]
# The target mock in real windows, with layout facts
node scripts/design/mock-capture.mjs <scratch dir> products:dark:1320:880 products:light:980:640 settings:dark:1320:880 empty:light:1320:880
```

The scripts start their own process, use their own data folder and capture only their own window (by pid). They never start,
read or stop the owner's application.

---

## 16. Page patterns as implemented (step "Update all screens")

Status: written while the page packages were implemented on `feat/macos-design` (commits `8c79db8`, `b14d89a` and the packages after them). The
matrix of §10 is the target; this section records what the code does, so the sweep and the next steps read one source.

### 16.1 Shared page patterns (`styles.css`, `ui.tsx`)

| Pattern | Markup | Rules |
|---|---|---|
| List + detail | `.split` > `.split-list` + `.split-detail` | Columns `clamp(208px, 27%, 300px)` + `minmax(0, 1fr)`, gap 16, **side by side at 980×640** (the 1040 px stacking rule is gone); the list is sticky; the detail is a CSS container (`@container (max-width: 560px)` folds its columns, tightens the launch path joints) |
| List panel | `.panel` > `.panel-row` (`.active`) | One surface `--surface-1` radius 12 pad 6; rows radius 8, pad 8/10, title 13/600 one line with ellipsis (a name that other products share ends in its creation time, "Name · 14 Nov 13:46", and wraps: `.panel-row-title.wrap`), up to two `--text-2` lines (`.panel-row-line`, `.wrap`); selected = `--accent-tint`; no card per row, no chevron |
| Object header | `ObjectHeader` (`.obj-head`) | Name 17/600, optional meta line, actions on the right; no box. Product: name + Edit details / Delete, then the label/value rows (Website, Description, Status; the labels are QA text) in `.obj` |
| Group rows | `.rows`, `.group-row`, `.status-line` | Children of a group box separated by inset hairlines; `.list-row` inside `.card` is flattened by CSS (no border, no fill) |
| One filled button | `OpenFormsScope`, `useOpenForm(active)`, `useMainVariant()` | One scope per screen (Products, Accounts, Publications). An on-demand form (New product, Edit details, Add statement, Edit statement, Edit source, Edit goal, an account's role, e-mail and password, New profile, Add account, channel settings while changed, New publication) calls `useOpenForm(active)` while open and gives its submit the variant it returns: filled only for the form opened last (`open-forms.ts`, an ordered list of open form ids; closing that form hands the fill to the one opened before it), a bezel (`ghost`) for every other open form. A resting main action (Approve passport, Open Analysis, Start analysis, Add source, the lone first-goal form) uses `useMainVariant()` and becomes a bezel while any form is open. On a product tab it uses `useTabMainVariant(tab)` (`LaunchPath.tsx`), which is also a bezel while the path's next stage is another one (`tabAccent`, `launch-path.ts`); `NextStage` draws the one filled link to that stage, below the tabs |
| One confirmation for removals | `ConfirmAction` (`ui.tsx`) | Everything that cannot be undone is confirmed the same way, in the place of its button: product (Delete), channel, account, profile, mailbox, rule, source, goal, statement, role, saved password. The button turns into the question, the verb and "Cancel"; focus starts on "Cancel", so a second Space or Enter never confirms; Escape cancels; the question closes when the action has settled. No `window.confirm`, no modal, no native sheet. A product with a connected channel gets a note before any question (`deleteBlocker`). An action that offers Undo (an AI-proposed rule) stays immediate and is not confirmed. New removals use the component and keep its question short, saying what is lost |
| Page action | `Button icon="plus"` in `Page.actions` | Bezel; the first-run empty state carries the filled "Add your first product" |

### 16.2 Products (done in the first page package)

| Screen / state | What it is now | Filled |
|---|---|---|
| Products, no product | empty state, art `product` | "Add your first product" (header "New product" is a bezel) |
| New product | group box form above the list; the product below keeps its tab but its main action is a bezel | "Create product" |
| List + detail | list panel (name + five launch dots, the website's host or "No website yet", analysis tag only for running/paused/failed, "Next: …" from `nextStage`), detail pane | per tab |
| Product header | object header + label/value rows, no card; Edit details opens a group box "Edit details" | "Save" while editing |
| Launch path | stage 24 px, joint 18 px (10 px in a pane under 560 px), mark 14 px, "Next" capsule 20 px | — |
| Sources | "Sources" group box with hairline rows (kind tag, name, text clamped to 3 lines, Edit / Remove quiet), "Add a source" group box (segmented kind) | "Add source" while the product has no source, then the link to the next stage; "Save" while a source is edited ("Add source" steps back) |
| Passport | group box with version, status, approval reason (also for an approved passport: "There are no changes to approve."), one group box per section with hairline statement rows (tags, text, sources; Approve secondary, Edit / Back to review / More quiet); the empty passport is the lead line + checklist | "Approve passport" (empty: "Open Analysis") while the passport is the next stage, then the link to the next stage; an open statement form owns it |
| Analysis | one group box: status, what will be read, three points, the steps as hairline rows | "Start analysis" / "Resume analysis" / "Run again" while the passport is the next stage, then the link to the next stage |
| Goal | one group box; saved goals are hairline rows (Edit, quiet Remove goal), the new-goal form opens by itself when there is no goal | "Add goal" / "Save goal" of the open form; the lone first-goal form only while Goal is the next stage, then the link to the next stage |

### 16.3 Accounts, channels, review, Log and Settings (done in the second page package)

| Screen / state | What it is now | Filled |
|---|---|---|
| Accounts → Accounts | `.split`: a `.panel` of accounts (name, platform, a tag only for sign-in needed, captcha, suspended; a dot and a word otherwise) beside the account. The account is an object header, a "Next:" note and five numbered step boxes (role, profile, e-mail, password, sign-in); the rare controls are one "More" disclosure | the account's next step: "Save" role, "Set an address", "Save a password", then "Show the window" / "Sign in with saved password" / "Open browser to sign in"; "Add account" in the header is a bezel with a plus |
| Accounts → New account | a group box above the list; the account below keeps bezels; the reason "Choose a platform." / "Name the account." sits beside the button | "Add account" |
| Accounts → Profiles | `.split` with a "New profile" bezel above the list; platform and account choices are toggle groups (`aria-pressed`, tint, never filled); no person yet = the form, a person proposed = the proposal | one per stage: "Make the profile", "Propose a profile", "Approve", "Make an account" |
| Accounts → Mailboxes | hairline rows of mailboxes and the add form; reason "Type the address of your mailbox." | "Add mailbox" |
| Product → Channels | a single column of group boxes in the order accounts strip, connect, channel list (a `.panel`), status, capability, plan, mode, settings, "Ideas from the AI"; the stage decides the one filled button while Channel is the path's next stage (no account → "Add an account", no channel → "Connect channel"); with a channel connected "Assess channel" and "Activate" are bezels and the link to the next stage is filled; "Save settings" is filled only while the form is dirty and the stage button steps back | by stage |
| Attention | "Getting started" group box (eyebrow, 26 px headline, launch path, hairline steps) while a step is open; "Connections and accounts" one box of hairline rows; decisions as review cards | the next Getting-started step (the newest product's next launch-path stage leads it), else the first open decision card's main action |
| Opportunities | a bar (product and channel pop-ups, a segmented state filter, "Check now" when one channel is picked), a hint with the result of the check, cards collapsed | the first open card's main action; "Connect a channel" in the empty state only when there is no channel |
| Publications | toolbar (Product, Channel, "Suggest with AI" secondary, "Write one myself" bezel, left out while the empty list offers it), the posting warning as a warning note, sections Drafts, Sent, Rejected | the open form's "Save as draft", else the first open draft's main action |
| Review card (Attention, Opportunities, Publications) | head row (state, kind, product, channel, account, date), the quoted comment on a well, the draft form (96 px resizable text area), the schedule row, the actions row: Defer and Reject quiet on the left, "Save draft", "Draft with AI" (secondary), "Approve and send" ("Save, approve and send" once the text is edited, `approveLabels`), then the main action on the right; the reason "Write the text first." beside a disabled Approve | the first card that offers a main action (`useMainActionOwner`); on every other card the same action is secondary |
| Log | segmented tabs (Runs, Action history, Events), each a table in a group box, wrapping cells, no sideways scroll | none |
| Settings | group boxes: AI engine (hairline engine rows, "In use" with a check), What the AI learned (add-rule row, hairline saved rules), Notifications, Local web access, About | none; "Use this engine" on the recommended engine while none is chosen |
| Results (product tab) | group boxes for goals and for each channel's metrics (a wrapping table), "Refresh all" bezel | "Connect a channel" in the empty state only |

Decisions taken while converting, so the next reader does not reopen them:

- Page CSS lives next to its page (`attention.css`, `settings.css`, `logs.css`, `results.css`, `review.css`, `channels.css`, `products.css`). `main.tsx` loads
  `styles.css` after the pages, so a page rule that must win over a shared one uses a longer selector (`.card .x`) or a new class name.
- "Older discussions" keeps its button and the texts "Show (N)" / "Hide": the QA scenarios use them (spec §13). The state filter of Opportunities stays a group of
  buttons with `aria-pressed` (a `SegmentedControl` would turn them into radio inputs and change their roles).
- A segment of a segmented track is 24 px inside the 28 px track (§7); the tour does not count it as a small control.
- The DOM order of the review actions is the main actions first ("Save draft", "Draft with AI", "Approve and send", "Approve"), then Defer and Reject, so Tab ends on Reject
  (as in 0.8.0); `.review-actions-side { order: -1 }` keeps them at the left on screen. Reject asks inline (`ConfirmAction`, focus on Cancel). The AI question sheet is the
  same: "Show the browser", "I’m done", then "Stop the AI" in the markup, `.modal-stop { order: -1 }` keeps it at the left; it asks nothing, a mission can be started
  again. Names, roles and test ids did not change (BUG-039).
- `.dot.info` and `textarea.input.short` are defined in a page css file and should move to `styles.css` with the next shared change.


## 17. AI in every field and form (0.10.0)

The direction (owner, 2026-11-14): the owner says what the product is about and the AI proposes or writes the rest, so almost nothing is typed. Every typed
field, every "Add ..." and every "Edit ..." gets AI help through the CLI engines. The AI proposes, the owner saves: nothing the AI writes is stored until the owner
presses the form's own button (DEC-009, DEC-019). The shared kit lives in `src/renderer/src/assist/` and `src/core/assist/`.

| Pattern | Markup | Rules |
|---|---|---|
| Field with AI | `AiField` (`.field.ai-field` > `.field-head` with the label and one secondary button, the input, the hint) | One small secondary button on the label row: "Suggest with AI" while the field is empty, "Improve with AI" while it holds text. Improve opens one line "What to change?" (optional) with "Improve" and "Cancel"; Enter runs it. The text goes into the field, never into storage. After the AI wrote, "The AI wrote this text. Check it before you save." with Undo, shown only while the field still holds exactly the AI's text (the owner's typing is never replaced silently, lesson 84). A reason it is off sits under the field with the link that fixes it. Never the filled button (V-10) |
| Ideas, one at a time | `AiProposal` (`.idea.proposal`: title and sentence, the secondary button, what it leaves alone, an optional "lean toward" line, the idea with an Unverified badge, "Use this") | The first press is "Suggest ... with AI", every later one "Another one" and the core is told which ideas were already shown. "Use this" hands the idea to the form below (here: the new goal's form, focus on its first field, "Filled from the AI's idea. Check it, then add the goal." with Undo when something was typed). The AI never saves the idea |
| Fill from the website | a secondary button on the label row of "Website address" on New product | Reads the site with the app's own reader, fills the empty name and description only (what is typed stays), says what it filled and kept. Nothing is created until "Create product" |

Where the AI helps in 0.10.0: goal ideas (Goal tab), the goal's target action, metrics and notes, a product's description, a new product from its website, a
channel's style, topics and search queries. The first ready engine is selected on the first launch (Settings shows it as "In use"). The numbers and switches that
decide what goes out (interval, limits, automatic replies) stay the owner's choice. Rewriting a draft of a reply or a post is §18 (0.11.0).

Two layout facts that come with the AI controls. The AI capsule in the toolbar is bounded (its label is at most 260 px and ends in an ellipsis, the full text is its
tooltip), and in a toolbar under 840 px it keeps only the ring (working) or a coloured dot (done, failed, stopped), as the automation state does: measured at 980×640
with the menu shown, even "AI finished" (109 px) cut the engine and the accounts, and the bare words "AI" (57 px) still cut the accounts by 2 px. Every field can now
start an AI run, so the capsule appears often and must not push the engine and the accounts out of the one-line toolbar (V-05). In the channel
settings, topics and search queries sit on a row of their own, two columns, so the AI's note and Undo have room under each field.

Rules that every AI help keeps (`core/assist/kit.ts`): untrusted text (a website, the owner's own words, the AI's answer) sits in a fenced data block that cannot close
itself; the answer is cut to the field's rules and refused when it holds a credential (and, for a text that proposes something to do, an instruction to automate posting
or a promise of results); the log says that a text was written, never what it says.

| Id | Requirement | Method | Pass |
|---|---|---|---|
| V-25 | An AI control on a field or form is a secondary or quiet button, 28 px tall, on the label row; no screen shows two filled buttons because of it | tour on Products (Goal, Edit details, New product) and Channels (settings) at both sizes and themes | 0 filled AI buttons; V-06, V-09 hold |
| V-26 | The AI's text lands in the field, never in storage; Undo restores what was there; typing over the AI's text hides Undo | packaged probe: write, undo, type | as described |
| V-27 | With the AI capsule showing (working or finished), no toolbar value (engine, accounts) is cut and the capsule is at most 330 px wide; under 840 px it is the ring or a dot | packaged probe at 1320×880 and 980×640, both themes | true |


## 18. AI in drafts (0.11.0)

The same direction for the text that goes out: the owner reads, changes and saves; the AI never stores a draft and never approves one (DEC-008). What is new is what
the AI's text has to pass before the owner sees it. `drafts.refine` (`src/core/pipeline/draft-help.ts`) writes or improves the title or the text of a reply, of a
post that has a card, and of a new publication, from the knowledge the AI drafts use (approved facts with their ids, prohibited statements, channel style and limits,
the role of the login, and for a reply the discussion, the parent chain and the account's earlier replies). The answer passes the checks of an AI draft
(`checkDraftSafety`: cited facts approved, nothing prohibited, no price, discount or "free" without a cited claim, links only to the product's own addresses, however a link is written: a full address, a bare domain, a short link such as `bit.ly/x`, a `www.` host, the target of a markdown or reference-style link; a link that is not a web address, such as `javascript:`, is refused), a
credential check, a length limit (a long answer is sent back, never cut) and the disclosure rule (the product's name or website named without saying the author is
connected with it; read on the finished draft, title and text together, except that a title written while the text is still empty is not asked to carry it: the text help that follows says it; for now the AI's own flag, until the disclosure check of the post mission lands). A failing
answer is handed back once with the reasons, then refused with them. A post written from nothing must cite an approved fact; any other text must cite one when the AI says it
states facts about the product that the owner's draft does not state (the same trust as the category of an AI reply; empty or not decides nothing, so a one-word
draft is no licence to add facts). The checks read the text without its invisible characters (zero-width, bidi marks, variation selectors) and with look-alike
forms folded, so "fr\u200Bee" or "evil\u200B.com" are caught; the text handed over is the AI's own. If the product knowledge (facts, prohibited statements, the product's
name or website) changes while the AI writes, the text is refused, not handed over as checked. The owner's text is never cut: a draft too long for the AI to read whole (20,000 characters) is refused. The
owner's own text next to the AI's is not checked; what the owner saves is the owner's, as before (the check of the owner's own text when it is approved is §19). Like the AI drafts, it works with any ready engine; the website-fed helps of §17 refuse engines that are not tool-free.

| Pattern | Markup | Rules |
|---|---|---|
| Title and text with AI | `AiTextField` in `DraftEditor` (the §17 field: label row, one secondary button, the wish line, the note and Undo) | The same control as §17: "Suggest with AI" while empty, "Improve with AI" while filled. It is on a card that can still change (not on a sent or locked one), disabled while a save runs, and its state starts over when a new draft row arrives. A reply has the text only. The AI's text is put into the form as it is when the answer arrives (a change to the link or the attachments meanwhile is kept). An answer was checked against the other field and the channel it was asked for: if either changed meanwhile, or the form was busy saving, the answer is dropped and the note says which; typing in the field itself always wins. A wish or subject is limited to 300 characters (the field stops there), never cut. The editor is repeated on every open card, so it only asks whether an engine is chosen; the refusal after a press says if the engine cannot work. |
| Draft with AI (new publication) | `PostDrafter` (`.field.ai-field`: "What is it about?" with the secondary button "Draft with AI" on the label row, one optional line, a hint) | Offered while the title and the text are both empty, and while its note and Undo are showing; it writes both. It needs an approved passport (the hint names the fix). Typing while it works wins: its post is dropped and the form says so. Undo empties both fields while the owner has not typed over them. |
| Redo with AI | `ConfirmAction` (secondary, sparkles) when the form holds unsaved changes; the plain button otherwise | A new AI draft replaces the form, so with unsaved changes it asks "The new draft replaces what you changed and did not save." (Replace my changes / Cancel). |

| Id | Requirement | Method | Pass |
|---|---|---|---|
| V-28 | The AI controls of the draft editor are secondary or quiet buttons on the label row, 28 px tall; the card keeps its one filled button | tour on Replies and Publications at both sizes and themes | 0 extra filled buttons; V-06, V-09 hold |
| V-29 | The AI's draft text lands in the editor, never in storage; Undo restores what was there; typing over it hides Undo; "Redo with AI" with unsaved changes asks first | packaged probe with the real engine on an own instance | as described |
| V-30 | A text the safety checks refuse is never shown to the owner; the refusal names the reasons | `draft-help.test.ts` (each rule, mutation-checked) and the packaged probe | as described |

## 19. A check before the owner's own text is approved (0.12.0)

The owner's own text used to reach Approve without anyone reading it against the rules an AI draft must pass. Now pressing "Approve" or "Approve and send" on a text
the owner wrote, or changed and did not save, reads it first (`drafts.check`, `src/core/pipeline/draft-check.ts`): locally, with no engine, nothing stored and the
text never logged. An AI draft the owner left as it is passed these rules when it was written and is not read again (`needsCheck` in `approve-check.ts`: the form is
dirty, or the draft's author is the owner).

What it reads is the safety module of the AI drafts in its owner mode (`checkDraftSafety` with `mode: 'owner'`): a statement the product knowledge prohibits; a link
that is not the product's own address, however it is written (the §18 rules); a price, a discount or "free" that no approved fact states (the owner's text cites no
fact, so any approved claim backs it, and the rules about citing facts do not apply); something that looks like a password or a key; and the connection to the
product (`disclosureVerdict`, the rule the approval itself enforces: the product named without saying the author is connected with it, or a denial of the connection).
Only the connection can stop an approval, because only it is decided in code at the approval and at the send. Nothing else is blocked by this panel.

No findings: the text is approved at once, as before. Findings: nothing is approved, nothing is saved, and the panel stands where the buttons were.

| Pattern | Markup | Rules |
|---|---|---|
| Check before you approve | `ApproveCheck` (`.check-panel`: the `--attention-bg` well with a `--line` border and `--radius-md`; head with the title and a warn `Badge` "N things"; one line of explanation; `.check-list`, one row per finding separated by hairlines: the rule in `--fw-medium`, the owner's words quoted in `--mono`, the reason muted; then the same action row as the card) | It replaces the buttons of the card, it is not a modal. "Edit the text" is the filled button (or secondary when another card owns the screen's one filled button) and has the focus when the panel opens; "Approve anyway" is secondary and approves what was pressed ("Approve anyway" after Approve, "Approve and send anyway" after Approve and send) with the editor as it stands. Defer and Reject stay at the left. |
| Blocking line | the same row with a `bad` `Badge` "Must be fixed" and the heading line "Something here has to be fixed before the text can be approved." | While a finding blocks, "Approve anyway" is not offered, only "Edit the text". |
| Check failed | the panel with no count, "The text could not be checked (reason). Nothing is approved yet; you can still approve it.", "Approve anyway" and "Edit the text" | A failed check never blocks an approval by itself (it is advice; the hard rules stay in the core). |

The panel is made for one text: its fingerprint is the title, text and link as the editor trims them (the attachments are not read by the rules). When any of them
changes the panel goes and the buttons return; a space at the end of the text changes nothing that would be approved and does not remove it. "Edit the text" closes it
and puts the focus in the text of the card. The buttons are disabled while the check runs, so the editor cannot change under it.

| Id | Requirement | Method | Pass |
|---|---|---|---|
| V-31 | The owner's text is read before it is approved; with findings nothing is approved or saved and the panel names each rule, the words and why; a blocking finding offers no "Approve anyway"; the panel goes when the text changes | `draft-check.test.ts`, `safety.test.ts`, `renderer-assist.test.ts` (each mutation-checked), and the packaged probe on an own instance (43 checks: clean text, AI draft left alone, three advice findings, the blocking connection line, both buttons, typing, Edit the text, light/dark at 1320x880 and 980x640) | as described; V-06, V-09 hold (one filled button per screen, no cut buttons) |

## 20. The browser of an account, rename, and a login that signs in through another (0.13.0)

Three things on the account screen, none of them a new screen: the name of an account can be changed, the account says which browser it works in, and a platform that signs
in with another one (Threads with Instagram) has no e-mail and no password of its own.

**Rename** (`AccountHeader`). The header of an account (`ObjectHeader`) has a bezel "Rename" button on the right. It opens one field under the header (`.pick-row`: the field, "Save name", "Cancel"),
filled with the current name and selected. Enter or "Save name" saves, Escape or "Cancel" closes. "Save name" is disabled while the name is empty, unchanged or longer than 80 characters
(`renameProblem`), the field takes no more than 80, and the core folds the spaces (`accounts.rename`). While the form is open it owns the filled button of the screen. Renaming changes
nothing on any platform: it is the owner's own label for the login (the list, the header, the channel pickers).

**Browser** (`AccountBrowser`, DEC-026). An unnumbered group box between the steps and the sign-in: it is a setting of the account, not a step. A radio group in the segmented track
(`SegmentedControl`, now with a `disabled` for the whole group and for one option): "Internal" (the default) and "Google Chrome". A line under the title says what is chosen. The choice is off
with a reason beside it (a `Hint`) while the AI works on the account or its browser is in use (its window is open, or the owner took control); "Google Chrome" is off with "Google Chrome was
not found on this Mac." when Chrome is not installed (there is no fallback to the other browser). An off segment has the quiet label and no hover; the selected one keeps its thumb. A note
under the control says the sign-in is kept in the browser it was made in, so after a switch the account signs in again in the other one. The control only chooses: a switch signs the
account out and closes its Chrome, so it is applied by a bezel button beside the control ("Use Google Chrome" / "Use Internal"), which appears only while the choice differs from the
account's browser; an arrow key between the segments never changes anything by itself. The reason beside an off group is tied to it (`aria-describedby`).

**Signs in with** (`AccountViaLine`, DEC-027). For a platform with `signsInWith` the e-mail and the password blocks are not shown; step 3 is "Signs in with Instagram": the chosen account
(platform badge, name, status), "Open account" (it goes to that account on the same screen) and a pick-row with the accounts it may use and "Use this account". The sign-in is step 4. In the
sign-in block the password button and the create-account buttons are gone; "Let the AI sign in with Instagram" starts the `signin` mission, and the browser buttons stay. The create form asks for
the account ("Signs in with Instagram", required, one candidate is preselected) instead of the e-mail and the mailbox; with no Instagram account the form says so first ("Add the Instagram
account first") and Add account stays off.

The one filled button is the button of the step the "Next:" note names, as in §10.3. When the account it signs in through is not ready (no login or no saved password), the note names that
account and its "Open account" button is the filled one; the sign-in of the linked account is not.

| Pattern | Markup | Rules |
|---|---|---|
| Rename | `AccountHeader`: "Rename" in the header actions; `form.pick-row` with one `.input`, "Save name" and "Cancel" | One field, no dialog. Enter saves, Escape closes. Disabled save for an empty, unchanged or over-long name. The open form owns the filled button. |
| Browser setting | `AccountBrowser`: an unnumbered `AccountBlock` (`.step-num.blank` keeps the column), `SegmentedControl` with `disabled` and `describedBy`, a bezel "Use …" button while the pick differs, a `Hint` for the reason, a `muted small` note | A setting, not a step: no number, never the filled button. Choosing and applying are two acts. Off with a reason, never silently. |
| Signs in with | `AccountViaLine`: `AccountBlock` step 3 with the badge and name, "Open account", `.pick-row` of a `select.input` and "Use this account" | Replaces e-mail and password for that platform. "Open account" is filled when the account it signs in through is the next thing to do. |
| Sign-in through | `AccountSignIn` with `through`: "Let the AI sign in with Instagram", the browser buttons, a `muted small` note that the platform has no password of its own | No password button, no create-account buttons. The owner is never asked for a Threads credential. |

| Id | Requirement | Method | Pass |
|---|---|---|---|
| V-32 | Rename, the Browser block and the linked-login screens follow the shared rules: controls at least 28 px, one filled button, nothing cut or overflowing, in light and dark | the packaged probe on an own instance (`MEASURE` and `LOOK` on the account of an ordinary platform, of a linked platform, the rename form open, the Browser block with Chrome chosen, the arrow key that only chooses, the apply button, the create form for Threads with and without an Instagram account): 47 checks | every check passes in both themes |
| V-33 | The browser choice and the link are real: the choice is saved and refused while the browser is in use, Chrome runs on a profile of the account's own and is let go of at a switch, the session survives a switch back and forth, Threads cannot be made or removed out of order | the mechanics probe on an own instance with the installed Chrome and a local page (26 checks, nothing off 127.0.0.1, no process left); `account-browser.test.ts`, `sign-in-through.test.ts`, `routing-browser-service.test.ts` (mutation-checked) | every check passes |

## 21. Open browser where a channel is chosen or shown (0.14.0)

To choose a channel (a community, a group) the owner sometimes has to look at the platform, signed in as the account. One control, `OpenAccountBrowser`, is shown wherever a
channel is chosen or shown, and it opens the account's own browser (Internal or Chrome, as the account says) with its session. It is not a new screen.

**Where.** *Connect a channel* (beside the address; the one place with "Use the page I'm on"), each row of *Accounts of this product*, each *suggested channel* (in the account that
"Use this" would use; hidden when the product has no account on that platform), the *channel card* (`channel-browse`, next to Activate, Pause and Remove), *Opportunities* and
*Publications* (beside the channel picker), and the thread link in `ThreadView` ("Open in the account's browser", beside the system links, which stay). Results, Logs and the launch path
show no such button.

**What opens.** The platform's page where channels are found (`PlatformInfo.browseUrl`; Reddit: the list of communities); the address typed in Connect when the platform reads it as a channel
of that platform (a handle turns into its profile); on a channel, its own page. A site with no page of its own and an empty address says "Type the address of the site first." beside the
disabled button.

**States.** The button is a bezel, never filled: the step's own action keeps the one filled button of the screen. It is disabled with its reason beside it (a `Hint`, `X-reason`) while
the AI works on the account or while the browser is open already. While the owner holds the browser the button is replaced by one block on its own row (`.open-browser-panel`): a warn note
("the app waits while you work in it"), "Show the window" and "Done, close the window"; in Connect also "Use the page I'm on". Where several buttons belong to one account (a row of
Accounts, the Connect form, a channel card) the block is shown once, by the one that was pressed, or by the first of them when that one is not on the screen (the owner went elsewhere and came
back, so "Done" is always within reach); the others are off and say "This account's browser is open already." (`openMode`, `blockHolder`, `useBlockClaim`).

**Use the page I'm on.** Reads one thing: the address of the page in the owner's window, cut to scheme, host and path (no query, no fragment, no credentials), and fills *Channel address*.
The field stays editable and *Connect channel* still checks the address. When something was cut (a query, a fragment) a line says so and asks the owner to check it is the page meant ("Everything
after “?” or “#” was left out of the address."). With no page open it says "No page is open in the browser yet."; with several tabs open in Chrome it says it cannot tell which one the owner is on, and what
to do; a page that is not a web page and a read that failed each have their own sentence.

| Pattern | Markup | Rules |
|---|---|---|
| Open browser | `OpenAccountBrowser` (`X` = `connect-browse`, `account-browse-<id>`, `suggestion-browse`, `channel-browse`, `opportunities-browse`, `publications-browse`, `thread-browse-<id>`) | Bezel button, `X-reason` beside it when off, one `.open-browser-panel` row while the owner holds the browser, `X-use-page` only in Connect |
| Address hint | `connect-browse-hint` under the Connect row: "Opens Reddit in this account's own browser, signed in as it. Find the place there, then press "Use the page I'm on"." | One muted line, platform named |

| Id | Requirement | Method | Pass |
|---|---|---|---|
| V-34 | The control follows the shared rules in every place it appears: controls at least 28 px, no second filled button, nothing cut or overflowing, the open block on its own row, in light and dark | the probe on an own instance (`MEASURE` and `LOOK` on Connect, Accounts of this product, suggestions, the channel card, Opportunities, Publications) | every check passes |
| V-35 | Opening and reading are real and small: the right page opens in the right browser, the app waits while the owner holds it, "Use the page I'm on" gives the address without query or fragment and only while the window is open, nothing else is read | `browse-channels.test.ts`, `electron-browser-service.test.ts`, `chrome-browser-service.test.ts`, `routing-browser-service.test.ts` (mutation-checked, every mutant killed but one redundant guard); the probe with a local page in both browsers | every check passes |

