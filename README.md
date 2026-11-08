# Product Promotion Desk

Build a personal macOS application that helps users understand a product, discover relevant communities, prepare and approve promotional content, monitor discussions, and evaluate results using their installed Codex or Claude Code as the AI engine.

## Problem

Product promotion requires maintaining consistent product knowledge, finding suitable communities, following conversations, preparing context-aware responses, and tracking outcomes across separate accounts and websites. Manual coordination makes this work repetitive and creates risks of unsupported claims, missed conversations, and duplicate messages.

## Scope

In: a personal macOS application for the project owner and friends, each using an independent installation; Natal Mystic as the first product; approved product passports; channel discovery and onboarding; persistent browser accounts; capability assessment; scheduled monitoring; contextual replies; approval queues; restricted automatic replies; approved standalone publications; available platform metrics and optional business-event connections; logs and recovery. The proposed architecture uses Electron, TypeScript, React, and SQLite, with separate responsibilities for application state, scheduling, AI adapters, browser operation, connectors, authorization, analytics, and storage. Browser implementation remains subject to a real-site prototype. Out: video production and editing, arbitrary generated connector-code execution, automatic standalone publications, automatic handling of sensitive or ambiguous requests, and a shared multi-user service. The mandatory first platform remains open; universal onboarding guarantees only capabilities actually verified.

## Specification

The confirmed brief, decisions and requirements are in [`docs/features/product-promotion-desk/`](docs/features/product-promotion-desk/overview.md). Open this folder in MarkView to continue them.

### Requirements

- REQ-001 Verified product knowledge
- REQ-002 Account and channel onboarding
- REQ-003 Content preparation and review
- REQ-004 Controlled and verifiable sending
- REQ-005 Resilient local operation
- REQ-006 Personal workspace and results
