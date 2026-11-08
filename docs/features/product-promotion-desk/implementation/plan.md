---
type: plan
feature: product-promotion-desk
title: "Product Promotion Desk v1: Local promotion workflow for Natal Mystic"
issues:
  - id: I-1
    title: Create and maintain approved product passports
    summary: Implement product creation from a URL or description, optional supporting materials, and scoped source-code analysis without executing project code. Provide resumable analysis and a reviewable, versioned passport that separates sourced facts, assumptions, unknowns, and contradictions. Support claim approval, rejection, and prohibition; invalidate pending content affected by changed facts and preserve historical knowledge versions.
    requirements: [REQ-001]
    decisions: []
  - id: I-2
    title: Build the local workspace and interchangeable AI adapters
    summary: Establish the independent local workspace and adapters for installed Codex and Claude Code engines, including availability checks and engine selection. Preserve product knowledge and history across engine changes, support manual product entry when AI is unavailable, and isolate AI-process failures from the application. Provide navigation for attention items, products, channels, opportunities, publications, results, logs, and settings.
    requirements: [REQ-006]
    decisions: []
  - id: I-3
    title: Connect accounts and assess channel capabilities
    summary: Prototype browser operation on the selected Reddit subreddit and implement persistent account profiles, visible account identity, login handoff, and user takeover. Add prepared and universal connector interfaces with connection-specific capability assessment and validated, versioned declarative profiles. Assess reading, change detection, sending, rules, metrics, and result verification without test publications; serialize control of shared browser sessions.
    requirements: [REQ-002, REQ-004]
    decisions: [DEC-001]
  - id: I-4
    title: Monitor discussions and maintain deduplicated opportunities
    summary: Implement scheduled discussion collection, an initial baseline that excludes existing comments from automatic replies, and explicit selection of older discussions for processing. Deduplicate discovered comments, suppress automatic reply chains involving the account's own comments, and retain available conversation context and prior replies. Persist collection progress and expose channel-specific failures without interrupting other channels.
    requirements: [REQ-003, REQ-005]
    decisions: []
  - id: I-5
    title: Prepare contextual content and manage review queues
    summary: Implement observation, draft preparation, approval-required, and restricted automatic-response modes. Prepare replies using thread context, prior account replies, approved product knowledge, and channel rules; route ambiguous or sensitive requests to the user. Provide review queues for replies and standalone text, link, or image publications where supported. Bind approval to exact content, attachments, account, and destination, and invalidate it when those inputs or relevant product facts change.
    requirements: [REQ-001, REQ-003, REQ-004]
    decisions: []
  - id: I-6
    title: Enforce sending authorization and reconcile publication outcomes
    summary: Implement application-enforced authorization for all outgoing connector and browser actions, including restricted automatic replies. Before sending, recheck account access, thread state, existing replies, permissions, and aggregate channel and account limits. Persist each attempt, reconcile uncertain outcomes before allowing another attempt, and record confirmed identifiers or links, timestamps, content, knowledge versions, and authorization bases in inspectable action history.
    requirements: [REQ-003, REQ-004, REQ-005, REQ-006]
    decisions: []
  - id: I-7
    title: Implement background lifecycle, pause controls, and recovery
    summary: Implement persistent workflow scheduling and recovery across restart, sleep, and connection loss. Keep automation active after the last window closes, with accessible background status and pause controls; make Quit stop automation until manual relaunch and exclude automatic startup at login. Persist shutdown progress, recheck permissions on resumption, reconcile uncertain sends, suspend affected operations for expired sessions or CAPTCHA, and expose run times, statuses, and short results.
    requirements: [REQ-005]
    decisions: [DEC-003]
  - id: I-8
    title: Deliver platform results and validate the Reddit acceptance workflow
    summary: Provide inspectable promotion goals and available platform metrics, distinguishing unavailable values from zero without implying measured business conversions. Exclude business-event ingestion and analytics connections from v1. Validate the complete Natal Mystic workflow in one user-selected Reddit subreddit through actual authorized reading, activity detection, approved standalone publication, and replies with confirmed outcomes; verify persistence across restart and align README acceptance scope with the accepted Reddit decision.
    requirements: [REQ-002, REQ-006]
    decisions: [DEC-001, DEC-002, DEC-004]
updated: 2026-11-08
---

# Implementation plan — Product Promotion Desk

## I-1: Create and maintain approved product passports

Implement product creation from a URL or description, optional supporting materials, and scoped source-code analysis without executing project code. Provide resumable analysis and a reviewable, versioned passport that separates sourced facts, assumptions, unknowns, and contradictions. Support claim approval, rejection, and prohibition; invalidate pending content affected by changed facts and preserve historical knowledge versions.

Requirements: REQ-001

## I-2: Build the local workspace and interchangeable AI adapters

Establish the independent local workspace and adapters for installed Codex and Claude Code engines, including availability checks and engine selection. Preserve product knowledge and history across engine changes, support manual product entry when AI is unavailable, and isolate AI-process failures from the application. Provide navigation for attention items, products, channels, opportunities, publications, results, logs, and settings.

Requirements: REQ-006

## I-3: Connect accounts and assess channel capabilities

Prototype browser operation on the selected Reddit subreddit and implement persistent account profiles, visible account identity, login handoff, and user takeover. Add prepared and universal connector interfaces with connection-specific capability assessment and validated, versioned declarative profiles. Assess reading, change detection, sending, rules, metrics, and result verification without test publications; serialize control of shared browser sessions.

Requirements: REQ-002, REQ-004
Decisions: DEC-001

## I-4: Monitor discussions and maintain deduplicated opportunities

Implement scheduled discussion collection, an initial baseline that excludes existing comments from automatic replies, and explicit selection of older discussions for processing. Deduplicate discovered comments, suppress automatic reply chains involving the account's own comments, and retain available conversation context and prior replies. Persist collection progress and expose channel-specific failures without interrupting other channels.

Requirements: REQ-003, REQ-005

## I-5: Prepare contextual content and manage review queues

Implement observation, draft preparation, approval-required, and restricted automatic-response modes. Prepare replies using thread context, prior account replies, approved product knowledge, and channel rules; route ambiguous or sensitive requests to the user. Provide review queues for replies and standalone text, link, or image publications where supported. Bind approval to exact content, attachments, account, and destination, and invalidate it when those inputs or relevant product facts change.

Requirements: REQ-001, REQ-003, REQ-004

## I-6: Enforce sending authorization and reconcile publication outcomes

Implement application-enforced authorization for all outgoing connector and browser actions, including restricted automatic replies. Before sending, recheck account access, thread state, existing replies, permissions, and aggregate channel and account limits. Persist each attempt, reconcile uncertain outcomes before allowing another attempt, and record confirmed identifiers or links, timestamps, content, knowledge versions, and authorization bases in inspectable action history.

Requirements: REQ-003, REQ-004, REQ-005, REQ-006

## I-7: Implement background lifecycle, pause controls, and recovery

Implement persistent workflow scheduling and recovery across restart, sleep, and connection loss. Keep automation active after the last window closes, with accessible background status and pause controls; make Quit stop automation until manual relaunch and exclude automatic startup at login. Persist shutdown progress, recheck permissions on resumption, reconcile uncertain sends, suspend affected operations for expired sessions or CAPTCHA, and expose run times, statuses, and short results.

Requirements: REQ-005
Decisions: DEC-003

## I-8: Deliver platform results and validate the Reddit acceptance workflow

Provide inspectable promotion goals and available platform metrics, distinguishing unavailable values from zero without implying measured business conversions. Exclude business-event ingestion and analytics connections from v1. Validate the complete Natal Mystic workflow in one user-selected Reddit subreddit through actual authorized reading, activity detection, approved standalone publication, and replies with confirmed outcomes; verify persistence across restart and align README acceptance scope with the accepted Reddit decision.

Requirements: REQ-002, REQ-006
Decisions: DEC-001, DEC-002, DEC-004
