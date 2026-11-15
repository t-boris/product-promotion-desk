# UI redesign: implementation plan

Status: **approved by the owner's goal of 2026-11-15** ("Implement what docs/design/ui-redesign-plan.md specifies"), recorded as DEC-037; implemented on branch `feat/ui-redesign`, tracked in issue #40. Written 2026-11-15 from the owner's feedback and a read of the current code. Where the implementation had to differ from this text, the difference is listed in section 9.

## 1. Why

The interface is organised by object type (Attention, Products, Accounts, Opportunities, Publications). The owner works by flow: what needs a decision now, how the product is doing, what to write next. The owner's complaints, each traced to the code:

| Complaint | Cause today |
|---|---|
| Attention is one long unclear list, cards are not separated, no single Send button | `Attention.tsx` renders every decision as a collapsible `ReviewCard`; only the first open card owns the filled button (`useMainActionOwner`) |
| Products is a long list with tabs, no graphics, no problems or AI advice in one place | `ProductDetail.tsx` stacks header, launch path, six tabs; the Channels tab is one column of six cards per channel; no chart component exists |
| Not clear which product a thing belongs to; what is a brand | No global product context; Opportunities and Publications each carry an "All products" filter; there is no Brand entity (`Product` is the root, `src/shared/types.ts`) |
| Accounts split in two panes with three tabs | `Accounts.tsx`: Accounts / Profiles / Mailboxes, list + long detail column |
| Opportunities do not show what happens in the channels | Only a comment in the 25 newest discussions becomes an opportunity (`ingest.ts`); new posts are stored but not shown; mentions and replies to the owner are not read |
| Publications cannot be sorted or filtered | `Publications.tsx` has a product filter and a channel pop-up only; no state filter, search or sort |
| Open browser must be closed before the AI can work | A single-holder lock per account (`browser-session.ts`, `TakeoverError`): while the owner holds the browser, monitoring, sending and AI runs of that account wait (DEC-026, DEC-028) |

## 2. Principles

1. **The product is the context.** It is chosen once, in the sidebar, and every screen below it shows that product only.
2. **One decision at a time, one primary button, always in the same place.**
3. **Setup is separate from daily work.** What is configured once does not sit in the daily path.
4. **The AI's advice has one home** (the product overview), in addition to the helpers on forms.
5. **Safety rules do not change:** approval bound to exact content before any send, the send gate, one voice per discussion, drafts-only content mix, unknown results reconciled by the owner.
6. **The visual system stays:** tokens, 28 px controls, text sizes 13/15/17/22/26, light and dark, no new dependencies (V-22), minimum window 980×640.

## 3. Decisions (answered 2026-11-15 by the goal that asked for the plan to be implemented; the default in bold is the recorded answer, DEC-037)

| # | Question | Default assumed |
|---|---|---|
| D1 | Sidebar structure as in section 4 | **Yes** |
| D2 | Brand: a group of products with a shared voice and accounts, or only the product switcher | **Product switcher only; no Brand entity** |
| D3 | Remove the "one controller per account browser" lock (changes DEC-026/028) | **Yes, phase D** |
| D4 | Feed: Reddit first (new posts, replies to me, mentions); reading Instagram/Facebook/Threads is a separate decision | **Yes** |
| D5 | Order of phases A → B → C → D → E | **Yes** |

Each phase started only after its decisions were answered; all five were answered at once by the goal. A later answer that differs re-plans the phase, it is not adapted on the fly.

## 4. Target structure

```
┌ [◆ Product name ▾] ─┐   product switcher (+ "New product", "All products" where a screen supports it)
│ Overview            │   how the product is doing: funnel, channels, problems, AI advice, activity
│ Inbox          (n)  │   everything that waits for the owner (replaces Attention)
│ Feed           (n)  │   what happens in the channels (replaces Opportunities)
│ Posts               │   the owner's publications (replaces Publications)
│ Channels            │   the product's channels, one page each
│ ─────────────────── │
│ Accounts            │   the shared library of logins (not per product)
│ Setup               │   sources, passport, analysis, goal: done once
│ Log · Settings      │
└─────────────────────┘
```

Route map (old hashes keep working through redirects, as `#/channels` already does in `route.ts`):

| Old | New |
|---|---|
| `#/attention` | `#/inbox` |
| `#/products/<id>/results` | `#/overview` |
| `#/products/<id>/{sources,passport,analysis,goal}` | `#/setup/{sources,passport,analysis,goal}` |
| `#/products/<id>/channels` | `#/channels`, `#/channels/<channelId>/{status,plan,mix,settings}` |
| `#/opportunities` | `#/feed` |
| `#/publications` | `#/posts` |
| `#/accounts/...` | unchanged |

## 5. Phases

Every phase is one PR with its own release and local install, and ends with: unit tests for new pure logic (through `src/main/renderer-logic.test.ts`, since `src/renderer/**` is not under vitest), the screens probe in a scratch instance (light and dark, 1320 and 980, every control 28 px, one filled button, no overflow), `npm run verify`, an independent review, updated `visual-system.md`, a decision record, and updated QA scenarios.

### Phase A — product context, new sidebar, Inbox (renderer only)

**A1. Product context**
- New `src/renderer/src/product-context.ts`: the current product id, stored under the existing `ppd.lastProduct` key; a hook `useCurrentProduct()`; falls back to the newest product; empty state when there is none.
- New `ProductSwitcher` in the sidebar head (`App.tsx:113-132`): a pop-up with the products, their launch-path dots, "New product".
- Remove the per-screen product filter (`pages/review/products.tsx:71-85`); screens read the context. Lists are filtered through the channels as today.

**A2. Sidebar and routes**
- `pages/index.ts:17-25`: new entries and order; `route.ts`: new hashes and redirects from every old one; `attention-links.ts`: fix links point at the new routes.
- The Inbox count capsule keeps its tones (`attention-tone.ts`); Feed gets a neutral count of undecided items.
- `visual-system.md` V-03 (seven sidebar items in order) is rewritten.

**A3. Inbox**
- New `pages/Inbox.tsx` replacing `Attention.tsx`. Two segments: **Decide** and **Fix** (the current "Connections and accounts" card becomes the Fix list, each row with its fix link).
- Decide is list + detail:
  - Left: compact rows grouped under headings **Replies**, **Posts**, **Questions from the AI**, **Results to confirm**. Row: channel, author or title, 60-character excerpt, time, state dot.
  - Right: the selected item in full, using the existing `ThreadView`, `DraftEditor`, `PostPreview`, `ScheduleControl`.
  - Bottom of the detail: a sticky action bar. Left: Reject/Delete, Dismiss. Right: the one filled button, labelled by the existing `mainActionOf` and `approve-labels.ts` ("Approve", "Approve and send", "Send", "Reconcile").
- After an action the next row is selected. Keyboard: ↑/↓ move, ⌘↩ presses the primary button.
- The order stays frozen while the owner works (existing rule, `Attention.tsx:171-180`).
- "Getting started" hero is shown only while the product has no channel; afterwards it is gone.
- `useMainActionOwner` is no longer needed on this screen (one item is open); it stays for Posts groups.
- No core change: `attention.list` already returns everything; grouping is a pure function `inbox-groups.ts` with tests.

**A4. Done when**
- The owner can clear the whole queue without scrolling a list of open cards; at 980×640 the list, the detail and the action bar are visible together; every old link lands on the right new screen.

### Phase B — Posts (renderer only)

- New `pages/Posts.tsx` replacing `Publications.tsx`.
- Control row: `[All | Drafts | Approved | Scheduled | Sent | Deleted]` segmented control, Channel pop-up (default All), Search field (title and text, in the renderer), Sort pop-up (Updated, Planned time, Channel), `[List | Calendar]`.
- List: one compact row per post: first picture thumbnail, title or first line, channel icons (a group shows all its channels), state badge, planned or sent time. Groups are one row that expands to its versions.
- Selecting a row opens the post on the right with the existing editor, preview, schedule and group controls; the action bar from A3 is reused.
- Calendar: a month grid of planned and sent posts, plus the content-mix rhythm as faint markers (`mix.get`); clicking a day with nothing offers "Write one myself" for that date.
- "Suggest with AI" and "Write one myself" stay in the header; the filled button rule is unchanged (Save while the form is open).
- Pure logic with tests: `posts-filter.ts` (state, channel, search, sort), `posts-calendar.ts` (which post falls on which day in local time).
- No core change: `opportunities.list {kind: 'standalone'}` and `postGroups.list` already carry what is shown.

### Phase C — Overview, Channels, Setup (renderer + one core query)

**C1. Core: metric history**
- New API `results.history {productId, days}` returning, per channel and metric, the snapshots of the period from `metric_snapshots` (kept already; indexed by channel and time). Missing values stay missing, never 0.
- New API `overview.get {productId}`: funnel counts for the period (found, drafted, approved, sent; from opportunities and send actions), per-channel summary (state, waiting, sent, last success, next check), the product's attention items.
- Tests with the fake clock; no migration.

**C2. Overview screen** (`pages/Overview.tsx`)
- Header: product name, website, launch-path dots while setup is incomplete (link "Finish setup").
- **Funnel** for the chosen period (7 / 30 days): four numbers with a bar each.
- **Channels**: one tile per channel: platform icon, target, state dot, "n waiting · n sent", a sparkline of the main metric where one exists. A tile opens the channel page.
- **Problems**: the product's Fix items with their links.
- **The AI suggests**: up to five suggestions, each with one action. First version is rule-based from data the app has (no post on a channel for N days, a content-mix kind never enabled, unused update notes, a channel without a plan, an unconfirmed result); a later version may ask the AI. Rules are pure functions with tests.
- **Activity**: what was sent each day (replies and own posts, stacked columns) and, beside it, the main metric over time (a line for each of up to four channels). They are two charts because a count of sends and a score are different units and one axis for both would mislead.
- Charts are hand-written SVG components (`charts/Sparkline.tsx`, `charts/ColumnChart.tsx`, `charts/LineChart.tsx`, `charts/FunnelBars.tsx`), tokens only, with a text alternative and a table view for each. No library. See section 9 for the folder name and for why Activity is two charts.

**C3. Channels**
- `pages/Channels.tsx`: tiles (same as on Overview, larger) and "Connect a channel".
- `pages/ChannelPage.tsx`: `ObjectHeader` (target, account, Open browser, Check now) and tabs **Status** (status + capability), **Plan**, **Content mix** (mix + notes), **Settings** (mode + settings form). The six cards of `ChannelDetail.tsx:32-42` are regrouped, not rewritten.
- "Accounts of this product" moves to the Channels list head as a compact row.

**C4. Setup**
- `pages/Setup.tsx`: the launch path as a vertical stepper (Sources, Passport, Analysis, Goal), one step open at a time, using the existing tab components. `NextStage` keeps the filled button.
- The passport's eight sections become a two-column summary with "Edit" per section instead of eight stacked cards.
- `Products.tsx`, `ProductList.tsx`, `ProductDetail.tsx` are removed after their parts have moved; creating a product stays a form opened from the switcher.

**C5. Accounts**
- One list grouped by profile (persona): the persona row, its accounts beneath with platform and state; accounts with no profile under "Other logins".
- Account detail becomes `ObjectHeader` + tabs **Sign-in**, **Role**, **Browser**, **More**; the same components as `AccountDetail.tsx:53-94`.
- The base mailbox moves to Settings.

### Phase D — the browser without the lock (core; needs D3)

Today: `BrowserSession` gives control to exactly one party; `withAgentControl` throws `TakeoverError` while the owner holds the window; monitoring, the gate, sending, missions, metrics and agent runs all wait.

Target: the owner's windows and the AI's page are independent pages of the same account session.
- **Internal browser** (`electron-browser-service.ts`, `user-window.ts`): the owner may open any number of windows on the account's partition; the AI keeps its own hidden view. The two are separate pages already; opening for the owner no longer hides the AI's view or takes control.
- **Chrome** (`chrome-browser-service.ts`): the AI works in a tab it owns; the owner's tabs are never driven. "Use the page I'm on" reads the tab the owner last focused.
- **What replaces the lock**
  - Identity: the signed-in identity is checked before every submit (exists) and additionally re-read after any owner window navigated to a sign-in or sign-out address.
  - A send in progress is not interrupted by the owner opening a window.
  - `Take control` / `Give control back` remain only for the explicit case "show me the AI's own page and let me finish it" (captcha, a question from the agent).
- **Removed waits**: `monitor.ts:77,154,168-181`, `gate.ts:301`, `sending.ts:161,387`, `mission-publisher.ts:202`, `metrics.ts:127`, the "browser busy" answers in `agent-runs.ts`.
- **UI**: `OpenAccountBrowser` becomes a plain button that opens a window; the holding panel ("Done, close the window") is removed; V-32–36 are rewritten.
- **Risks to prove**: the owner logs out or switches account while a mission runs (must end "needs you", nothing submitted); two pages editing the same composer (the AI's page is its own, so no); a site that signs out other tabs. Probes on local pages in real Chrome and Electron, as for DEC-035.
- New decision record superseding the relevant parts of DEC-026 and DEC-028.

### Phase E — Feed (core + renderer; needs D4)

**E1. Model**
- `Opportunity` gains `source: 'comment' | 'new_post' | 'reply_to_me' | 'mention'` (migration; existing rows are `comment`).
- One voice per discussion (DEC-010), the baseline rule (the first read creates nothing) and the own-login exclusion apply to every source.

**E2. Reading (Reddit first)**
- **New posts**: discussions are already read and stored (`ingest.ts:101-112`); a new post by someone else becomes an opportunity when it matches the channel's topics. Matching is a pure function over title and text; the channel setting "search queries" (stored, used by nothing) feeds it.
- **Replies to me** and **mentions**: read the account's inbox listing (needs the signed-in session; a new connector capability `read_inbox`, shown as unavailable where it is not).
- Per-cycle limits and the 400 ms pacing stay; a channel without the capability shows why in its Status tab.
- Platforms the app cannot read stay empty with the reason said on the screen; reading them through the browser is a separate decision.

**E3. Drafting**
- A reply is drafted for `reply_to_me` and `mention` as for a comment. For `new_post` the AI first decides "worth answering or not" with a reason; modes (observe / draft / approval / auto) apply unchanged, and auto never answers a new post.

**E4. Feed screen** (`pages/Feed.tsx`)
- Filter chips: **All · New posts · Comments · Replies to me · Mentions**; Channel pop-up; state segmented control (To decide / Sent / Skipped); "Check now".
- Rows grouped by day: source icon, where, who, the first line, what the AI proposes (Reply drafted / Suggests skipping / Not drafted), time. List + detail and the action bar as in the Inbox.
- An item that needs the owner's decision appears in both Feed and Inbox; it is the same object.

## 6. What does not change

Approval hashing and the send gate, the mission toolbox, connectors' publishing, content-mix rules, the disclosure rule, the Log and Settings screens (apart from the mailbox moving in), the visual tokens.

## 7. Costs and risks

- **QA scenarios and frozen texts (V-21):** section names, routes and test ids change in A–C; scenarios are updated in the same PR as each phase, and old test ids are kept where the element survives.
- **Baselines:** `docs/design/macos/baseline/` is re-shot per phase (the 0.8.0 set is kept in `baseline/0.8.0/`; the 0.21.0 re-shot is described in visual-system.md §31).
- **Phase D** removes a safety simplification; it is the phase most likely to need a second design pass.
- **Phase E** is the largest and depends on what Reddit's inbox gives a signed-in session; it starts with a read-only probe before any build.
- Phases A and B are renderer-only and can ship within the current architecture; C adds two read-only queries; D and E change the core and each needs its own decision record.

## 8. Order and size

| Phase | Content | Touches | Relative size |
|---|---|---|---|
| A | Product switcher, sidebar, routes, Inbox | renderer | M |
| B | Posts: filters, search, sort, list, calendar | renderer | M |
| C | Overview with charts, Channels pages, Setup, Accounts | renderer + 2 queries | L |
| D | Browser without the lock | core + renderer | M, high risk |
| E | Feed: new posts, replies to me, mentions | core + connectors + renderer | XL |

## 9. Where the implementation differs from the text above (recorded as it was built)

- **Charts folder.** `src/renderer/src/charts/`, not `ui/`: a folder named `ui` next to `ui.tsx` is ambiguous to read and to import.
- **Activity is two charts**, not one: sends per day (columns of replies and own posts) and the main metric over time (lines per channel). A chart with two axes invents a correlation; the visualisation rules the project follows forbid it.
- **`results.history` and `overview.get`** (C1): `days` is a whole number from 1 to 365. `overview.get` also takes `utcOffsetMinutes` (the viewer's offset, `-new Date().getTimezoneOffset()`); its period is whole local days ending today, and its funnel counts the opportunities created in that period (so a step never holds more than the one before it). `results.history` takes the last `days` days up to now. `OverviewChannel.lastSentAt` was added for the "silent channel" suggestion. A reading the platform did not give is `null` in a series and a gap in a chart, never zero.
- **"The AI suggests"** (C2) is the pure function `overviewSuggestions` in `src/shared/overview-suggestions.ts`: unconfirmed results, drafts that wait, a channel without a plan, a channel with no content mix switched on, notes of the owner's that no post has used, a channel that sent nothing for 14 days; at most five, each with the fact it comes from.
- **Posts logic** is in `src/renderer/src/pages/posts/` (`posts-filter.ts`, `posts-calendar.ts`). A draft with a planned time is on the calendar from the draft on (its state says whether it is approved); a sent post is on the day it went out. Weeks start on Sunday.
- **Phase E, the read-only probe.** The plan asked for a read-only probe of a signed-in Reddit inbox before building. A probe against the real site, with the owner's session, is not done by the assistant (own-instance probes only), so the inbox reading is built against Reddit's documented listing shapes and proved on fakes and on local pages; **how the real inbox answers is unproven** and the Status tab says so.
- **Channels** (C3): the list is the tiles of the Overview (`ChannelTiles`, one component, one data hook `useOverviewData`); the channel page has four tabs (Status, Plan, Content mix, Settings) at `#/channels/<id>[/<tab>]`. "Open browser" moved from the status card to the page header; "Check now" is in the header too (it stays on the Feed, for the channels of the product). The old `ChannelList` and `ChannelDetail` are removed.
- **The Feed's read of the inbox, known limits** (recorded in DEC-039; none needs the owner's answer to build, each has a default): the inbox is read once for every channel of an account, so N channels of one account read it N times per interval (default: accept, the cost is two small GETs; a shared read is a later optimisation); at most 25 inbox items per cycle (default: accept, newest first); a mention inside a post body, not a comment, is not found (out of scope, as the plan says "mentions of the account"); an item the discussion read already queued as a comment is relabelled to `reply_to_me` or `mention` (default: relabel, so the owner sees one item); a first-seen post is queued whatever its age, because a post is first seen only after the channel's baseline (default: no age cap; an old post that surfaces again is one more row the owner skips).
- **Setup and Accounts** (C4, C5): the stepper's four steps open one at a time at `#/setup/<tab>`; the passport is eight two-column tiles with "Edit" per section (the section's own editor opens in place; "Add statement" is in the editor, not on a closed tile, to keep the tiles quiet: default taken). The base mailbox is a card in Settings. Account steps keep their numbers across the four tabs (Role 1 and Profile 2 in Role, 3 to 5 in Sign-in) so the frozen QA texts ("step 4", "step 5") stay true: default taken. The dead shared CSS (`.split`, `.panel*`) was removed with the screens that used it.
- **Feed** (E4): three queries instead of one, one for each list (To decide, Sent, Skipped), each capped at 300 by the core, so a long history of sent replies cannot push out an undecided item (default taken). The source is a text label, not an icon (no fitting glyph in `icons.tsx`). The sidebar shows a neutral count of the replies to decide (A2). Dropped test ids: `filter-open`, `filter-sent`, `filter-closed`, `filter-all` and the Feed's `review-card-<id>`.
- **One selection rule for list screens.** Posts and Feed commit the chosen row with `useListSelection` (pure rule: `list-selection.ts`): when the row leaves the list the neighbour is chosen and kept, and a post that later moves to the top does not take the pane while something is being edited. Home and End move the selection with the arrow keys. `useQuery` ignores an answer that arrives after a newer one was asked for (a quick toggle of the Overview period could show the old numbers under the new title).

