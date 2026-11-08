# Plan: Product Promotion Desk v1 (feature `product-promotion-desk`)

Status: APPROVED by the owner on 2026-11-08; the four open decisions are recorded as DEC-005 (toolchain), DEC-006 (loopback web mode), DEC-007 (versioning, CI, deploy, GitHub issues) and DEC-008 (single PR, live Reddit acceptance together with the owner).

## Start state (verified 2026-11-08)

- Repository holds only README.md and the specification; there is no application code, no package.json, no CI workflow, no GitHub issue and no versioning rule.
- `main` == `origin/main` == `778da7f`; work branch `feat/product-promotion-desk` created from `origin/main`.
- Uncommitted spec edits (REQ-001..006, DEC-001..004, F-001..003, discussion, overview, implementation plan) carried onto the branch; they belong to this change and are committed first.
- MarkView status: `implementing`; readiness 100%; open questions: 0; blocker/high findings: 0.

## Records checked (binding, not re-asked)

- Q-001 answered A (Reddit, one user-selected subreddit) -> DEC-001 accepted -> REQ-002.
- DEC-002 accepted: business-event ingestion and analytics connections deferred beyond v1 (F-002 resolved).
- DEC-003 accepted: closing last window keeps automation running; Quit stops it; manual launch only, no login item (F-003 resolved).
- DEC-004 accepted: README must say "The first acceptance of Natal Mystic must be demonstrated on Reddit in one user-selected subreddit, including reading discussions, publishing user-approved standalone posts, and sending replies." (F-001 resolved, README edit still to apply).
- REQ-001..REQ-006 approved; discussion.md; implementation/plan.md (I-1..I-8); SRC-001 (the source text itself ends mid-way at section 8, "Storage and data protection", so notification, security and storage details are not specified anywhere).

## Decisions taken with the owner (all accepted, all recommended options)

1. DEC-005: npm, electron-vite, React 19, strict TypeScript, better-sqlite3, Vitest, ESLint, electron-builder.
2. DEC-006: loopback web mode (127.0.0.1, per-launch token, Origin checks, off by default, Settings toggle).
3. DEC-007: SemVer from 0.1.0 (tag v0.1.0 after merge), GitHub Actions on macos-latest, unsigned arm64 .app installed into /Applications, eight GitHub issues (I-1..I-8).
4. DEC-008: one PR with a commit group per plan item; live Reddit acceptance performed with the owner after deploy; REQ-002 live criteria stay unticked until the owner confirms.

## Proposed architecture (respects SRC-001 section 7 component split)

```
src/shared/      types and the RPC contract between UI and core
src/core/        pure TypeScript, no Electron imports: domain, storage (SQLite + migrations),
                 scheduler, authorization (SendGate), passports, opportunities, actions, metrics
src/ai/          engine adapters (Claude Code, Codex): spawn CLI as child process, events, cancel
src/connectors/  Connector interface, Reddit connector, universal connector with declarative profiles
src/browser/     Electron browser service: persistent partitions per account, tabs, user takeover
src/main/        Electron main: windows, menu-bar item, background lifecycle, IPC
src/renderer/    React UI (8 work areas, global pause, account indicator)
```

Invariants:
- Every outgoing action passes `SendGate`; connectors and the browser service refuse write-class actions without a gate-issued ticket, so AI instructions alone can never authorize sending (REQ-004).
- Approval hash = sha256(text, attachments, account, destination); any change invalidates it.
- One send attempt per action; an `unknown` outcome blocks further attempts until reconciled.
- Core runs without Electron so it is testable headless with in-memory SQLite.

## Work items (map to implementation/plan.md; one commit group each)

- [x] 0. Branch from origin/main, commit spec edits and this plan (evidence: git log).
- [x] 1. Scaffold: package.json (version 0.1.0), TypeScript strict, electron-vite, ESLint, Vitest, electron-builder, CI workflow.
- [x] 2. I-2 Local workspace + AI adapters + navigation shell (REQ-006).
- [x] 3. I-1 Product passports (REQ-001).
- [x] 4. I-3 Accounts, browser service, Reddit connector prototype, capability assessment (REQ-002, REQ-004).
- [x] 5. I-4 Monitoring, baseline, dedup, own-comment suppression (REQ-003, REQ-005).
- [x] 6. I-5 Drafting, modes, review queues, approval binding (REQ-001, REQ-003, REQ-004).
- [x] 7. I-6 SendGate, limits, attempt log, reconciliation, action history (REQ-003..006).
- [x] 8. I-7 Background lifecycle, pause, recovery, run log (REQ-005, DEC-003).
- [x] 9. I-8 Goals and platform metrics, README alignment with DEC-002 and DEC-004, Reddit acceptance (REQ-002, REQ-006).
- [x] 10. I-9 Product-scoped channels, accounts and results, AI help for new channels (REQ-008, DEC-009). Added 2026-11-08 after the owner's remark; see "Scope change" below. Implemented, committed and walked through in the running app.
- [x] 11. I-10 Login roles with a voice, one login per discussion, disclosed affiliation (REQ-010, DEC-010; GitHub #10). Added later the same day; see "Scope change 2" below.

## Scope change 2 (owner remark, three answers, recorded as DEC-010 and REQ-010)

Records checked: SRC-001 section 1, DEC-009, REQ-003, REQ-004 and the current code. Decided with the owner (all recommended options): a role (name and voice) per login, AI proposes roles and username ideas while the owner creates real logins; at most one login of a product speaks per discussion and logins never answer each other (mandatory, enforced by the SendGate); drafts that mention the product disclose the connection, text editable.

Found in the I-9 walkthrough and fixed with it: (a) AI channel ideas with a description instead of an address reached the "Use this" button (prompt now demands an address; the server drops anything the connector cannot read); (b) a site-profile draft for a page with nothing on it still named selectors that match nothing (to ground: selectors are dry-run on the pages that were read).

Plan:
- [x] a. Contract: `Account.role`, `RoleSuggestion`, `accounts.setRole`, `accounts.suggestRoles`, `accounts.create` takes a role.
- [x] b. Channels: migration for the role, API, UI (show and edit role, suggest roles, explanation when two logins share a community); site-profile selector grounding.
- [x] c. AI help: `suggestRoles` in ai-help.ts; disclosure and voice wording for draft prompts.
- [x] d. Pipeline: voice and disclosure in drafting; comments of every login of the product are own; one login per discussion in monitoring, drafting and the SendGate; tests.
- [x] e. Walkthrough, REQ-010 criteria ticked only when verified. Ticked: 1, 2, 5, 6, 7, 8. Left open on purpose: 3 (drafts in the role's voice) and 4 (disclosure in the text) depend on what the real model writes and are confirmed in the live Reddit run with the owner (DEC-008).

## Scope change 2026-11-08 (owner remark, answered in three questions, recorded as DEC-009 and REQ-008)

Records checked: SRC-001 sections 1, 3 and 6, REQ-002, REQ-004, DEC-001..DEC-008, discussion.md. The remark amends SRC-001 sections 1, 3 and 6.

Decided with the owner:
1. Account belongs to one product on one platform (own login and browser session); reusing an account of another product is possible only by explicit choice, and then the shared-account rules (aggregate limits, one controller of the browser session) apply.
2. Channels and Results become tabs of the product page and leave the main menu. Opportunities and Publications stay top-level with a product filter (assumption, confirmed in the walkthrough).
3. AI suggests channels from the approved passport and drafts a universal-connector profile for an unknown site (validated, versioned, saved only after review, never executed); manual instructions as fallback.

Plan (architecture unchanged: shared contract, core without Electron, renderer only imports src/shared):
- [x] a. Core data: migration adds `accounts.product_id` (existing accounts attach to the product of their channels; unattached ones stay usable and flagged shared); `accounts.create` takes `productId`; `accounts.list` and `channels.list` accept `productId`; `channels.connect` refuses an account of another product unless `reuseAccount: true`; `results.get` is product-scoped. Tests with the in-memory core.
- [x] b. Platform catalog: new `platforms.list` from the connector registry (replaces the hard-coded list in the UI).
- [x] c. AI channel help: `channels.suggest` (passport to suggestions, unverified) and `channels.draftProfile` / `channels.saveProfile` (read the site through the account browser, schema-validated draft, versioned save after review); manual-instruction fallback; tests with FakeEngine and fake connectors.
- [x] d. Renderer: Channels and Results as product tabs, menu without them, product filter on Opportunities and Publications, suggestion and profile-review UI.
- [x] e. Spec housekeeping: tick REQ-008 criteria only when verified (all nine ticked; criterion 7, saving an accepted profile as a version, was confirmed on the deployed app with a real site profile: 30 discussions found, saved as version 1); keep REQ-002 live criteria unticked until the owner confirms the live Reddit run (DEC-008).
- [x] f. GitHub issue for I-9, comments on the affected issues, commit with the `Feature: product-promotion-desk` trailer.

## Definition of done (from the goal)

- [x] branch from origin/main  - [x] records current as I work  - [x] GitHub issues in step (#1-#7, #9, #10 commented and closed after the merge; #8 commented and left open until the live Reddit run)
- [x] tests + build green      - [x] everything committed        - [x] PR with test plan (#11)
- [x] CI green (PR and main)   - [x] PR merged, main has the work (9969548) - [x] version bumped (0.0.0 to 0.1.0, DEC-007)
- [x] release built + deployed, version confirmed  - [x] walkthrough in a MarkView browser tab

## Review

Written before the PR, extended after the release.

**Result.** All eight plan items plus I-9 (product-scoped channels, accounts and results, AI help for new channels, REQ-008) and I-10 (login roles, one voice per discussion, disclosed affiliation, REQ-010) are implemented on `feat/product-promotion-desk`, in commit groups per item. `npm run verify` (typecheck, lint, tests, build): 59 test files, 1220 tests, green.

**Walked through in the running app (packaged build, loopback web mode, real Claude Code).** Migration of older data, menu without Channels and Results, product tabs, per-product lists, shared-login consent and the server's refusal without it, AI channel ideas as real addresses, AI role ideas, creating a login with a role and its display, role validation and the duplicate-name refusal, the explanation for a second login in one community, the site-profile draft rejected when its selectors match nothing on the page that was read, product filters on Opportunities and Publications, version 0.1.0 under About.

**Defects found in the walkthrough and fixed with a test.** (1) AI channel ideas arrived as sentences instead of addresses: the prompt asked for it; now an address-only prompt, a parser check and a server filter. (2) A site-profile draft for a page with no discussions was reported valid: selectors are now re-counted on the pages that were read, `ProfileAuthoring.partsOnPage` is part of the port.

**Not proven here, on purpose.** The live Reddit behaviour (selectors, JSON, sending), the Electron-only parts (tray, notifications, the user window, debugger upload, power events) and the model-dependent REQ-010 criteria 3 and 4 need the owner's live run (DEC-008). The one-login-per-discussion guard itself is covered by automated tests with fake connectors (mutation-checked), not by two real Reddit logins.

**Known gaps.** `accounts.suggestRoles` takes the platform of the product's latest login, not the one picked in the form; no API tells whether a host already has a valid profile, so the profile button shows for any web address on a non-prepared platform; attachments are referenced by absolute path; the renderer has no UI tests; the startup reconcile and digest run while paused; the price and discount safety patterns cover English and currency symbols only; `AttentionItem` has no `productId` (the UI resolves it through channels, accounts and products).

**After the merge.** PR #11 merged as 9969548 with green CI on the PR and on main; tag `v0.1.0`; `npm run deploy:local` installed 0.1.0 into /Applications (ad-hoc signed) and the installed app reported 0.1.0. The walkthrough on the installed app found one more defect: after saving a site profile the badge still read "Draft, not saved" next to "Saved as version 1". Fixed in 0.1.1 (badge follows the state), with lesson 7. The same walkthrough confirmed the positive grounding path on a real site (Hacker News: selectors found 30 discussions on the page that was read, profile saved as version 1) and closed REQ-008 criterion 7.

## 0.1.6: several promotion goals per product (DEC-012)

Owner question: "Can there not be several goals? Why only one?" Answer: no technical limit; I had stored one goal object per product. The owner chose a plain list of goals (not a main goal, not a goal per channel).

- [x] Types: `PromotionGoal` has an id, `Product.goals` is a list, `ResultsView.goals[].goals` is a list.
- [x] Migration 101: `goals_json`, the old goal becomes the first item, `goal_json` dropped. Tested on an old-shape row and on a copy of the owner's real database.
- [x] API: `products.saveGoal` (add or edit one goal, target action required, at most 20) and `products.removeGoal` replace `products.setGoal`.
- [x] Goal tab: one card per goal (save, remove with confirmation), "Add a goal", an open empty card when there is none; one visible confirmation on the goal saved last.
- [x] Results tab lists every goal of the product.
- [x] REQ-006 text and criterion 5, DEC-012, tests (1223 pass), 12-screen sweep (382 buttons, all 36 px).

Review: the first version lost the "Goal saved" message exactly when a new goal was added, because its card was replaced by the stored goal's card; found by running the flow, fixed by keeping the state in the tab.

## 0.1.8: named platforms and an AI plan for each channel (DEC-013, REQ-011)

Owner request: "more channels than Reddit, Instagram, Facebook, TikTok at least; the AI decides what to do in each channel; in principle any channel can be connected". Found: the universal connector with site profiles already covers "any site"; it has no file upload step, and Instagram/TikTok take only photo or video. The owner chose "catalog + AI plan for the channel" (not media upload, not catalog only).

- [x] Catalog: `presets.ts` (Instagram, Facebook, TikTok, X, LinkedIn, YouTube, Telegram, Threads, Pinterest as data), `listPlatforms` shows them between Reddit and Other website; accounts, channels, site profiles, suggestions and the sign-in page understand them; `@handle` is expanded; an address outside the platform's domains is refused.
- [x] Plan: migration 203 (`channels.plan_json`), `planChannel` (prompt, validation, drops ill-fitting or unsafe steps), `channels.preparePlan`, "What to do here" card on the channel.
- [x] UI: platform note in the account form, address example and resolved address in the connect form, plan card.
- [x] Tests (1245 pass), integration test with the real universal connector (named platform assessed as "needs check"), 12-screen sweep (394 buttons, label tops equal), a real Codex run of the plan on a copy of the owner's data.
- [ ] Not in this version: publishing photos and video (needs an upload step in site profiles and files from the owner); live checks on Instagram, Facebook, TikTok (need real accounts; REQ-002 reports support only as far as it was seen).

Review: the real model answered in the language of the product data (Russian); the labels around the plan stay English.


## PLAN: credential vault, account library, mailboxes and a sign-up assistant (DEC-014, DEC-015, REQ-012..015)

Owner request (2026-11-08): create new accounts mostly; keep passwords and log in automatically; suggest, or even make, an email address for a new account, and let the application read that mailbox and watch its state. Chosen with the owner: system-keychain vault with auto-fill; existing mailbox with aliases AND addresses on the owner's own domain; sign-up assistant where the app fills in and the owner passes the checks. NOT built: fully automatic creation of mailboxes or platform accounts (CAPTCHA and phone checks are anti-abuse measures; getting around them is mass account creation and gets accounts banned).

### What changes in the recorded design (needs a new decision)

DEC-008, REQ-002 and REQ-010 say "no credentials are requested or stored by the assistant; login happens on the site's own page". DEC-014 supersedes that line only: credentials may be stored, but only in the vault below, and the other limits stay (nothing is sent without approval, CAPTCHA/2FA go to the owner).

### Design

- Port `SecretStore` in `core/ports.ts` (`has/get/set/delete`, `available()`), Electron implementation with `safeStorage` (key in the macOS Keychain) writing one encrypted file `vault.bin` in the user data folder, in-memory fake for tests. Core keeps no Electron imports. Without `safeStorage` (web mode, no keychain) the vault is "unavailable" and says so; nothing is stored in plain text.
- The database holds only non-secret facts: migration 204 adds `accounts.login_name` and `accounts.mailbox_id`; migration 205 adds `mailboxes` (address, provider, IMAP host/port, kind `existing|domain`, status, last_checked_at). Passwords and mailbox secrets live in the vault under `account:<id>` and `mailbox:<id>`.
- Secrets never leave the main process: not in `accounts.list`, events, logs (the logger redacts known secret values), the loopback web API (which gets "has password" only), AI prompts, backups or exports. The owner may reveal a password with an explicit button; the clipboard copy is cleared after 30 seconds.
- Auto-fill: `BrowserService.fillLogin(account)` runs on the account's own browser partition only, only on a page whose host belongs to the platform (presets/hosts), submits once, and stops when a CAPTCHA, a second factor or an error appears and hands control to the owner (existing hand-off). At most one automatic attempt per account per hour, so a wrong password cannot lock the account.
- Mailboxes: read-only IMAP (`imapflow`; message text needs a parser, see 0.3.0) with an app password (Gmail with 2-step verification, iCloud, Fastmail, any IMAP host); status check; aliases `name+platform@gmail.com`; domain addresses by catch-all forwarding set once at the owner's mail provider (no API needed: the app proposes `instagram@yourdomain` and reads it through the connected mailbox). Verification mail: only messages to the account's address, received after the sign-up started, only the code or link is extracted and shown; links are never opened on their own; mail text is data and never reaches the AI.
- Sign-up assistant: per platform `signupUrl`; the wizard proposes an address and a username (reusing the role ideas), generates a password (CSPRNG, 20 characters), opens the sign-up page in the account browser, fills in e-mail, username and password by standard field hints (`autocomplete=email|username|new-password`), puts the verification code in when the mailbox has it, and saves the credentials in the vault only after the owner confirms the account exists. CAPTCHA, phone and birth date are the owner's.

### Releases (each straight to `main`, as agreed for bootstrapping)

- [x] 0.2.0 Vault and login (DEC-014, REQ-012): `SecretStore` port, `FileVault` over Electron `safeStorage` (`vault.bin`, 0600, one encrypted value per key), migration 204, "Password" box on every account (save, generate, show, copy, change, remove, "Sign in with saved password"), automatic sign-in once an hour when a check finds the account signed out, `BrowserPage.signIn` (the page itself checks the host and https; answers with a status only), `LOCAL_ONLY_METHODS` (reveal and copy refused by the web mode), timed clipboard, on-screen wording corrected, REQ-010 criterion corrected. Checked: 1280 tests; the sign-in script on live pages in Chromium (combined form, two-step, shadow DOM, CAPTCHA, wrong host, hidden or invalid form); the keychain with a build of a different signature (no prompt); the dummy password found nowhere in the data folder, database or log; 12-screen sweep (406 buttons, label tops equal). NOT checked: a real sign-in on Reddit or any other platform (the script is a best-effort reading of standard field hints), "Show" and "Copy" in the real window (only the loopback refusal and the core were exercised), and the clipboard clearing on the real clipboard.
- [x] 0.3.0 Account library (DEC-015, REQ-014; owner request: accounts, roles and mailboxes as separate things, created first and linked to channels of any product, each account with an e-mail address): accounts belong to no product (`product_id` stays as "made for", restricts nothing); top-level "Accounts" screen (all accounts, who uses each, shared-use warning, e-mail address with "Propose an address" from a base mailbox, "Create account on <platform>" opening the registration page in the account's own browser with address and generated password at hand, password box, role, sign-in controls); product Channels tab shows the accounts the product uses plus a compact "Add an account" (role ideas still land there); channel connect lists the product's accounts first and every other account of the library, a warning instead of the consent box; the same-role rule moved from account creation to channel connection; migration 205 (`accounts.email`, `accounts.mailbox_id`, `mailboxes`); `signupUrl` on the connector port, Reddit and the nine named platforms; account problems on the Attention page open the Accounts section. Also (owner remark): the page fills the window instead of stopping at 980 px, and the menu has Hide menu / Menu buttons, remembered between launches. Checked: 1307 tests; migration on a copy of the owner database (the existing account kept); scratch app driven through the real screens (add mailbox, propose and save an address, one account on two products with the warning, a product-less account connected through a handle); sweep of 14 routes with the menu open and closed (28 checks): equal button heights, nothing past the page edge, no window scroll. NOT checked: "Create account on <platform>" in the real window (web mode has no windows; only the core path `accounts.openBrowser` is the same as before), registration pages of the platforms (addresses are from memory, not opened), windows narrower than 760 px with the menu hidden, an ultra-wide display.
- [ ] 0.4.0 Mailboxes and one inbox (REQ-013): migration 206 (IMAP columns on `mailboxes`, `mail_messages`: headers and a preview without codes and links; no bodies stored), IMAP connection test and status, an "Inbox" for all accounts (filter by account and platform, new marker), per-account inbox showing only mail to that account's address, a plain-text reader that fetches the body on open, "Open in browser" (Gmail: direct link by message id; others: the webmail address the owner gives), verification code lookup, tests against a fake IMAP server. NEEDS APPROVAL before this release: a mail parser dependency (mailparser) next to imapflow.
- [ ] 0.5.0 Sign-up assistant (REQ-015, draft; owner message during 0.3.0: the AI itself proposes the e-mail and everything else, and may even make an icon for each platform): AI proposal of address, login name, display name and description from the passport, the role and the platform (advice only); the assistant fills in the registration form by standard field hints and the owner passes the checks; an icon per account. OPEN QUESTION for the owner before this release: how the icon is made. (a) The AI describes the icon and the owner makes or picks the picture; (b) the app draws a simple icon itself (initials or a symbol on a colour, no model needed); (c) an image-generation service (a new dependency, an API key, and the product name or description would leave the Mac). Domain addresses (catch-all forwarding at the owner's provider) stay an option.

### Risks to settle early

1. Keychain prompts: the app is ad-hoc signed and its signature changes with every build, so macOS may ask for Keychain access again after each update, and a "Deny" makes the vault unreadable. Spike first in 0.2.0: install two successive builds and check what the owner sees. If it is unusable: keep the vault key in a file protected by a master password the owner types once per launch.
2. Outlook/Hotmail personal mailboxes no longer allow app passwords for IMAP (OAuth only); not supported in 0.4.0, and the form says so.
3. Some platforms reject `+` aliases; then use a domain address.
4. Auto-fill depends on how a site marks its fields; it will break when a site changes. The copy buttons are the fallback.
5. Platforms may treat automated login and sign-up as a policy breach; the app keeps to one attempt, the owner's browser profile and the owner passing every check.

## 0.3.1: the Accounts screen redone (owner remark on 0.3.0; layout approved by the owner)

Owner: the UI is very badly made; it is not clear how to add accounts, passwords or roles; an account screen must contain no channels (the same account can be used by many channels, but that is chosen where a channel is connected).

Design (layout in the approval question):
- [x] Accounts section: header with one primary "Add account" button; tabs "Accounts" and "Mailboxes" (the base mailbox moves to its own tab).
- [x] Accounts tab: a list on the left (name, platform, status dot); the chosen account on the right.
- [x] The account card in the order the owner works: a "Next step" line (first thing still missing: address, password, sign-in), then four blocks, each with its current value in one line and one or two buttons: Role, E-mail, Password, Sign-in (create on the platform / open browser / check / sign in with saved password). Take control, give control back and Remove account behind "More".
- [x] Add account: a short form (platform, name, e-mail typed or proposed, role) at the top of the section; after adding, the new account is selected and "Next step" guides.
- [x] No channels, no products, no "used by" and no sharing warning anywhere in the Accounts section (the sharing warning stays in the channel connect form). The long "How signing in works" paragraph goes; each block explains itself in one line.
- [x] Product Channels tab: the compact account list stays (accounts the product uses), the "Add an account" form moves out: a link "Add a new account" and "Use this role" open the Accounts section with the role filled in (carried in the address).
- [x] Sweep with the new screen: every task (add, address, password, role, sign in) reachable in two clicks from the section; equal control heights; nothing past the edge.
- [ ] Separate finding: "Sign in with saved password" on Reddit answered "The sign-in form was not found or did not accept the values". Diagnose on the real login page (Reddit builds its form from web components) and fix the script or document the limit.

Result: 1311 tests; scratch app driven through the real screen (add with a proposed address, Propose and Cancel create nothing, password generate/cancel/save, role carried from the product page through the address, remove through More); sweep of 15 routes plus every account and the mailboxes tab, menu open and closed (40 checks): equal button heights, nothing past the edge, no window scroll. Found while driving it and fixed for the whole app: a button inside a form submitted the form (the shared Button now defaults to type button). NOT checked: the layout in a window narrower than 900 px, "Create account on <platform>" in the real window, and the Reddit sign-in finding below (still open, next after this release).

## 0.3.2: the account browser hand-off, and a sign-in that works on Reddit (owner remark: "it does not work, why can't I control the browser, why do I have to press a button?")

What was found (by looking at the running app and by running the app's own scripts in real Chromium, not by guessing):
- The account window was open but lay completely behind the main window (same size, main window on top). The app held the browser "in your hands" while the owner could not see it; the error pointed to a button under "More" that itself refused while the window was open.
- "CAPTCHA to solve" was a false alarm: Reddit keeps an invisible reCAPTCHA frame on every page, the probe counted its presence. A clean Reddit front page has no check at all.
- "The sign-in form was not found" was timing: the sign-in script ran once, right after the page loaded; Reddit draws its form from web components about 3 seconds later. The same script, run 4.5 s after load, finds the form and the "Log In" button (dry run, nothing sent).

- [x] Hand-off: `accounts.browser` (who holds the browser, is the window open), `accounts.showBrowser` (window to the front, page unchanged), `accounts.releaseControl` closes an open window instead of refusing; the window's button now reads "Done, close this window".
- [x] The Sign-in block shows the state while the person holds the browser: what to do, "Show the window", "Done, close the window"; the buttons that would only fail are not offered.
- [x] When the window closes the sign-in is checked once automatically (a look only: no saved password is tried behind the person's back).
- [x] The probe counts only a check a person can see (not an invisible frame, not the reCAPTCHA badge); it names the signal, and the log says what showed ("CAPTCHA: a visible check on the page (...)").
- [x] The sign-in step waits up to 15 s for the form to be drawn (asks again only on "no form"; never again after a submit or a read failure).
- [ ] NOT DONE, still open: store when an account's sign-in was last checked and what was seen, and show it ("Last checked 17:31 ...") in the Sign-in block (migration 206).
- [ ] NOT DONE: live sign-in with the owner's real password on Reddit (only the owner can run it; issue #8).

Result: 1335 tests. Checked in the real app (scratch instance, real windows): open, "Show the window" brings it above the main window, release closes it, the check after the close changed a forced status within 2 s; the same check that kept answering "captcha" now answers "Not signed in". Not checked: typing into the Reddit page in the account window; the form wait end to end (only the dry run in Chromium plus unit tests).

## 0.3.3: the platform of a new account is chosen, not defaulted (owner: "I add a Facebook account and it says Reddit")

- [x] The Platform field starts on "Choose a platform…", the add button stays off until a platform is chosen; the hint says it cannot be changed later.
- [x] An account whose name mentions another platform than its own says so on its card, with the way out (remove it under More and add it again).
- [x] Registration pages of the presets opened in a clean window: Facebook, Instagram, Reddit, X, TikTok, LinkedIn, Pinterest and Google open a real registration form; Threads opens its feed (it has no registration of its own), Telegram opens only a QR login (accounts are made in the phone app).
- [x] (closed by 0.3.4 below) The sign-in check for platforms other than Reddit, and the sign-up steps shown before the button is pressed.

## 0.3.4: the app itself checks that the account is in (owner: "I log in once, it stays in the cookies, next time you open the known URL and check that you can get in")

Owner's model (their words, 2026-11-08): the account browser keeps the login in its cookies; the app opens the known address; the owner types only what the app cannot know; afterwards the app itself checks that it can get in. No "I am signed in" button, no per-site profile for a plain login check.

- [x] `UniversalConnector.checkLogin` without any site profile for the host opens the platform's page in the account's own browser and looks (up to 8 times, 700 ms apart) whether it asks to sign in: a visible password field, a sign-in address, or a "log in" prompt at the top of the page. A page that has drawn text and never asks is "signed in" (the name stays unknown); an empty page is "not signed in" with the reason. A visible CAPTCHA ends it as "needs you". A site profile, when there is one, is used as before.
- [x] `LoginState.signal` (renamed from `captchaSignal`) says what the check saw; `loginOutcome` puts it into the status detail and the log for every outcome.
- [x] Dry run of the real loop in real Chromium, signed out, on Facebook, Instagram, LinkedIn, Pinterest, Threads, TikTok, X, Telegram and YouTube: all nine answered "signed out" within 0.7-2.7 s, each with its signal. The real app answered `login_required` for Facebook, Instagram and X accounts through the loopback API.
- [x] The auto-check after the account window is closed now gives a real answer for every platform (before, the no-profile error was swallowed).
- [x] "No account on <platform> yet?" with the four steps is shown at once while the account is not signed in (not only after pressing the button). Telegram and Threads have no web registration: they show a note instead (`signupNote`: the phone app; an Instagram account).
- [ ] NOT verified (needs the owner's real login): the "signed in" answer on any real platform; a signed-in Reddit/Facebook session surviving an app restart; sites whose public page never shows a log in prompt (a signed-out visitor could be taken for signed in).
- [ ] Open: record "last checked time + what was seen" in the Sign-in block (migration 206).

## OPEN after 0.3.4: Facebook registration form in the account window "spins, then Submit is active again, nothing changes" (owner report, 20:35)

- Facts: the app log has nothing after "Browser opened ... www.facebook.com" (20:33:27): the page works on its own, the app cannot see what Facebook answers. The account partition holds only anonymous Facebook cookies (datr, sb, fr, dpr, wd; fr/wd touched 20:35:10-11), no registration cookie, no `c_user`.
- Checked in real Chromium with the app's session settings, nothing submitted: https://www.facebook.com/r.php loads a one-page "Meta Account" form (name, birthday, gender, mobile/e-mail, password, "Submit"); no blocked requests, no console errors that matter. Differences from a normal Chrome: all permissions answer "denied" (Notification.permission), languages `en-US,ru-US`. Neither is proven to matter.
- Not known: what the Submit request returns. Candidates (unproven): Facebook refusing a new unknown browser/IP silently; the data typed (an alias address with `+`); an error message above the visible part of a long form.
- [ ] Needs from the owner: a screenshot of the whole window after Submit (scrolled to the top).
- [ ] Proposed, awaiting approval: log what the account window's page requests did (failed requests and HTTP >= 400 on the page's own host, host + path only, never query, headers, bodies or cookies) to the Log screen, so a silent refusal by a site becomes visible (lesson 47/49).
- [ ] Possible product consequence: platforms with strong anti-abuse (Facebook) may need the account made in the owner's usual browser, then signed in here; the sign-up steps should say so once confirmed.

## 0.3.5: the window of an account can be looked at (owner: "you can open the debug window in the browser and see what happens; I think you did not finish this function")

Owner's remark, 2026-11-08. The agent page had goto/read/fill/click/signIn only: no screenshot, no console, no network, and the owner's window recorded nothing, so a site that refuses silently could not be explained by anyone. Decision DEC-016, REQ-012 criteria 14-15.

- [x] `PageRecorder` (pure): requests that were sent or refused (host + path, method, status; never query/header/cookie/body), folded repeats, console errors, one throttled log line per refusal on the page's own site.
- [x] `ElectronBrowserService`: `webRequest` notifications and `console-message` of the owner's window and the app's page; `pageReport(account)` (reading script, screenshot, recorded requests); reports saved as files (`<data>/diagnostics/<account>/`, newest six, removed with the account).
- [x] `pageReadingScript`: title, start of the text, visible alerts; never a field value (tested with a typed secret).
- [x] API `accounts.pageReport`, log line per report (without the page text), button "What does the page show?" while the owner's window is open, `PageReportView`.
- [x] The owner's window still runs no script by itself (existing test) and the log text now says "does not click or type".
- [x] Verified on the real page (nothing submitted): the report of Facebook's registration form in the scratch app has the title, the readable text, the screenshot, the POSTs of the page (`ajax/qm`, `ajax/bz`, `ajax/webstorage/process_keys`, all 200) and three console errors (Permissions-Policy headers); the button and the view work on the Accounts screen; the report was saved as files.
- [ ] Waiting for the owner's next real attempt: what the Facebook Submit request answers (the log line or the report).

## 0.4.0: the AI works in the account's browser (owner: "it is not only a sign-up helper; the AI drives the browser and the system, I only give the user and the password")

Owner's remarks, 2026-11-08: after the e-mail and password are added the AI opens the browser, goes in and fills every value; questions and problems it solves itself because it sees the page; the window opened but nothing was filled in; "look at MarkView Browser, take the implementation". Then: this is the main function of the whole program (all channels, reply, fill in), not a sign-up helper. Decision DEC-017, REQ-016 criteria 1-4 and 8.

- [x] `src/core/browser-agent/`: `snapshot.ts` (page script: labelled elements `e12`, messages, human check; parse and clamp), `plan.ts` (prompt with the untrusted page fenced, `{{NAME}}` placeholders, `checkPlan` against the snapshot), `agent.ts` (the loop: observe, ask, check, carry out; stop on a human check, a page outside the platform, two rounds without a change, round limit, Stop).
- [x] `BrowserPage.pageStep` (second ticket-less write op, publishes nothing, host-limited): real mouse and keystrokes where the tab takes them, page events as the fallback; a custom drop-down is chosen from in one step.
- [x] `AgentRunService` (`agent.start` / `agent.state` / `agent.stop`): needs the e-mail, the saved password and a tool-free engine; one run per account; the site's own login check after "done"; no secret in the state, the log or the prompt.
- [x] UI: "Let the AI create the account" next to the manual button, run panel (summary, steps, values the AI chose, Stop).
- [x] Verified on the real Facebook registration form (real Electron page, real Claude Code, test values, the submit button blocked, nothing sent): the form filled in 4 rounds. Found and fixed on the way: a real mouse press does not reach the hidden agent tab (delivery is checked, page events are the fallback); Facebook's birthday lists are not native lists.
- [ ] Not verified: a real Submit and what follows (code to the e-mail, CAPTCHA, phone check); "signed in" recognition on Facebook after a real registration; the agent on a second platform.
- [ ] Needs the owner: select Claude Code in Settings (the selected engine is Codex, which can act on this computer and is never shown a website).
- [ ] Next: the same agent for the work in channels (read, reply, set up a profile) through the connectors with tickets; AI-chosen values saved on the account (migration); the mail reader moves from 0.4.0 to 0.5.0 (still needs approval for `mailparser`).

## 0.4.1: the AI button says why it cannot start (owner: "Let the AI create an account does nothing!!!")

Cause: the owner's selected engine is Codex (it can act on this computer, so it is never shown a website); the refusal was printed at the bottom of the block, off screen; the button looked ready. Seen in the owner's window and in the log (no "The AI started" line).

- [x] `agent.canStart`: the same prerequisites as `start` in one place (`prerequisites`), answered as a reason in words; nothing is run.
- [x] The button is disabled until the core says ready, and the reason is shown right under the buttons (a warning note); an error from the click itself is shown there too, not at the bottom.
- [x] Tests for every missing prerequisite (e-mail, password, engine not tool-free, none selected, not installed).
- [x] Checked in the scratch app with Codex selected: button disabled, the warning names Codex and says to choose Claude Code in Settings.
- [ ] Needs the owner: choose Claude Code in Settings (AI engine). I do not change it: it is the engine of the whole app, not only of this button.


## PLAN 0.5.0 (fourth version, after "no screen, questions as a pop-up, a concrete goal"): the AI owns the goal, works the account's browser through an MCP, full access

Owner's decisions (2026-11-08): the AI is given a GOAL ("create an account for this user: invent the name, fill everything in, make sure the account exists"), splits it itself and uses the app's browser through an MCP, like MarkView. Full access for the engines, like MarkView. No new screen and no terminal: when the AI needs the person (a CAPTCHA, a code) it asks in a POP-UP. The work is short and concrete, not a long session. `node-pty` / `xterm.js` were approved, but with no screen nobody would type into a terminal, so they are not added (the requirement changed; this is not avoiding a library).

How MarkView does it (read: `BrowserAgentTools.swift`, `BrowserControlServer.swift`, `AgentBrowserRegistration.swift`, `WorkspaceManager.swift` `browserToolArgs`, `AIAssistants.swift` `fullAccessArgs`): the app binary is the MCP server (JSON-RPC lines on stdio); each tool call is relayed over a Unix socket (0600) to the running app, which performs it in the browser tab; the server goes into the agent's OWN start arguments (`--mcp-config <json>`, `-c mcp_servers.<name>.command|args`); agents run with `--dangerously-skip-permissions` / `--dangerously-bypass-approvals-and-sandbox`.

Design:
1. One engine run per mission, in the background: `claude -p` / `codex exec` with the goal on stdin, the MCP in its arguments, full access. The engine loops over tool calls itself until it reports a result; a run is tens of seconds to some minutes (limit 30 min). Stop kills the process.
2. MCP server = the app binary in Node mode (`ELECTRON_RUN_AS_NODE=1`, checked), a second main-build entry `mcp-shim`; it relays JSON-RPC lines over one persistent Unix-socket connection (token in the first line) to the app; the app (core, pure) answers `initialize`, `tools/list`, `tools/call`. Core stays Electron-free: the socket lives in main behind a port `AgentBridge.open(handler) -> launch spec`.
3. Tools: `browser_snapshot` (refs `e12`, alerts, human-check flag), `browser_navigate`, `browser_click`, `browser_type`, `browser_select`, `browser_press_key`, `browser_evaluate`, `browser_screenshot`, `browser_wait_for`; and the app's own `ask_owner(question)` (pop-up; blocks, long-polling about 45 s per call, until the person answers), `note_value(label, value)` (what the AI invented for the account), `report_result(done|needs_owner|failed, reason)`. A password is written `{{PASSWORD}}` and typed by the app into a password field; the real value is never in the transcript or the log.
4. The server keeps sanity rules (not a security boundary now): navigation and steps only on the platform's hosts, only refs from the last snapshot, a bounded number of calls.
5. The internal browser is SHOWN: while a mission runs, the account's own browser (the persistent partition the app already has) is opened in a visible window beside the app and the AI works in it, so the owner watches everything it does (owner, 2026-11-08: "every time we do something, we do it inside this browser; only the terminal is not needed"). The window is shown without taking focus; closing it only hides it. Real mouse input should also reach a visible tab (the hidden tab dropped it).
6. Control: each tool call runs inside its own short `withAgentControl` (so the owner can take the browser between calls: a CAPTCHA, a code), and a call that finds the owner holding the browser answers "the owner has the browser; wait with ask_owner". The pop-up has "Open the browser" and "I am done".
7. End: the engine exits; then the site decides: the connector's login check says whether the account is signed in, whatever the AI claimed.
8. Progress: the existing panel of the account (steps, Stop) is reused; each tool call becomes a plain line. The pop-up is an app-level modal that appears on any screen when a run asks.
9. Publishing is unchanged: the AI prepares, the owner approves, the app sends (REQ-004, tickets).

Steps:
1. [x] MCP side de-risked (2026-11-08): a stub MCP server run from the installed app binary in Node mode is called by Claude Code and Codex 0.167 in `-p` / `exec` and in interactive PTY sessions; a tool that blocks 90 s is waited for by both. Findings: Claude's `--mcp-config` is variadic (prompt first when it is an argument; with stdin no problem); interactive-only facts (trust dialog, `--ignore-user-config` exec-only, `spawn-helper` needs +x) no longer matter without a PTY; Codex needs `default_tools_approval_mode="approve"` for MCP tools in `exec` unless the bypass flag covers it (to verify); the owner's Codex is at 18% of its weekly limit.
2. [ ] Core: MCP protocol handler, tool list, executor over `BrowserPage` (snapshot, pageStep and the checks of 0.4.0 move here), port `AgentBridge`, `AiTask.agent` for the engines, mission service (`agent-runs.ts` rewritten), `ask_owner` state and `agent.answer`.
3. [ ] Engines: argument building for Claude and Codex with full access and the MCP (tests on the exact arguments).
4. [ ] Main: Unix-socket gateway, the `mcp-shim` entry, wiring in `index.ts`; the visible agent window (`BrowserService.showAgent`); check that the shim runs from the packaged `app.asar` in Node mode.
5. [ ] UI: pop-up for the question, the existing panel; remove "tool-free" wording and gating.
6. [ ] Remove the round loop of 0.4.0 (`plan.ts`, `agent.ts`); keep `snapshot.ts` and `pageStep`.
7. [ ] Tests, typecheck, lint; live dry run on the real Facebook form with real Claude Code and real Codex (submit not pressed), including a pretended CAPTCHA through `ask_owner`; then release 0.5.0.

Not verified yet: a real submit and what follows (e-mail code, phone check); the cost of a run against the owner's subscription; Codex `exec` with the bypass flag and MCP approval; the shim from the packaged asar.

### Addendum to 0.5.0 (owner, after the live dry run, 2026-11-08): the account has a PROFILE, and the AI proposes it, the owner decides

Finding of the dry runs (real Claude Code and real Codex on the real Facebook form, nothing submitted): both filled everything in about 20-40 s, and both MADE UP the name, surname, birth date and gender by themselves. Owner: that is a strategic choice, the AI must propose a variant and ask; the photo has to be made up as well; an account is much more than a user name and a password. (Lessons 74, 75.) The pop-up with the question stays as it is, with its answer field (owner: keep it).

The right design (named first, per lesson 72):
1. Account profile = first name, last name, display name, user name, birth date, gender, place, about-text, website, avatar picture (a file in the app's data folder). Stored on the account in the database (a migration); the password stays in the vault.
2. `profile.propose(account)`: the text engine builds a proposal from the role, the product, the platform and the e-mail, with one line of reasoning per choice (like `roles.suggest`). The owner edits and approves it once in the account card (a block "Profile"; a layout mock is shown first). A mission without an approved profile does not start; it says so.
3. The mission takes every value from the profile as a placeholder (`{{FIRST_NAME}}`, `{{LAST_NAME}}`, `{{USERNAME}}`, `{{BIRTH_DATE}}`, ...). A field the site asks for and the profile lacks: the AI proposes a value with `ask_owner`, the answer is saved into the profile.
4. Picture: made by an image tool, shown to the owner, used only after approval; uploaded into the site by a new tool `browser_upload` (file input) from the profile's folder. Codex lists `image_generation` as a stable enabled feature (checked with `codex features list`; NOT tried in `exec` yet, and Claude Code has none).
5. After the account exists, a second mission "fill in the profile" (about-text, picture) uses the same stored profile.

Interim rule for the first build (same mechanism, no new screen): the mission prompt tells the AI to PROPOSE every invented personal detail with `ask_owner` and wait for the owner's yes or corrections before typing it.

Owner, same day: "He must have a strategic vision, he must understand what I make this profile for, and choose the matching age, gender and everything else, even the picture." So the profile carries a PURPOSE (the owner's words, prefilled from the product and the role) and a STRATEGY (the AI's reading: the audience on this platform and why this person fits it), and each field has its reason.

Decisions of the owner (2026-11-08): (1) the AI proposes the whole profile, the owner approves; (2) the picture is created by the AI (Codex image generation) or replaced by the owner's own file; (3) 0.5.0 waits and ships together with the profile.

Steps of the addendum:
A. [x] Core data: `AccountProfile` (purpose, strategy, names, user name, birth date, gender, place, about, website, picture idea, picture file, status proposed|approved, reasons), table `account_profiles` (migration 206), store, validation (adult, lengths, characters).
B. [x] AI: `proposeProfile` in `ai-help.ts` (from purpose, product passport, platform, role, e-mail, the other profiles so that two accounts are not alike); the answer is validated JSON; tests with a scripted engine.
C. [x] Service `AccountProfileService` (`src/core/channels/account-profile.ts`) + API: `profile.get | propose | save | approve | setPicture | makePicture | picture`; an edit of an approved profile makes it `proposed` again.
D. [x] Mission: a signup mission needs an approved profile and takes every personal value from it (the AI invents nothing); new kind `profile` fills the profile on the platform after the account exists (about-text, place, website, picture) with a new tool `browser_upload`.
E. [x] Picture: NO separate `ImageMaker` port (simpler than planned): an engine that `makesImages` takes `AiTask.makeFiles = {dir}` and Codex runs `--sandbox workspace-write --cd <dir>`; tried once for real (1254x1254 PNG, 13k tokens). The file lives in the app's data folder, the owner's own file replaces it.
F. [x] UI: a block "Profile" in the account card (layout mock to the owner first), the proposal with the strategy and the reasons, edit, approve, picture (shown, create again, replace).
G. [x] Tests, typecheck, lint, live check (propose on a real engine; one picture with Codex; fill-in mission on a scratch site or the real form without submitting), then release 0.5.0.

Progress 2026-11-08 (core part of the addendum): A-E done and tested (1519 tests green, typecheck and lint clean). Mission without an approved profile is refused (`no_profile`, `profile_not_approved`); the signup mission types the owner's values (`{{USERNAME}}` is a value, the password stays a secret), the `profile` kind fills an existing account; `browser_upload` exists only when the mission has a picture and takes a file NAME (`PICTURE`), never a path; hidden file inputs are listed in the snapshot. Left: F (UI, layout mock first), G (live checks: propose on a real engine, a picture with Codex through the service, the profile mission on a scratch page; release).

Live check of the core (2026-11-08, real engines, scratch data folder, the real Facebook form, nothing submitted): `profile.propose` with Codex: 21 s, a strategic proposal (42-year-old female beginner-friendly persona for a beginners' astrology audience, a reason per field, the product connection disclosed; the engine itself chose to say "fictional community persona" in the about-text: a wording the owner may want to tune). `profile.makePicture` with Codex: 35 s, a 1254x1254 PNG (3.1 MB) that matches the description. Signup mission with the approved profile: Codex typed exactly "Mara", "Veldenbrook", April 19 1984, Female, the e-mail and the password, invented nothing, and asked the owner before the submit button (dry-run label). NOT verified live: the `profile` mission (needs a signed-in account) and `browser_upload` on a real site.

Progress 2026-11-08 (UI, owner said yes to the layout): block "2 Profile" in the account card (`AccountProfile.tsx`); the other blocks are now 3 E-mail, 4 Password, 5 Sign-in, and every "(step N)" text follows. States: no profile (purpose field + "Propose a profile"), proposed (strategy note, every field with its reason, picture made/replaced, Propose again / Save changes / Approve), approved (one line, Change, "Fill in the profile on the site (AI)" enabled only for a signed-in account). Checked in the browser against the scratch app with real Codex: propose from the UI 23 s, picture from the UI 31 s, own file by path (a relative path is refused with the reason), save turns an approved profile into a proposal, approve works, controls are locked while the AI works. The browser tool's keystrokes do not reach ANY input of this app (the old role editor too), so the edits were driven with the input events themselves; not a finding of the profile block. A value the owner changes loses the AI's reason (it explained the old value). Live finding fixed: the proposal put notes into typed values ("Madison, Wisconsin - fictional setting"); prompt + backstop + test (lesson 77). 1525 tests, typecheck and lint clean. Left: the release (0.5.0) and the honest list of what is not verified (the `profile` mission and `browser_upload` on a real site, the real submit and what follows, the packaged shim).


### 0.5.1 / 0.6.0 (owner, after 0.5.0, 2026-11-08): AI progress, and Profile is its own entity with many accounts

Owner's words: no progress is shown when the AI is called ("terrible"); "profile and account are linked but the profile is not a part of the account: we make a profile, then accounts for it on Facebook, Instagram, anywhere; another profile may be connected only to Instagram, so Instagram has two profiles, two accounts"; "the AI must be smart enough to find the profile on any of these sites and fill everything from our profile: all the information, the picture, the description".

Done at once (a bug-level fix inside the existing design): the `profile` mission names no addresses; it tells the AI to find the profile editor itself, match every value to the site's field by meaning, upload the picture into a file input and record what it filled (`agent-runs.ts`, test added). Not yet proved on a real site (needs a signed-in account).

PART 1. AI progress (release 0.5.1). One place at the engine boundary, so every AI help gets it:
1. [ ] Core `AiActivity`: `EngineRegistry` hands out an engine whose `run` registers an activity (id, what it is in words, engine, startedAt, status running|done|failed|stopped, the last 30 lines, optional subject = profile/account) and feeds it the stage lines the services know ("Sent to Codex", "Checking the answer", "One repair", "Making the picture", "Saving") plus every `onProgress` line of the engine (Codex prints its own to stderr). Abortable: a Stop.
2. [ ] API `ai.activity` (running ones and those finished in the last minute) + `ai.stop`; scope `ai` in the change events.
3. [ ] UI (layout mock to the owner first): the block that started the AI shows a panel in place of the silent button (engine, running time, live lines, Stop); the top bar has one pill "AI working: <what> 0:23" that opens the same panel from any screen.
4. [ ] Probe the real Claude Code with `--output-format stream-json --verbose` for real steps in text helps (it prints nothing in text mode); take it only if the probe shows usable events, otherwise Claude shows the stage lines and the clock.
5. [ ] Tests with the fake engine (lines arrive, stop aborts, a failure is shown), live check with Codex.

PART 2. Profile as its own entity (release 0.6.0). The model (to be agreed BEFORE building):
- Profile = the person: label for the owner, product (optional), purpose, strategy, role (name + voice), first/last/display name, base user name, birth date, gender, place, about, website, picture, intended platforms (optional list), status proposed|approved, reasons. Made once.
- Account = a login of a profile on one platform: platform, e-mail, password (vault), its own user name on that platform (the profile's base name unless taken), the browser session. `accounts.profile_id` (null allowed: the owner's own old logins stay as they are). At most ONE account per (profile, platform); a platform can have many profiles.
- Role/voice moves to the profile (the same person speaks the same way everywhere); an account WITHOUT a profile keeps its own role as today.
- Migration 207: `profiles` table, `accounts.profile_id`, carry over the rows of `account_profiles` (the owner's real database has none, only a scratch copy has), drop `account_profiles`. Pictures live in `profiles/<profileId>`.
- API: `profiles.list|get|create|propose|save|approve|remove|setPicture|makePicture|picture`, `accounts.setProfile`; the missions read the profile of the account.
- Screens (layout mocks to the owner first): a tab "Profiles" in the Accounts section; the profile form (what exists now, moved) + "Accounts of this profile" with one row per platform (state, "Create the account with the AI", "Fill in the profile on the site (AI)", open); the account card keeps a one-line "Profile: <name> [Open] [Change]".
Steps: model + migration + tests; service/API; missions; UI; live check; release.

Open questions for the owner: (a) one account per platform for a profile; (b) role/voice on the profile; (c) order: 0.5.1 progress first, then 0.6.0 structure.

#### Review of 0.6.0 (owner: all together, as fast as possible, without tests and PRs)

Done: AI progress at the engine boundary (`AiActivity`, tracked engines, `ai.activity`/`ai.stop`, top-bar pill, `AiProgressPanel` per profile; Codex stderr filtered so its echoed prompt is not shown); Profile as its own entity (migration 207 `profiles` + `accounts.profile_id`, unique per (profile, platform), `account_profiles` rows carried over, `profiles.*` API, `accounts.setProfile`, role lives on the profile and an account of a profile speaks with it, tab "Profiles" with the accounts of a profile per platform, one-line profile in the account card, profile choice in the add-account form).

Checked live (scratch copy of a database with two 0.5.0 profiles, real Codex): migration, both profiles carried over with their role; new profile, proposal with progress panel and pill (20 s), approval, "Make an account" from the profile, the account card showing the profile, one-account-per-platform refusal, removal guard.

NOT done, on the owner's instruction: no tests were written or run for this release. Tests of the old per-account API are now stale and fail to compile: `person-profile.test.ts` (was `account-profile.test.ts`), `agent-runs.test.ts` (profile.* calls, `agent.showBrowser` typing), `profile-proposal.test.ts` (`platform` became `platforms`), `electron-browser-service.test.ts` and `renderer-logic.test.ts` (Account has `profileId`). Port them before the next `npm test`.
