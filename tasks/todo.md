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

- [ ] 0. Branch from origin/main, commit spec edits and this plan (evidence: git log).
- [ ] 1. Scaffold: package.json (version 0.1.0), TypeScript strict, electron-vite, ESLint, Vitest, electron-builder, CI workflow.
- [ ] 2. I-2 Local workspace + AI adapters + navigation shell (REQ-006).
- [ ] 3. I-1 Product passports (REQ-001).
- [ ] 4. I-3 Accounts, browser service, Reddit connector prototype, capability assessment (REQ-002, REQ-004).
- [ ] 5. I-4 Monitoring, baseline, dedup, own-comment suppression (REQ-003, REQ-005).
- [ ] 6. I-5 Drafting, modes, review queues, approval binding (REQ-001, REQ-003, REQ-004).
- [ ] 7. I-6 SendGate, limits, attempt log, reconciliation, action history (REQ-003..006).
- [ ] 8. I-7 Background lifecycle, pause, recovery, run log (REQ-005, DEC-003).
- [ ] 9. I-8 Goals and platform metrics, README alignment with DEC-002 and DEC-004, Reddit acceptance (REQ-002, REQ-006).
- [ ] 10. I-9 Product-scoped channels, accounts and results, AI help for new channels (REQ-008, DEC-009). Added 2026-11-08 after the owner's remark; see "Scope change" below.

## Scope change 2026-11-08 (owner remark, answered in three questions, recorded as DEC-009 and REQ-008)

Records checked: SRC-001 sections 1, 3 and 6, REQ-002, REQ-004, DEC-001..DEC-008, discussion.md. The remark amends SRC-001 sections 1, 3 and 6.

Decided with the owner:
1. Account belongs to one product on one platform (own login and browser session); reusing an account of another product is possible only by explicit choice, and then the shared-account rules (aggregate limits, one controller of the browser session) apply.
2. Channels and Results become tabs of the product page and leave the main menu. Opportunities and Publications stay top-level with a product filter (assumption, confirmed in the walkthrough).
3. AI suggests channels from the approved passport and drafts a universal-connector profile for an unknown site (validated, versioned, saved only after review, never executed); manual instructions as fallback.

Plan (architecture unchanged: shared contract, core without Electron, renderer only imports src/shared):
- [ ] a. Core data: migration adds `accounts.product_id` (existing accounts attach to the product of their channels; unattached ones stay usable and flagged shared); `accounts.create` takes `productId`; `accounts.list` and `channels.list` accept `productId`; `channels.connect` refuses an account of another product unless `reuseAccount: true`; `results.get` is product-scoped. Tests with the in-memory core.
- [ ] b. Platform catalog: new `platforms.list` from the connector registry (replaces the hard-coded list in the UI).
- [ ] c. AI channel help: `channels.suggest` (passport to suggestions, unverified) and `channels.draftProfile` / `channels.saveProfile` (read the site through the account browser, schema-validated draft, versioned save after review); manual-instruction fallback; tests with FakeEngine and fake connectors.
- [ ] d. Renderer: Channels and Results as product tabs, menu without them, product filter on Opportunities and Publications, suggestion and profile-review UI.
- [ ] e. Spec housekeeping: tick REQ-008 criteria only when verified; keep REQ-002 live criteria unticked until the owner confirms the live Reddit run (DEC-008).
- [ ] f. GitHub issue for I-9, comments on the affected issues, commit with the `Feature: product-promotion-desk` trailer.

## Definition of done (from the goal)

- [ ] branch from origin/main  - [ ] records current as I work  - [ ] GitHub issues in step
- [ ] tests + build green      - [ ] everything committed        - [ ] PR with test plan
- [ ] CI green                 - [ ] PR merged, main has the work - [ ] version bumped
- [ ] release built + deployed, version confirmed  - [ ] walkthrough in a MarkView browser tab

## Review

(filled in at the end)
