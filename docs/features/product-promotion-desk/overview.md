---
type: feature
id: product-promotion-desk
title: Product Promotion Desk
status: exploring
owner: Boris Tsekinovsky
created: 2026-11-08
provenance: Created from the new-project intake
understanding:
  Problem: known
  Target Users: known
  Primary Workflow: known
  Permissions: known
  Failure Scenarios: known
  Data Model: known
  Notifications: partial
  Security: partial
  Analytics: partial
  Dependencies: partial
  Acceptance Criteria: known
understanding_notes:
  Problem: "Определены задачи продвижения и риски: несогласованные сведения, пропущенные обсуждения и повторные сообщения."
  Target Users: Владелец проекта и друзья; у каждого отдельная установка, данные и аккаунты.
  Primary Workflow: Определён путь от утверждения паспорта до подключения канала, наблюдения, подготовки, отправки и оценки результатов.
  Permissions: Приложение контролирует разрешения, согласования и лимиты; самостоятельные публикации требуют утверждения.
  Failure Scenarios: Описаны потеря доступа, CAPTCHA, изменения сайта, прерывания и неопределённый результат отправки.
  Data Model: Основные сущности, связи, версии знаний и история действий определены; внутреннюю модель уточнит реализация.
  Notifications: Предусмотрены уведомления и сводки; точные способы доставки и значения по умолчанию пока не определены.
  Security: Заданы границы доступа AI, исключение секретов, ручной вход и контроль отправки; детали защиты локальных данных требуют проработки.
  Analytics: Определены доступные метрики площадок и необязательные бизнес-события; конкретные подключения пока не выбраны.
  Dependencies: Выбраны установленные Codex или Claude Code и Reddit для первого сценария; работоспособность браузерного подхода ещё предстоит проверить прототипом.
  Acceptance Criteria: Обязательный сквозной сценарий закреплён за Reddit. Конкретный сабреддит выбирается пользователем; дополнительных ответов для фиксации замысла первой версии не требуется.
questions_left: 0
confirmed: 2026-11-08
---

# Product Promotion Desk

## Idea

Build a personal macOS application that helps users understand a product, discover relevant communities, prepare and approve promotional content, monitor discussions, and evaluate results using their installed Codex or Claude Code as the AI engine.

## Problem

Product promotion requires maintaining consistent product knowledge, finding suitable communities, following conversations, preparing context-aware responses, and tracking outcomes across separate accounts and websites. Manual coordination makes this work repetitive and creates risks of unsupported claims, missed conversations, and duplicate messages.

## Scope

In: a personal macOS application for the project owner and friends, each using an independent installation; Natal Mystic as the first product; approved product passports; channel discovery and onboarding; persistent browser accounts; capability assessment; scheduled monitoring; contextual replies; approval queues; restricted automatic replies; approved standalone publications; available platform metrics and optional business-event connections; logs and recovery. The proposed architecture uses Electron, TypeScript, React, and SQLite, with separate responsibilities for application state, scheduling, AI adapters, browser operation, connectors, authorization, analytics, and storage. Browser implementation remains subject to a real-site prototype. Out: video production and editing, arbitrary generated connector-code execution, automatic standalone publications, automatic handling of sensitive or ambiguous requests, and a shared multi-user service. The mandatory first platform remains open; universal onboarding guarantees only capabilities actually verified.
