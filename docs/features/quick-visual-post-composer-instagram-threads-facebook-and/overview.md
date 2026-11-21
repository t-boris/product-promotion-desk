---
type: feature
id: quick-visual-post-composer-instagram-threads-facebook-and
title: Quick visual post composer (Instagram / Threads / Facebook) and a more colourful UI
status: resolved
owner: Boris Tsekinovsky
created: 2026-11-21
provenance: Created from the feature intake
understanding:
  Problem: known
  Target Users: known
  Primary Workflow: known
  Permissions: n/a
  Failure Scenarios: partial
  Data Model: known
  Notifications: n/a
  Security: known
  Analytics: n/a
  Dependencies: known
  Acceptance Criteria: partial
schema: 1
understanding_notes:
  Problem: Slow quick-picture posts and a dull UI.
  Target Users: The product owner creating posts.
  Primary Workflow: Channel picks the composer; template card or AI picture or own file; separate AI caption and picture actions; save as draft.
  Permissions: Single owner.
  Failure Scenarios: Search failure handled by requirement; other edge cases are for the implementer.
  Data Model: Goal from approved knowledge, no new fields.
  Notifications: Not relevant.
  Security: Nothing is published before approval.
  Analytics: Not relevant.
  Dependencies: AI browser (DEC-035) for trends, existing MakePicture and PostDrafter.
  Acceptance Criteria: Written in requirements; the review will refine them.
questions_left: 0
issue: "#45"
---

# Quick visual post composer (Instagram / Threads / Facebook) and a more colourful UI

## Idea

Besides the long "article" post (text mixed with pictures and video), the New publication screen gets a second post type: a quick single-picture post, like an Instagram or Threads post, made of one eye-catching picture plus a short caption. Choosing Instagram, Threads or Facebook as the channel shows a dedicated composer that makes such a post fast and colourful, and the owner can work out what the picture says and how it is worded. The request also asks for a visual refresh of the UI with more colour.

## Problem

Today every new post goes through one form built for long Markdown text. A short post whose main part is a striking picture is slow to make there: the picture is a separate step (library, path or a separate "Make a picture" panel) and the caption has a mandatory-looking title field. The owner also finds the current UI dull.

## Scope

In: a post type derived from the chosen channel (Instagram, Threads and Facebook show the quick-post composer; article channels show the existing form); a dedicated composer for the quick post (one picture, short caption, live platform preview); fast ways to get a gripping picture and a caption; saving as a draft through the existing flow (approval, channels, schedule); sending pictures to Instagram, Threads and Facebook where not yet supported (DEC-044, separate requirement with acceptance criteria per platform); a switchable theme system (several distinct dark and light themes, optional animated background) with the design system updated to describe themes. Out (unless the owner says otherwise): changing the approval flow and the rest of the publishing pipeline (only the picture-sending part is in scope, DEC-044), multi-picture carousels, video in quick posts, new platform connectors, editing already saved posts of the article type.

## Existing behaviour

- New publication form: AI 'Draft with AI' helper (title+text from a short 'what is it about?'), a Markdown editor with a side-by-side platform preview, picture block, optional link, and a 'Where to post' multi-channel picker. Saved as a draft per channel; nothing is published before approval. (`src/renderer/src/pages/review/PublicationForm.tsx`)
- PostDrafter writes the title and text with AI from approved product knowledge and the channel's rules; result goes into the form, with Undo. (`src/renderer/src/pages/review/PostDrafter.tsx`)
- MakePicture: the AI makes an image from a description the owner edits (AI proposes a start from the post); shapes square/wide/tall; each press makes a new candidate. (`src/renderer/src/pages/review/MakePicture.tsx`)
- DraftEditor holds title, text, link, attachments and markup; has a post mode (editor + preview + pictures) and a reply mode. (`src/renderer/src/pages/review/DraftEditor.tsx`)
- PostPreview already has a per-platform sketch, including an Instagram one (a picture over a caption, 'Instagram needs a picture'), and short-post sketches for Threads/X; platform can be switched. (`src/renderer/src/pages/review/PostPreview.tsx`)
- DEC-030: per-product picture library, Markdown posts, one render function for preview and sending; pictures went out only as a Reddit post until a later slice. DEC-035: the AI browser publishes in the account's browser, so pictures can go to any platform that takes them. (`docs/features/product-promotion-desk/decisions/DEC-030.md`)
- Visual system: restrained palette with ONE indigo accent used sparingly, one filled button per screen, AI controls never filled, red only for failures, amber for 'decide'. DEC-047 resolves the 'more colour' request: themes change only backgrounds, surfaces and the accent colour, while these semantic rules stay the same in every theme. (`docs/design/macos/visual-system.md`)
