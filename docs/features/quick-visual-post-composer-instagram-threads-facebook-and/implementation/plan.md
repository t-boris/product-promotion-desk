---
type: plan
feature: quick-visual-post-composer-instagram-threads-facebook-and
title: Quick visual post composer (Instagram / Threads / Facebook) and theme system
issues:
  - id: I-1
    title: "Draft data model: post-type field, card parameters and migration"
    summary: Add an explicit post-type field (article | quick post) and a structured card-parameters field (style, colour, shape, headline, headline-edited flag) to drafts. Write a migration that sets article on all existing drafts. Update the storage layer and every place that reads drafts. Saving a quick post must accept an empty title, with the caption stored in the text field.
    requirements: [REQ-001, REQ-002, REQ-003]
    decisions: [DEC-046, DEC-045]
  - id: I-2
    title: "Channel picker: derive post type from channel and block mixed kinds"
    summary: In the New publication form, classify channels as quick-post (Instagram, Threads, Facebook) or article. Choosing a channel of one kind disables the other kind and shows why. Several channels of the same kind can be picked together, and clearing all channels enables every channel again. The selected kind decides whether the quick-post composer or the existing article form is shown, and which post type is saved.
    requirements: [REQ-001]
    decisions: [DEC-038, DEC-041, DEC-046]
  - id: I-3
    title: Quick-post composer shell with live platform preview
    summary: "Build the quick-post composer: one picture slot, one caption field, no title, a caption length counter for the platform, and a live preview that reuses and extends the PostPreview sketches for Instagram, Threads and Facebook. Saving creates one quick-post draft per selected channel through the existing draft and approval flow."
    requirements: [REQ-002]
    decisions: [DEC-038, DEC-046, DEC-039]
  - id: I-4
    title: Template card renderer, PNG on save and re-editing
    summary: "Build a template card renderer: a large headline on a coloured background or gradient, with style, colour and shape picked by clicks and an instant preview. By default the headline follows the first line of the caption until the owner edits it. On save the card is rendered to a PNG, added to the product picture library and attached as the draft's single picture. Opening a saved card restores its parameters, and saving again after edits renders a new PNG. An AI illustration (MakePicture) or the owner's own file can replace the card, and in that case no card is rendered."
    requirements: [REQ-003, REQ-002]
    decisions: [DEC-037, DEC-045, DEC-046, DEC-030]
  - id: I-5
    title: Show quick posts correctly on review, approval and preview screens
    summary: Make the review, approval and preview screens pick their layout from the post-type field. Quick posts are shown as picture plus caption, and the first words of the caption replace the title wherever a label is needed. Existing article drafts look and behave as before.
    requirements: [REQ-002]
    decisions: [DEC-046]
  - id: I-6
    title: Picture sending to Instagram, Threads and Facebook
    summary: "First check, for each platform, whether an approved post with one picture and a caption is already sent correctly (connector or AI browser), and record the result. Then fill only the gaps, so that approved quick posts are published with their picture on Instagram, Threads and Facebook. Acceptance criteria are written per platform. Only picture sending changes: the approval flow and the rest of the pipeline stay as they are."
    requirements: [REQ-002]
    decisions: [DEC-044, DEC-030, DEC-035]
  - id: I-7
    title: "AI help in the composer: caption, picture idea, trend analyst and marketer"
    summary: "Add separate AI actions for the caption (adapted from PostDrafter) and for the picture (MakePicture), with no one-shot action. Add a trend-analyst action that runs only when the owner asks: it searches through the AI browser, shows that the search is running and shows the topics or angle it found. If the search fails or is unavailable, a clear message appears and the owner can carry on without trends. Add a marketer assessment that checks the caption and picture against the goal taken from approved product knowledge, with no new fields. The AI never overwrites content without an action from the owner, and Undo is available."
    requirements: [REQ-004]
    decisions: [DEC-039, DEC-042, DEC-043, DEC-035]
  - id: I-8
    title: Theme system with selectable dark and light themes
    summary: Add theme tokens that change only backgrounds, surfaces and the accent colour. Ship at least two dark and two light themes with distinct character. The theme is chosen in Settings and the choice is kept. Semantic colour rules stay fixed in every theme (red, amber, AI controls never filled, one filled accent button per screen), and contrast is checked for each theme. Add an optional animated background that is off by default and turns off when macOS 'reduce motion' is on. Update visual-system.md with the palette of each theme.
    requirements: [REQ-005]
    decisions: [DEC-036, DEC-047]
updated: 2026-11-21
schema: 1
---

# Implementation plan — Quick visual post composer (Instagram / Threads / Facebook) and a more colourful UI

## I-1: Draft data model: post-type field, card parameters and migration

Add an explicit post-type field (article | quick post) and a structured card-parameters field (style, colour, shape, headline, headline-edited flag) to drafts. Write a migration that sets article on all existing drafts. Update the storage layer and every place that reads drafts. Saving a quick post must accept an empty title, with the caption stored in the text field.

Requirements: REQ-001, REQ-002, REQ-003
Decisions: DEC-046, DEC-045

## I-2: Channel picker: derive post type from channel and block mixed kinds

In the New publication form, classify channels as quick-post (Instagram, Threads, Facebook) or article. Choosing a channel of one kind disables the other kind and shows why. Several channels of the same kind can be picked together, and clearing all channels enables every channel again. The selected kind decides whether the quick-post composer or the existing article form is shown, and which post type is saved.

Requirements: REQ-001
Decisions: DEC-038, DEC-041, DEC-046

## I-3: Quick-post composer shell with live platform preview

Build the quick-post composer: one picture slot, one caption field, no title, a caption length counter for the platform, and a live preview that reuses and extends the PostPreview sketches for Instagram, Threads and Facebook. Saving creates one quick-post draft per selected channel through the existing draft and approval flow.

Requirements: REQ-002
Decisions: DEC-038, DEC-046, DEC-039

## I-4: Template card renderer, PNG on save and re-editing

Build a template card renderer: a large headline on a coloured background or gradient, with style, colour and shape picked by clicks and an instant preview. By default the headline follows the first line of the caption until the owner edits it. On save the card is rendered to a PNG, added to the product picture library and attached as the draft's single picture. Opening a saved card restores its parameters, and saving again after edits renders a new PNG. An AI illustration (MakePicture) or the owner's own file can replace the card, and in that case no card is rendered.

Requirements: REQ-003, REQ-002
Decisions: DEC-037, DEC-045, DEC-046, DEC-030

## I-5: Show quick posts correctly on review, approval and preview screens

Make the review, approval and preview screens pick their layout from the post-type field. Quick posts are shown as picture plus caption, and the first words of the caption replace the title wherever a label is needed. Existing article drafts look and behave as before.

Requirements: REQ-002
Decisions: DEC-046

## I-6: Picture sending to Instagram, Threads and Facebook

First check, for each platform, whether an approved post with one picture and a caption is already sent correctly (connector or AI browser), and record the result. Then fill only the gaps, so that approved quick posts are published with their picture on Instagram, Threads and Facebook. Acceptance criteria are written per platform. Only picture sending changes: the approval flow and the rest of the pipeline stay as they are.

Requirements: REQ-002
Decisions: DEC-044, DEC-030, DEC-035

## I-7: AI help in the composer: caption, picture idea, trend analyst and marketer

Add separate AI actions for the caption (adapted from PostDrafter) and for the picture (MakePicture), with no one-shot action. Add a trend-analyst action that runs only when the owner asks: it searches through the AI browser, shows that the search is running and shows the topics or angle it found. If the search fails or is unavailable, a clear message appears and the owner can carry on without trends. Add a marketer assessment that checks the caption and picture against the goal taken from approved product knowledge, with no new fields. The AI never overwrites content without an action from the owner, and Undo is available.

Requirements: REQ-004
Decisions: DEC-039, DEC-042, DEC-043, DEC-035

## I-8: Theme system with selectable dark and light themes

Add theme tokens that change only backgrounds, surfaces and the accent colour. Ship at least two dark and two light themes with distinct character. The theme is chosen in Settings and the choice is kept. Semantic colour rules stay fixed in every theme (red, amber, AI controls never filled, one filled accent button per screen), and contrast is checked for each theme. Add an optional animated background that is off by default and turns off when macOS 'reduce motion' is on. Update visual-system.md with the palette of each theme.

Requirements: REQ-005
Decisions: DEC-036, DEC-047
