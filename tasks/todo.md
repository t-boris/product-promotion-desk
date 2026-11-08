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


## PLAN (awaiting approval): credential vault, mailboxes and a sign-up assistant (DEC-014, REQ-012..014)

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
- [ ] 0.3.0 Mailboxes and one inbox (REQ-013; owner request added during 0.2.0): migrations 205 (mailboxes) and 206 (mail_messages: headers and a preview without codes and links; no bodies stored), IMAP connection test and status, aliases, an "Inbox" screen for all accounts (filter by account and platform, new marker), a plain-text reader that fetches the body on open, "Open in browser" (Gmail: direct link by message id; others: the webmail address the owner gives), verification code lookup, tests against a fake IMAP server. Only mail to an address the app proposed for an account, or from a platform the owner has an account on, is read into the app. NEEDS APPROVAL before this release: a mail parser dependency (mailparser) next to imapflow.
- [ ] 0.4.0 Sign-up assistant and domain addresses: REQ-014, per-platform sign-up URLs, wizard, tests with fake pages.

### Risks to settle early

1. Keychain prompts: the app is ad-hoc signed and its signature changes with every build, so macOS may ask for Keychain access again after each update, and a "Deny" makes the vault unreadable. Spike first in 0.2.0: install two successive builds and check what the owner sees. If it is unusable: keep the vault key in a file protected by a master password the owner types once per launch.
2. Outlook/Hotmail personal mailboxes no longer allow app passwords for IMAP (OAuth only); not supported in 0.3.0, and the form says so.
3. Some platforms reject `+` aliases; then use a domain address.
4. Auto-fill depends on how a site marks its fields; it will break when a site changes. The copy buttons are the fallback.
5. Platforms may treat automated login and sign-up as a policy breach; the app keeps to one attempt, the owner's browser profile and the owner passing every check.
