# Product Promotion Desk

Build a personal macOS application that helps users understand a product, discover relevant communities, prepare and approve promotional content, monitor discussions, and evaluate results using their installed Codex or Claude Code as the AI engine.

## Problem

Product promotion requires maintaining consistent product knowledge, finding suitable communities, following conversations, preparing context-aware responses, and tracking outcomes across separate accounts and websites. Manual coordination makes this work repetitive and creates risks of unsupported claims, missed conversations, and duplicate messages.

## Scope

In: a personal macOS application for the project owner and friends, each using an independent installation; Natal Mystic as the first product; approved product passports; channel discovery and onboarding; persistent browser accounts; capability assessment; scheduled monitoring; contextual replies; approval queues; restricted automatic replies; approved standalone publications; available platform metrics, with business-event ingestion and analytics connections deferred beyond version 1; logs and recovery. The proposed architecture uses Electron, TypeScript, React, and SQLite, with separate responsibilities for application state, scheduling, AI adapters, browser operation, connectors, authorization, analytics, and storage. Browser implementation remains subject to a real-site prototype. Out: video production and editing, arbitrary generated connector-code execution, automatic standalone publications, automatic handling of sensitive or ambiguous requests, and a shared multi-user service. The first acceptance of Natal Mystic must be demonstrated on Reddit in one user-selected subreddit, including reading discussions, publishing user-approved standalone posts, and sending replies. Universal onboarding guarantees only capabilities actually verified.

## Specification

The confirmed brief, decisions and requirements are in [`docs/features/product-promotion-desk/`](docs/features/product-promotion-desk/overview.md). Open this folder in MarkView to continue them.

### Requirements

- REQ-001 Verified product knowledge
- REQ-002 Account and channel onboarding
- REQ-003 Content preparation and review
- REQ-004 Controlled and verifiable sending
- REQ-005 Resilient local operation
- REQ-006 Personal workspace and results
- REQ-008 Product-scoped channels, accounts and results with AI help for new channels
- REQ-010 Login roles, one voice per discussion and disclosed affiliation

## Development

Requires macOS, Node.js and npm. Install dependencies with `npm install`, then:

| Script | What it does |
| --- | --- |
| `npm run verify` | Full check before a change is considered done: typecheck, lint, tests and build. |
| `npm test` | Runs the Vitest suite (`npm run test:watch` for watch mode). |
| `npm run build` | Builds the main, preload and renderer bundles with electron-vite. |
| `npm run dist` | Builds and packages the macOS application (Apple Silicon, unpacked app directory). |
| `npm run dev` | Starts the application with hot reload. |

`better-sqlite3` is a native module and must be compiled for the runtime that loads it. The tests run in plain Node, so `npm test` first runs `npm rebuild better-sqlite3` for Node. `npm run dev`, `npm start` and `npm run dist` run in Electron, which has a different ABI, so they first run `electron-builder install-app-deps` to rebuild it for Electron. Switching between the two is therefore automatic, but each switch takes a moment, and running a test and the application at the same time is not possible.

### Web mode

The interface can also be served on `127.0.0.1` so it can be opened in a browser tab on the same Mac, for example to check the application. It is off by default. Turn it on under Settings, Local web access, or force it for one run with environment variables:

```
PPD_WEB_MODE=1 PPD_WEB_PORT=47615 PPD_WEB_TOKEN=<secret> npm run dev
```

`PPD_WEB_PORT` and `PPD_WEB_TOKEN` are optional; without a token a random one is generated and shown in Settings. Web mode listens only on the loopback interface, requires the secret link, and cannot send anything without the approvals the application always requires.

### Background operation

Closing the window keeps monitoring running; the menu-bar item shows the status and offers Pause, Resume and Quit. Quit stops all automation. The application does not start at login: after a restart, open it yourself, and it first closes interrupted work, re-checks accounts and reconciles uncertain sends before anything is scheduled.

## Versioning

The version is the `version` field of `package.json`, following [Semantic Versioning](https://semver.org/). `0.1.0` is the first feature release. After a change is merged, the release is tagged in git as `vX.Y.Z` (for example `v0.1.0`), matching `package.json` exactly (DEC-007).
