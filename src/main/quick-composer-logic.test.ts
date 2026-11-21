// The quick-post composer's rules (REQ-001..REQ-003): which kind the ticked channels make and what cannot be ticked, the caption limit, when the
// headline follows the caption, when the picture is a card, what a save sends, how the card is laid out and drawn, and what the platforms take of
// the picture. The composer lives in src/renderer/src/pages/review/quick/*; the renderer has no test runner of its own, and these modules import
// only src/shared (and each other), so they are tested from here, without a screen and without a canvas.

import { describe, expect, it } from 'vitest'
import { CARD_HEADLINE_MAX, CARD_PIXELS, CARD_COLOURS, CARD_SHAPES, CARD_STYLES, DEFAULT_CARD, captionLabel, cardHeadline, headlineFromCaption, postTypeOfPlatform } from '../shared/quick-post'
import { pictureProblems } from '../shared/post-pictures'
import { renderForPlatform } from '../shared/post-format'
import type { Attachment, Draft, GroupChannelOption } from '../shared/types'
import { draftInputOf, groupTitle, saveIntent, whereRows } from '../renderer/src/pages/review/post-group'
import { rowSummary } from '../renderer/src/pages/inbox/inbox-groups'
import { buildPostRows, titleOf } from '../renderer/src/pages/posts/posts-filter'
import { headingOf, nameOf, ownPostSummary } from '../renderer/src/pages/review/quick/labels'
import type { OpportunityCard, PostGroupCard } from '../shared/types'
import { hasContent } from '../renderer/src/pages/review/approve-check'
import { blockedChannels, chosenPlatforms, distinctPlatforms, kindOfChannels, type KindRow } from '../renderer/src/pages/review/quick/kinds'
import { captionCounter, tightestLimit } from '../renderer/src/pages/review/quick/limits'
import {
  CARD_TO_DRAW,
  CHOOSE_A_PICTURE,
  cardAttachment,
  pictureSourceOf,
  withAngle,
  withIllustrationWish,
  withLook,
  WRITE_A_CAPTION,
  WRITE_A_HEADLINE,
  HEADLINE_TOO_LONG,
  clampHeadline,
  cardFileName,
  drawnCard,
  emptyQuickForm,
  followCaption,
  isCardPicture,
  needsNewCard,
  quickDirty,
  quickFormOf,
  quickInput,
  quickQuestion,
  quickReason,
  quickSignature,
  chooseCard,
  choosePicture,
  withCaption,
  withColour,
  withHeadline,
  withShape,
  withStyle
} from '../renderer/src/pages/review/quick/quick-form'
import { CARD_PALETTES, contrastRatio, leastContrast } from '../renderer/src/pages/review/quick/card-colours'
import { STYLE_SPECS, fontOf, layoutCard, withEllipsis, wrapLines, type Measure } from '../renderer/src/pages/review/quick/card-layout'
import { drawCard, type CardContext, type CardGradient } from '../renderer/src/pages/review/quick/draw-card'
import { MADE_PIXELS, factsOfCard, factsOfMedia, pictureCheck, shapeHint } from '../renderer/src/pages/review/quick/picture-check'
import { previewContent, previewPlatformOf } from '../renderer/src/pages/review/quick/preview-model'
import { savePlan, saveReason } from '../renderer/src/pages/review/quick/save-plan'

// ───────────────────────────── the ticked channels decide the kind ─────────────────────────────

const rows: KindRow[] = [
  { channelId: 'ig', platform: 'instagram' },
  { channelId: 'th', platform: 'threads' },
  { channelId: 'fb', platform: 'facebook' },
  { channelId: 'rd', platform: 'reddit' },
  { channelId: 'li', platform: 'linkedin' }
]

describe('the post type follows the channels', () => {
  it('reads the kind of the ticked channels, and an empty choice as the article form', () => {
    expect(kindOfChannels(['instagram'])).toBe('quick')
    expect(kindOfChannels(['threads', 'facebook'])).toBe('quick')
    expect(kindOfChannels(['reddit'])).toBe('article')
    expect(kindOfChannels(['reddit', 'linkedin'])).toBe('article')
    expect(kindOfChannels([])).toBe('article')
  })

  it('names the platform of a tick from the list, or from the screen\'s own channel before the list has arrived', () => {
    expect(chosenPlatforms(rows, ['ig', 'th'])).toEqual(['instagram', 'threads'])
    expect(chosenPlatforms(undefined, ['ig'], { channelId: 'ig', platform: 'instagram' })).toEqual(['instagram'])
    expect(chosenPlatforms(rows, ['gone'])).toEqual([])
  })

  it('blocks the other kind in the picker with a visible reason, and never a channel that is ticked', () => {
    const blocked = blockedChannels(rows, ['ig'])
    expect(Object.keys(blocked).sort()).toEqual(['li', 'rd'])
    expect(blocked.rd).toMatch(/article and a picture post cannot go together/i)
    expect(blocked.ig).toBeUndefined()
    // Several channels of one kind may be ticked together.
    expect(blockedChannels(rows, ['ig', 'th'])).toEqual({ rd: blocked.rd, li: blocked.li })
    // And the other way round: an article blocks the picture posts, with the matching words.
    const article = blockedChannels(rows, ['rd'])
    expect(Object.keys(article).sort()).toEqual(['fb', 'ig', 'th'])
    expect(article.ig).toMatch(/picture post and an article cannot go together/i)
    expect(article.rd).toBeUndefined()
  })

  it('offers every channel again once all are unticked', () => {
    expect(blockedChannels(rows, [])).toEqual({})
    expect(blockedChannels(undefined, ['ig'])).toEqual({})
  })

  it('agrees with the shared rule on which platforms are quick', () => {
    for (const row of rows) {
      const other = rows.find((r) => postTypeOfPlatform(r.platform) !== postTypeOfPlatform(row.platform))
      expect(blockedChannels(rows, [row.channelId])[other!.channelId]).toBeDefined()
    }
  })

  it('lists each platform once for the preview, in the order of the ticks', () => {
    expect(distinctPlatforms(['threads', 'instagram', 'threads'])).toEqual(['threads', 'instagram'])
  })

  it('keeps the save intent of the picker: one tick is one post, two or more are a group', () => {
    const options: GroupChannelOption[] = rows.slice(0, 3).map((r) => ({ channelId: r.channelId, platform: r.platform, target: '@x', accountLabel: 'a', fits: true, reason: '', suggested: false }))
    const list = whereRows(options, ['ig', 'th'])
    expect(saveIntent(['ig'], list)).toEqual({ kind: 'single', channelId: 'ig' })
    expect(saveIntent(['ig', 'th'], list)).toEqual({ kind: 'group', channelIds: ['ig', 'th'] })
  })
})

// ───────────────────────────── the caption limit ─────────────────────────────

describe('the caption limit', () => {
  it('is the tightest of the platforms ticked', () => {
    expect(tightestLimit(['instagram'])).toEqual({ limit: 2200, platform: 'instagram' })
    expect(tightestLimit(['instagram', 'threads', 'facebook'])).toEqual({ limit: 500, platform: 'threads' })
    expect(tightestLimit([])).toEqual({ limit: null, platform: null })
  })

  it('counts against it, says whose limit it is when several are ticked, and turns over when it is passed', () => {
    const one = captionCounter('hello', ['threads'])
    expect(one).toMatchObject({ used: 5, limit: 500, over: false, label: '5 / 500 characters', whose: null })
    const several = captionCounter('x'.repeat(501), ['instagram', 'threads'])
    expect(several.over).toBe(true)
    expect(several.whose).toMatch(/Threads takes the least/)
    expect(captionCounter('x'.repeat(500), ['threads']).over).toBe(false)
  })

  it('counts a letter that is made of several code points as one character, as the platforms do', () => {
    expect(captionCounter('a😀b', ['threads']).used).toBe(3)
  })
})

// ───────────────────────────── the form ─────────────────────────────

const upload: Attachment = { name: 'lighthouse.png', path: '/data/media/lighthouse.png', mime: 'image/png', sha256: 'aa', mediaId: 'm1' }
const drawn: Attachment = { name: 'card-x.png', path: '/data/media/card-x.png', mime: 'image/png', sha256: 'bb', mediaId: 'm-card' }

function saved(over: Partial<Draft> = {}): Draft {
  return {
    id: 'd1',
    opportunityId: 'o1',
    title: null,
    text: 'First line of the caption\nand more.',
    link: null,
    attachments: [drawn],
    markup: 'legacy',
    postType: 'quick',
    card: { style: 'bold', colour: 'indigo', shape: 'square', headline: 'First line of the caption', headlineEdited: false },
    knowledgeVersionId: null,
    usedClaimLineageIds: [],
    rationale: '',
    author: 'user',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...over
  }
}

describe('the headline of the card', () => {
  it('follows the first line of the caption until the owner edits it', () => {
    let form = emptyQuickForm()
    form = withCaption(form, 'Mercury is in retrograde\nBe kind to your phone.')
    expect(drawnCard(form).headline).toBe('Mercury is in retrograde')
    form = withCaption(form, 'Mercury is in retrograde again')
    expect(drawnCard(form).headline).toBe('Mercury is in retrograde again')
    expect(form.card.headlineEdited).toBe(false)
  })

  it('never follows again once the owner typed in its own field, whatever the caption becomes', () => {
    let form = withCaption(emptyQuickForm(), 'Caption one')
    form = withHeadline(form, 'My own words')
    expect(form.card).toMatchObject({ headline: 'My own words', headlineEdited: true })
    form = withCaption(form, 'A completely different caption')
    expect(drawnCard(form).headline).toBe('My own words')
    // An emptied field is still the owner's: the card has no headline, it does not quietly take the caption's.
    form = withHeadline(form, '')
    expect(drawnCard(form).headline).toBe('')
  })

  it('can be given back to the caption', () => {
    let form = withHeadline(withCaption(emptyQuickForm(), 'Caption one'), 'Mine')
    form = followCaption(form)
    expect(form.card.headlineEdited).toBe(false)
    expect(drawnCard(form).headline).toBe('Caption one')
  })

  it('is the same rule the shared contract states', () => {
    const form = withCaption(emptyQuickForm(), '  \n  Second line is first\nthird')
    expect(drawnCard(form).headline).toBe(headlineFromCaption(form.caption))
    expect(drawnCard(form).headline).toBe(cardHeadline(form.card, form.caption))
  })

  it('does not change with the style, colour or shape', () => {
    let form = withCaption(emptyQuickForm(), 'Same words')
    form = withShape(withColour(withStyle(form, 'quote'), 'berry'), 'wide')
    expect(form.card).toMatchObject({ style: 'quote', colour: 'berry', shape: 'wide' })
    expect(drawnCard(form).headline).toBe('Same words')
  })
})

describe('when the picture is a card', () => {
  it('is the card by default, and the owner\'s own picture only once one is chosen', () => {
    expect(isCardPicture(emptyQuickForm())).toBe(true)
    const own = choosePicture(emptyQuickForm(), upload)
    expect(isCardPicture(own)).toBe(false)
    expect(isCardPicture(chooseCard(own))).toBe(true)
    // Going back to the card does not lose the picture that was chosen.
    expect(chooseCard(own).picture).toEqual(upload)
  })

  it('sends the card parameters with the drawn picture, a caption in text and no title', () => {
    const form = withColour(withCaption(emptyQuickForm(), '  Mercury is in retrograde  '), 'ocean')
    const input = quickInput(form, drawn)
    expect(input).toEqual({
      title: null,
      text: 'Mercury is in retrograde',
      link: null,
      attachments: [drawn],
      markup: 'legacy',
      postType: 'quick',
      card: { style: 'bold', colour: 'ocean', shape: 'square', headline: 'Mercury is in retrograde', headlineEdited: false }
    })
  })

  it('sends no card with a picture of the owner\'s own: one attachment and card null', () => {
    const input = quickInput(choosePicture(withCaption(emptyQuickForm(), 'Look at this'), upload))
    expect(input.card).toBeNull()
    expect(input.attachments).toEqual([upload])
    expect(input.postType).toBe('quick')
    expect(input.title).toBeNull()
  })

  it('always holds exactly one picture, the card standing for itself until it is drawn', () => {
    expect(quickInput(withCaption(emptyQuickForm(), 'x')).attachments).toEqual([CARD_TO_DRAW])
    expect(quickInput(emptyQuickForm(), drawn).attachments).toHaveLength(1)
    expect(quickInput(choosePicture(emptyQuickForm(), null)).attachments).toEqual([])
  })

  it('asks the channels about the words and the picture, never about the colours of the card', () => {
    const a = quickQuestion(withCaption(emptyQuickForm(), 'Hello'))
    const b = quickQuestion(withShape(withColour(withCaption(emptyQuickForm(), 'Hello'), 'forest'), 'wide'))
    expect(a).toEqual(b)
    expect(a.card).toBeUndefined()
    expect(a.postType).toBe('quick')
    expect(a.attachments).toHaveLength(1)
  })

  it('needs a new card when a saved post has none, and when the card would look different', () => {
    const form = quickFormOf(saved())
    expect(needsNewCard(form, saved())).toBe(false)
    expect(needsNewCard(withColour(form, 'berry'), saved())).toBe(true)
    expect(needsNewCard(withShape(form, 'portrait'), saved())).toBe(true)
    expect(needsNewCard(withStyle(form, 'minimal'), saved())).toBe(true)
    // The headline follows the caption, so a new first line is a new card; a later line is not.
    expect(needsNewCard(withCaption(form, 'Another first line'), saved())).toBe(true)
    expect(needsNewCard(withCaption(form, 'First line of the caption\nand a changed second line.'), saved())).toBe(false)
    // An own headline holds the card still while the caption changes.
    const own = quickFormOf(saved({ card: { style: 'bold', colour: 'indigo', shape: 'square', headline: 'Mine', headlineEdited: true } }))
    expect(needsNewCard(withCaption(own, 'Anything else'), saved({ card: { style: 'bold', colour: 'indigo', shape: 'square', headline: 'Mine', headlineEdited: true } }))).toBe(false)
    // A new post, a saved post whose picture is not a card, and a picture of the owner's own.
    expect(needsNewCard(emptyQuickForm(), null)).toBe(true)
    expect(needsNewCard(form, saved({ card: null }))).toBe(true)
    expect(needsNewCard(choosePicture(form, upload), saved())).toBe(false)
  })

  it('draws a card with no change of the picture the owner did not touch (no new PNG for a caption edit past the headline)', () => {
    const form = withCaption(quickFormOf(saved()), 'First line of the caption\nand a new second line.')
    expect(needsNewCard(form, saved())).toBe(false)
    expect(quickDirty(form, saved())).toBe(true)
  })
})

describe('restoring a saved quick post', () => {
  it('restores the style, colour, shape and headline of a card, and the caption', () => {
    const form = quickFormOf(saved({ card: { style: 'quote', colour: 'sunset', shape: 'wide', headline: 'Mine', headlineEdited: true } }))
    expect(form.caption).toBe('First line of the caption\nand more.')
    expect(form.card).toEqual({ style: 'quote', colour: 'sunset', shape: 'wide', headline: 'Mine', headlineEdited: true })
    expect(isCardPicture(form)).toBe(true)
  })

  it('restores the picture of a post that has none as a card, and an own picture as it was', () => {
    const own = quickFormOf(saved({ card: null, attachments: [upload] }))
    expect(isCardPicture(own)).toBe(false)
    expect(own.picture).toEqual(upload)
    expect(quickInput(own).card).toBeNull()
  })

  it('is not changed until the owner changes something, and is changed by a new colour, a new picture or a new caption', () => {
    const form = quickFormOf(saved())
    expect(quickDirty(form, saved())).toBe(false)
    expect(quickDirty(withColour(form, 'graphite'), saved())).toBe(true)
    expect(quickDirty(choosePicture(form, upload), saved())).toBe(true)
    expect(quickDirty(withCaption(form, 'Different'), saved())).toBe(true)
    // Blank space at the ends of the caption is not a change (it is trimmed when it is saved).
    expect(quickDirty(withCaption(form, '  First line of the caption\nand more.  '), saved())).toBe(false)
  })

  it('gives the empty form for no draft and for an article, so a title never shows up as a caption', () => {
    expect(quickFormOf(null)).toEqual(emptyQuickForm())
    expect(quickFormOf(saved({ postType: 'article', title: 'A title', card: null }))).toEqual(emptyQuickForm())
  })

  it('keeps a link the saved post has', () => {
    const form = quickFormOf(saved({ link: 'https://example.com' }))
    expect(quickInput(form, drawn).link).toBe('https://example.com')
  })
})

describe('what stops a save', () => {
  it('asks for a caption on an empty card, and a headline on a card that was emptied', () => {
    expect(quickReason(emptyQuickForm())).toBe(WRITE_A_CAPTION)
    expect(quickReason(withCaption(emptyQuickForm(), 'Words'))).toBeNull()
    expect(quickReason(withHeadline(withCaption(emptyQuickForm(), 'Words'), ''))).toBe(WRITE_A_HEADLINE)
  })

  it('asks for a picture when the owner went to their own and chose none, and allows a picture with no words', () => {
    expect(quickReason(choosePicture(emptyQuickForm(), null))).toBe(CHOOSE_A_PICTURE)
    expect(quickReason(choosePicture(emptyQuickForm(), upload))).toBeNull()
  })

  it('puts the post\'s own lack before the channels\', and reports the channels when the post is fine', () => {
    const none = { kind: 'none', reason: 'Choose where to post.' } as const
    expect(saveReason(emptyQuickForm(), none)).toBe(WRITE_A_CAPTION)
    expect(saveReason(withCaption(emptyQuickForm(), 'Words'), none)).toBe('Choose where to post.')
    expect(saveReason(withCaption(emptyQuickForm(), 'Words'), { kind: 'single', channelId: 'ig' })).toBeNull()
  })
})

describe('what a save sends', () => {
  const draft = quickInput(withCaption(emptyQuickForm(), 'Words'), drawn)

  it('is the post of the channel for one tick, and one post for all of them for several', () => {
    expect(savePlan({ kind: 'single', channelId: 'ig' }, 'p1', draft)).toEqual({ method: 'publications.create', args: { channelId: 'ig', draft } })
    expect(savePlan({ kind: 'group', channelIds: ['ig', 'th'] }, 'p1', draft)).toEqual({ method: 'postGroups.create', args: { productId: 'p1', channelIds: ['ig', 'th'], draft } })
  })

  it('sends the same quick draft either way, and nothing when the ticks cannot be saved', () => {
    const single = savePlan({ kind: 'single', channelId: 'ig' }, 'p1', draft)
    const group = savePlan({ kind: 'group', channelIds: ['ig', 'th'] }, 'p1', draft)
    expect(single?.args.draft).toBe(group?.args.draft)
    expect(single?.args.draft).toMatchObject({ postType: 'quick', title: null, text: 'Words', markup: 'legacy' })
    expect(savePlan({ kind: 'none', reason: 'Choose where to post.' }, 'p1', draft)).toBeNull()
  })
})

describe('the name of a card in the library', () => {
  it('is made of the first words of the headline and is safe as a file name', () => {
    expect(cardFileName('Mercury is in retrograde: be kind to your phone!')).toBe('card-mercury-is-in-retrograde-be.png')
    expect(cardFileName('')).toBe('card.png')
    expect(cardFileName('../../etc/passwd')).toBe('card-etc-passwd.png')
    expect(cardFileName('Кот в сапогах')).toBe('card-кот-в-сапогах.png')
  })
})

// ───────────────────────────── the preview ─────────────────────────────

describe('the live preview', () => {
  it('keeps the platform the owner picked while it is still ticked, else the first of the channels', () => {
    expect(previewPlatformOf('threads', ['instagram', 'threads'])).toBe('threads')
    expect(previewPlatformOf('threads', ['instagram'])).toBe('instagram')
    expect(previewPlatformOf(null, ['facebook', 'instagram'])).toBe('facebook')
    expect(previewPlatformOf('threads', [])).toBeNull()
  })

  it('shows the caption as the words, no title, one picture, and the card as live until it is saved', () => {
    const { content, live } = previewContent(withCaption(emptyQuickForm(), 'Words'))
    expect(content).toMatchObject({ title: null, text: 'Words', markup: 'legacy', postType: 'quick' })
    expect(content.attachments).toHaveLength(1)
    expect(live).toBe(true)
    const own = previewContent(choosePicture(withCaption(emptyQuickForm(), 'Words'), upload))
    expect(own.live).toBe(false)
    expect(own.content.attachments).toEqual([upload])
  })

  it('is laid out by the platform exactly as it is sent: the caption in the text, never the card\'s headline', () => {
    const { content } = previewContent(withCaption(emptyQuickForm(), 'Line one\nLine two'))
    const rendered = renderForPlatform(content, 'instagram')
    expect(rendered.title).toBeNull()
    expect(rendered.text).toBe('Line one\nLine two')
    expect(rendered.attachments).toHaveLength(1)
    expect(rendered.problems).toEqual([])
  })

  it('says an Instagram post needs a picture when the owner went to their own and chose none', () => {
    const { content } = previewContent(choosePicture(withCaption(emptyQuickForm(), 'Words'), null))
    expect(renderForPlatform(content, 'instagram').problems.join(' ')).toMatch(/needs a picture/i)
  })
})

// ───────────────────────────── what the platforms take of the picture ─────────────────────────────

describe('the picture check', () => {
  it('lets every card shape and every shape the AI makes through Instagram, the narrowest of the platforms', () => {
    for (const shape of CARD_SHAPES) expect(pictureCheck(['instagram', 'threads', 'facebook'], factsOfCard(shape))).toEqual([])
    for (const pixels of Object.values(MADE_PIXELS)) expect(pictureCheck(['instagram'], { mime: 'image/png', bytes: 1_000_000, ...pixels })).toEqual([])
  })

  it('says what Instagram refuses of a picture of the owner\'s own: a shape outside 4:5 to 1.91:1, a type, a size', () => {
    const tall = pictureCheck(['instagram'], factsOfMedia({ mime: 'image/png', bytes: 1000, width: 1000, height: 2000 }))
    expect(tall.join(' ')).toMatch(/taller than Instagram takes/)
    const wide = pictureCheck(['instagram'], factsOfMedia({ mime: 'image/png', bytes: 1000, width: 3000, height: 1000 }))
    expect(wide.join(' ')).toMatch(/wider than Instagram takes/)
    expect(pictureCheck(['instagram'], factsOfMedia({ mime: 'image/gif', bytes: 1000, width: 1000, height: 1000 })).join(' ')).toMatch(/PNG or JPEG/)
    // Facebook has no ratio rule: the same tall picture passes there.
    expect(pictureCheck(['facebook'], factsOfMedia({ mime: 'image/png', bytes: 1000, width: 1000, height: 2000 }))).toEqual([])
  })

  it('is the check the approval uses, said once however many channels share a platform', () => {
    const facts = factsOfMedia({ mime: 'image/png', bytes: 1000, width: 1000, height: 2000 })
    expect(pictureCheck(['instagram', 'instagram'], facts)).toEqual(pictureProblems('instagram', facts))
  })

  it('tells the owner in plain words what Instagram takes, and says nothing when no ticked platform limits the shape', () => {
    expect(shapeHint(['instagram', 'threads'])).toMatch(/Instagram only takes pictures from 4:5 \(tall\) to 1\.91:1 \(wide\)/)
    expect(shapeHint(['threads', 'facebook'])).toBeNull()
    expect(shapeHint([])).toBeNull()
  })
})

// ───────────────────────────── the card: layout ─────────────────────────────

/** A plain rule for the width of a text: every letter is half as wide as the type is high, so a layout can be checked without a canvas. */
const fake: Measure = (text, font) => {
  const size = Number(/(\d+)px/.exec(font)?.[1] ?? 10)
  return Array.from(text).length * size * 0.5
}

describe('wrapping the headline', () => {
  const font = '40px sans-serif'
  it('breaks lines between words, none wider than the box, and loses no word', () => {
    const text = 'Mercury is in retrograde so be kind to your phone and to yourself'
    const lines = wrapLines(text, 400, font, fake)
    expect(lines.length).toBeGreaterThan(1)
    for (const line of lines) expect(fake(line, font)).toBeLessThanOrEqual(400)
    expect(lines.join(' ')).toBe(text)
  })

  it('breaks a word wider than a line by letter, and never splits a letter made of several code points', () => {
    const lines = wrapLines('Supercalifragilisticexpialidocious 😀😀😀😀', 200, font, fake)
    for (const line of lines) expect(fake(line, font)).toBeLessThanOrEqual(200)
    expect(lines.join('').replace(/ /g, '')).toBe('Supercalifragilisticexpialidocious😀😀😀😀')
  })

  it('collapses blank space and gives no lines for no words', () => {
    expect(wrapLines('  a   b\n c ', 1000, font, fake)).toEqual(['a b c'])
    expect(wrapLines('   ', 1000, font, fake)).toEqual([])
  })
})

describe('laying out the card', () => {
  it('uses the whole card of its shape, and the largest type for a short headline', () => {
    for (const shape of CARD_SHAPES) {
      const layout = layoutCard('Hi', 'bold', shape, fake)
      expect(layout).toMatchObject({ width: CARD_PIXELS[shape].width, height: CARD_PIXELS[shape].height, fontSize: STYLE_SPECS.bold.maxFont, truncated: false })
    }
  })

  it('shrinks the type as the headline grows, never below the smallest, and keeps every line on the card', () => {
    const sizes = [10, 40, 80, 140].map((n) => layoutCard('word '.repeat(n).trim(), 'bold', 'square', fake).fontSize)
    for (let i = 1; i < sizes.length; i++) expect(sizes[i]).toBeLessThanOrEqual(sizes[i - 1])
    expect(sizes[0]).toBeGreaterThan(sizes[3])
    for (const style of CARD_STYLES) {
      for (const shape of CARD_SHAPES) {
        const layout = layoutCard('The headline of a card that is somewhat long and wraps over a few lines, '.repeat(2), style, shape, fake)
        const spec = STYLE_SPECS[style]
        expect(layout.fontSize).toBeGreaterThanOrEqual(spec.minFont)
        for (const line of layout.lines) {
          expect(fake(line.text, layout.font)).toBeLessThanOrEqual(layout.width * (1 - 2 * spec.margin) + 0.001)
          expect(line.y - layout.lineHeight / 2).toBeGreaterThanOrEqual(0)
          expect(line.y + layout.lineHeight / 2).toBeLessThanOrEqual(layout.height)
        }
      }
    }
  })

  it('cuts the end with an ellipsis, and says so, when even the smallest type cannot hold the headline', () => {
    const long = Array.from({ length: 140 }, (_, i) => `w${i}`).join(' ')
    const layout = layoutCard(long, 'bold', 'wide', (text, font) => fake(text, font) * 2.4)
    expect(layout.truncated).toBe(true)
    expect(layout.lines.at(-1)?.text.endsWith('…')).toBe(true)
    expect(layout.fontSize).toBe(STYLE_SPECS.bold.minFont)
  })

  it('differs by style: bold sits left, quote sits in the middle with its mark, minimal sits low with its bar', () => {
    const bold = layoutCard('Hello there', 'bold', 'square', fake)
    const quote = layoutCard('Hello there', 'quote', 'square', fake)
    const minimal = layoutCard('Hello there', 'minimal', 'square', fake)
    expect(bold.align).toBe('left')
    expect(bold.mark).toBeNull()
    expect(bold.rule).toBeNull()
    expect(quote.align).toBe('center')
    expect(quote.lines[0].x).toBe(quote.width / 2)
    expect(quote.mark).not.toBeNull()
    expect(minimal.align).toBe('left')
    expect(minimal.rule).not.toBeNull()
    // The minimal headline sits in the lower half, the bold one around the middle.
    expect(minimal.lines[0].y).toBeGreaterThan(minimal.height / 2)
    expect(Math.abs(bold.lines[0].y - bold.height / 2)).toBeLessThan(bold.height * 0.2)
    // The bar sits above the lines it belongs to.
    expect(minimal.rule!.y).toBeLessThan(minimal.lines[0].y)
  })

  it('lays out an empty headline as no lines, and the same headline the same way every time', () => {
    expect(layoutCard('   ', 'bold', 'square', fake).lines).toEqual([])
    expect(layoutCard('', 'minimal', 'wide', fake).rule).toBeNull()
    expect(layoutCard('Same words', 'quote', 'portrait', fake)).toEqual(layoutCard('Same words', 'quote', 'portrait', fake))
  })

  it('sets the type in the system font stack with the weight of its style, and uses no font that has to be downloaded', () => {
    for (const style of CARD_STYLES) {
      const font = fontOf(style, 64)
      expect(font).toContain('64px')
      expect(font).toContain(String(STYLE_SPECS[style].weight))
      expect(font).toMatch(/system-ui|ui-serif/)
    }
  })
})

// ───────────────────────────── the card: colours and drawing ─────────────────────────────

describe('the colours of the card', () => {
  it('has a gradient for every name the contract allows, and none for another', () => {
    expect(Object.keys(CARD_PALETTES).sort()).toEqual([...CARD_COLOURS].sort())
  })

  it('keeps white ink readable on every stop of every gradient (WCAG AA for text, 4.5)', () => {
    for (const colour of CARD_COLOURS) expect(leastContrast(colour), colour).toBeGreaterThanOrEqual(4.5)
  })

  it('measures contrast the way WCAG does', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0)
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5)
  })
})

interface Call {
  op: string
  args: unknown[]
  fillStyle?: unknown
  font?: string
  alpha?: number
}

/** A canvas stand-in that records what is drawn and with which state. */
function recorder(): { ctx: CardContext; calls: Call[]; gradients: { args: number[]; stops: [number, string][] }[] } {
  const calls: Call[] = []
  const gradients: { args: number[]; stops: [number, string][] }[] = []
  const state = { fillStyle: '' as unknown, font: '', textAlign: 'start', textBaseline: 'alphabetic', globalAlpha: 1 }
  const saved: (typeof state)[] = []
  const log = (op: string, ...args: unknown[]): void => void calls.push({ op, args, fillStyle: state.fillStyle, font: state.font, alpha: state.globalAlpha })
  const ctx: CardContext = {
    get fillStyle() {
      return state.fillStyle
    },
    set fillStyle(value) {
      state.fillStyle = value
    },
    get font() {
      return state.font
    },
    set font(value) {
      state.font = value
    },
    get textAlign() {
      return state.textAlign
    },
    set textAlign(value) {
      state.textAlign = value
    },
    get textBaseline() {
      return state.textBaseline
    },
    set textBaseline(value) {
      state.textBaseline = value
    },
    get globalAlpha() {
      return state.globalAlpha
    },
    set globalAlpha(value) {
      state.globalAlpha = value
    },
    createLinearGradient: (...args) => {
      const gradient: CardGradient & { stops: [number, string][] } = { stops: [], addColorStop(offset, colour) { this.stops.push([offset, colour]) } }
      gradients.push({ args, stops: gradient.stops })
      return gradient
    },
    fillRect: (...args) => log('fillRect', ...args),
    fillText: (...args) => log('fillText', ...args),
    beginPath: () => log('beginPath'),
    arc: (...args) => log('arc', ...args),
    fill: () => log('fill'),
    save: () => void saved.push({ ...state }),
    restore: () => void Object.assign(state, saved.pop())
  }
  return { ctx, calls, gradients }
}

describe('drawing the card', () => {
  it('fills the whole card with the gradient of its colour, from corner to corner', () => {
    for (const colour of CARD_COLOURS) {
      const layout = layoutCard('Hello', 'bold', 'portrait', fake)
      const { ctx, calls, gradients } = recorder()
      drawCard(ctx, layout, colour)
      expect(gradients[0].args).toEqual([0, 0, 1080, 1350])
      expect(gradients[0].stops.map(([, c]) => c)).toEqual([...CARD_PALETTES[colour].stops])
      expect(gradients[0].stops.map(([o]) => o)).toEqual([0, 0.5, 1])
      expect(calls[0]).toMatchObject({ op: 'fillRect', args: [0, 0, 1080, 1350] })
    }
  })

  it('writes every line of the headline where the layout put it, in the ink of the colour and the font of the layout', () => {
    const layout = layoutCard('Mercury is in retrograde so be kind to your phone and to yourself', 'bold', 'square', fake)
    const { ctx, calls } = recorder()
    drawCard(ctx, layout, 'ocean')
    const texts = calls.filter((c) => c.op === 'fillText')
    expect(texts.map((c) => c.args)).toEqual(layout.lines.map((l) => [l.text, l.x, l.y]))
    for (const t of texts) {
      expect(t.fillStyle).toBe(CARD_PALETTES.ocean.ink)
      expect(t.font).toBe(layout.font)
      expect(t.alpha).toBe(1)
    }
  })

  it('draws the mark of each style and nothing else: a circle for bold, a quiet quotation mark for quote, a bar for minimal', () => {
    const run = (style: 'bold' | 'quote' | 'minimal') => {
      const { ctx, calls } = recorder()
      drawCard(ctx, layoutCard('Hello there', style, 'square', fake), 'indigo')
      return calls
    }
    expect(run('bold').some((c) => c.op === 'arc')).toBe(true)
    expect(run('quote').some((c) => c.op === 'arc')).toBe(false)
    const mark = run('quote').find((c) => c.op === 'fillText' && c.args[0] === '“')
    expect(mark?.alpha).toBeLessThan(1)
    expect(run('minimal').filter((c) => c.op === 'fillRect')).toHaveLength(2)
    expect(run('bold').filter((c) => c.op === 'fillRect')).toHaveLength(1)
  })

  it('draws a card with no headline as a plain background', () => {
    const { ctx, calls } = recorder()
    drawCard(ctx, layoutCard('', 'bold', 'wide', fake), 'graphite')
    expect(calls.filter((c) => c.op === 'fillText')).toEqual([])
    expect(calls[0]).toMatchObject({ op: 'fillRect', args: [0, 0, 1080, 566] })
  })

  it('draws the same card identically each time, at the pixels of its shape', () => {
    const once = recorder()
    const twice = recorder()
    for (const r of [once, twice]) drawCard(r.ctx, layoutCard('Same', 'quote', 'wide', fake), 'berry')
    // The gradient is an object of its own each time; what is drawn with it is compared by its stops.
    const plain = (calls: Call[]) => calls.map((c) => ({ ...c, fillStyle: typeof c.fillStyle === 'object' ? 'gradient' : c.fillStyle }))
    expect(plain(once.calls)).toEqual(plain(twice.calls))
    expect(once.gradients).toEqual(twice.gradients)
    expect(DEFAULT_CARD.shape).toBe('square')
  })
})

// ───────────────────────────── what a save keeps of the card, and what the helps share ─────────────────────────────

describe('the label of the caption counter', () => {
  it('says in words how many characters are over, and nothing about it while the caption fits', () => {
    expect(captionCounter('x'.repeat(503), ['threads']).label).toBe('503 / 500 characters (3 over)')
    expect(captionCounter('x'.repeat(500), ['threads']).label).toBe('500 / 500 characters')
    expect(captionCounter('x'.repeat(2500), ['instagram']).label).toBe('2,500 / 2,200 characters (300 over)')
  })
})

describe('which picture a save sends', () => {
  it('draws no card for the owner\'s own picture, and asks for one for a card nobody has drawn', () => {
    expect(cardAttachment(choosePicture(emptyQuickForm(), upload), null)).toBeUndefined()
    expect(cardAttachment(withCaption(emptyQuickForm(), 'Hello'), null)).toEqual(CARD_TO_DRAW)
  })

  it('keeps the saved picture while the card is what it was, and asks for a new one the moment the card would look different', () => {
    const form = quickFormOf(saved())
    expect(cardAttachment(form, saved())).toEqual(drawn)
    // The caption is no part of the picture: a word changed after the headline does not draw it again.
    expect(cardAttachment(withCaption(form, 'First line of the caption\nand much more.'), saved())).toEqual(drawn)
    expect(cardAttachment(withColour(form, 'ocean'), saved())).toEqual(CARD_TO_DRAW)
    expect(cardAttachment(withShape(form, 'wide'), saved())).toEqual(CARD_TO_DRAW)
    expect(cardAttachment(withStyle(form, 'quote'), saved())).toEqual(CARD_TO_DRAW)
    expect(cardAttachment(withHeadline(form, 'Another headline'), saved())).toEqual(CARD_TO_DRAW)
  })
})

describe('the look of the card as a helper sets it', () => {
  it('sets the style, the colour and the shape that are given and keeps the others', () => {
    const form = emptyQuickForm()
    expect(withLook(form, { colour: 'berry' }).card).toMatchObject({ style: form.card.style, colour: 'berry', shape: form.card.shape })
    expect(withLook(form, { style: 'minimal', shape: 'wide' }).card).toMatchObject({ style: 'minimal', colour: form.card.colour, shape: 'wide' })
    expect(withLook(form, {})).toEqual(form)
  })
})

describe('what the helps keep with the form', () => {
  it('holds the angle and the description of an illustration, apart from what is saved', () => {
    const form = withIllustrationWish(withAngle(withCaption(emptyQuickForm(), 'Caption'), 'Retrograde season'), 'A lighthouse at dusk')
    expect(form.angle).toBe('Retrograde season')
    expect(form.illustrationWish).toBe('A lighthouse at dusk')
    // Neither is a part of the post: the question, the save and the changed-or-not test never see them.
    const plain = withCaption(emptyQuickForm(), 'Caption')
    expect(quickSignature(form)).toBe(quickSignature(plain))
    expect(quickInput(form, drawn)).toEqual(quickInput(plain, drawn))
    expect(quickQuestion(form)).toEqual(quickQuestion(plain))
  })

  it('starts empty for a saved post, as for a new one', () => {
    expect(quickFormOf(saved())).toMatchObject({ angle: '', illustrationWish: '' })
    expect(quickFormOf(null)).toMatchObject({ angle: '', illustrationWish: '' })
  })

  it('tells the helps what the picture is: the card, a picture the owner has, or none yet', () => {
    expect(pictureSourceOf(emptyQuickForm())).toBe('card')
    expect(pictureSourceOf(choosePicture(emptyQuickForm(), upload))).toBe('file')
    expect(pictureSourceOf(choosePicture(emptyQuickForm(), null))).toBe('illustration')
    expect(pictureSourceOf(chooseCard(choosePicture(emptyQuickForm(), upload)))).toBe('card')
  })
})

// ───────────────────────────── screens choose by the type of the post (REQ-002) ─────────────────────────────

describe('naming a post by its type', () => {
  const quick = { postType: 'quick' as const, title: null, text: 'Why does every astrology app ask for your birth time?\nIt changes your chart.' }
  const article = { postType: 'article' as const, title: 'Launch day', text: 'Body text of the article' }

  it('names a quick post by the first words of its caption, and an article by its title', () => {
    expect(nameOf(quick)).toBe('Why does every astrology app ask for your…')
    expect(nameOf(article)).toBe('Launch day')
    expect(nameOf({ postType: 'article', title: null, text: 'Just text here' })).toBe('Just text here')
  })

  it('never reads the title of a quick post, even when one is there', () => {
    expect(nameOf({ ...quick, title: 'A stray title' })).toBe(nameOf(quick))
  })

  it('gives a list the bold line of a post and says when the line already is all of the caption', () => {
    expect(headingOf(article)).toEqual({ heading: 'Launch day', repeats: false })
    expect(headingOf({ postType: 'article', title: null, text: 'No title' })).toEqual({ heading: null, repeats: false })
    expect(headingOf(quick)).toEqual({ heading: 'Why does every astrology app ask for your…', repeats: false })
    expect(headingOf({ postType: 'quick', title: null, text: 'Short caption' })).toEqual({ heading: 'Short caption', repeats: true })
    expect(headingOf({ postType: 'quick', title: null, text: '   ' })).toEqual({ heading: null, repeats: false })
  })

  it('gives a closed review card its one line, with the old fallbacks for an article', () => {
    expect(ownPostSummary(null)).toBe('New publication')
    expect(ownPostSummary(quick)).toBe(nameOf(quick))
    expect(ownPostSummary(article)).toBe('Launch day')
    expect(ownPostSummary({ postType: 'article', title: null, text: 'Body only' })).toBe('Body only')
    expect(ownPostSummary({ postType: 'article', title: null, text: '' })).toBe('New publication')
    expect(ownPostSummary({ postType: 'quick', title: null, text: '' })).toBe('New publication')
  })
})

function cardOf(draft: Partial<Draft> | null, over: Partial<{ id: string; kind: string; state: string }> = {}): OpportunityCard {
  return {
    opportunity: { id: over.id ?? 'o1', channelId: 'ig', productId: 'p1', kind: over.kind ?? 'standalone', state: over.state ?? 'draft', scheduledAt: null, updatedAt: '2026-11-01T00:00:00.000Z', reason: '', groupId: null },
    channelTarget: '@astro_daily',
    channelPlatform: 'instagram',
    draft: draft === null ? null : { ...saved(), ...draft },
    comment: null,
    discussion: null,
    lastAction: null
  } as unknown as OpportunityCard
}

describe('the posts list names a post by its type', () => {
  it('names a quick post by its caption and never as an empty draft, whatever its title says', () => {
    expect(titleOf(cardOf({ title: null, text: 'Mercury is in retrograde again' }))).toBe('Mercury is in retrograde again')
    expect(titleOf(cardOf({ title: null, text: '', attachments: [drawn] }))).toBe('Picture post')
    expect(titleOf(cardOf({ title: 'A stray title', text: 'The real caption' }))).toBe('The real caption')
  })

  it('names an article exactly as before: its title, else the first line, else its fallbacks', () => {
    const article = (over: Partial<Draft>) => cardOf({ postType: 'article', card: null, attachments: [], ...over })
    expect(titleOf(article({ title: '  Launch day  ', text: 'x' }))).toBe('Launch day')
    expect(titleOf(article({ title: null, text: '\n  First line\nSecond' }))).toBe('First line')
    expect(titleOf(article({ title: null, text: '' }))).toBe('Empty draft')
    expect(titleOf(article({ title: null, text: '', attachments: [drawn] }))).toBe('Picture post')
  })

  it('finds a quick post by the headline on its card as well as by its caption', () => {
    const rows = buildPostRows([cardOf({ text: 'Caption words', card: { style: 'bold', colour: 'indigo', shape: 'square', headline: 'Zodiac secrets', headlineEdited: true } })], [])
    expect(rows).toHaveLength(1)
    expect(rows[0].haystack).toContain('zodiac secrets')
    expect(rows[0].haystack).toContain('caption words')
  })

  it('names a group of quick posts by its caption', () => {
    const version = cardOf({ text: 'One caption for all', title: null }, { id: 'v1' })
    const group = { group: { id: 'g1', productId: 'p1', master: { title: null, text: 'One caption for all', link: null, attachments: [drawn], markup: 'legacy', postType: 'quick', card: saved().card }, createdAt: '2026-11-01T00:00:00.000Z' }, versions: [{ card: version, problems: [], edited: false, way: 'connector' }] } as unknown as PostGroupCard
    expect(groupTitle(group.group)).toBe('One caption for all')
    // A quick post has no title: one that is there by accident is never what names it.
    expect(groupTitle({ ...group.group, master: { ...group.group.master, title: 'A stray title' } })).toBe('One caption for all')
    expect(buildPostRows([], [group])[0].title).toBe('One caption for all')
    expect(groupTitle({ ...group.group, master: { ...group.group.master, postType: 'article', card: null, title: null, text: '' } })).toBe('Post for several channels')
  })
})

describe('a row of the inbox names a post by its type', () => {
  it('shows a quick post by its caption, and an article by its title, with the old fallback', () => {
    expect(rowSummary(cardOf({ title: null, text: 'Mercury is in retrograde again and again and again' })).who).toBe('Mercury is in retrograde again and again and…')
    expect(rowSummary(cardOf({ title: null, text: '' })).who).toBe('Picture post')
    expect(rowSummary(cardOf({ postType: 'article', card: null, title: 'Launch day', text: 'x' })).who).toBe('Launch day')
    expect(rowSummary(cardOf({ postType: 'article', card: null, title: null, text: 'x' })).who).toBe('New post')
  })

  it('keeps the author of a comment for a reply', () => {
    const reply = { ...cardOf({ postType: 'article', card: null }, { kind: 'reply' }), comment: { author: 'ann', body: 'Nice' } } as unknown as OpportunityCard
    expect(rowSummary(reply).who).toBe('ann')
  })
})

describe('the other channels of a post, by its kind', () => {
  it('offers the channels of the kind a saved post is, and refuses the others with the reason', () => {
    const own: KindRow = { channelId: 'ig', platform: 'instagram' }
    // The post's own channel is ticked from the start (it is not offered again); the rows are the others, as the panel gets them.
    const others = rows.filter((r) => r.channelId !== 'ig')
    const blocked = blockedChannels(others, ['ig'], own)
    expect(Object.keys(blocked).sort()).toEqual(['li', 'rd'])
    expect(blocked.rd).toMatch(/cannot go together/)
    expect(blockedChannels(others, ['ig', 'th'], own)).toEqual(blocked)
    // An article's own channel blocks the picture channels instead.
    expect(Object.keys(blockedChannels(rows.filter((r) => r.channelId !== 'rd'), ['rd'], { channelId: 'rd', platform: 'reddit' })).sort()).toEqual(['fb', 'ig', 'th'])
  })

  it('asks the core about a saved quick post as one, so a channel is judged by the rules of a quick post', () => {
    const input = draftInputOf(saved())
    expect(input).toMatchObject({ postType: 'quick', title: null, card: saved().card })
    expect(draftInputOf(saved({ postType: 'article', card: null, title: 'T' }))).not.toHaveProperty('postType')
  })
})

// ───────────────────────────── a headline the core would refuse, and a letter made of many code points ─────────────────────────────

describe('a headline longer than the core stores', () => {
  const long = 'x'.repeat(CARD_HEADLINE_MAX + 40)

  it('is stopped in the field at the limit, counting an emoji as one character', () => {
    const typed = withHeadline(withCaption(emptyQuickForm(), 'Caption'), long)
    expect([...typed.card.headline]).toHaveLength(CARD_HEADLINE_MAX)
    expect(typed.card.headlineEdited).toBe(true)
    expect(clampHeadline('😀'.repeat(CARD_HEADLINE_MAX + 5))).toBe('😀'.repeat(CARD_HEADLINE_MAX))
    expect(clampHeadline('short')).toBe('short')
  })

  it('also blocks the save when a longer one reaches the form some other way, before anything is drawn or added to the library', () => {
    const form = { ...withCaption(emptyQuickForm(), 'Caption'), card: { ...DEFAULT_CARD, headline: long, headlineEdited: true } }
    expect(quickReason(form)).toBe(HEADLINE_TOO_LONG)
    const atTheLimit = { ...form, card: { ...form.card, headline: 'x'.repeat(CARD_HEADLINE_MAX) } }
    expect(quickReason(atTheLimit)).toBeNull()
    // The owner's own picture has no headline to refuse.
    expect(quickReason({ ...form, source: 'picture', picture: { name: 'a.png', path: '/a.png', mime: 'image/png', sha256: 'a', mediaId: 'm' } })).toBeNull()
  })
})

describe('breaking and cutting a headline never splits a letter the owner sees as one', () => {
  const family = '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}\u200D\u{1F466}'
  const font = '40px sans-serif'

  it('breaks a long word of emoji sequences between the sequences', () => {
    const lines = wrapLines(family.repeat(5), 200, font, fake)
    expect(lines.length).toBeGreaterThan(1)
    for (const line of lines) {
      expect(line.length % family.length).toBe(0)
      expect(line.startsWith('\u200D')).toBe(false)
    }
    expect(lines.join('')).toBe(family.repeat(5))
  })

  it('keeps a letter with its combining mark when it breaks a word', () => {
    const word = 'e\u0301'.repeat(30)
    const lines = wrapLines(word, 100, font, fake)
    for (const line of lines) expect(line.startsWith('\u0301')).toBe(false)
    expect(lines.join('')).toBe(word)
  })

  it('does not leave half a sequence before the ellipsis when the last line is cut', () => {
    // Three sequences are 420 wide at this type; 250 holds one of them and the ellipsis, not two (300) and not 11 of their 21 code points.
    const cut = withEllipsis(family.repeat(3), 250, font, fake)
    expect(cut).toBe(`${family}…`)
    const layout = layoutCard(`${family.repeat(60)}`, 'bold', 'wide', fake)
    expect(layout.truncated).toBe(true)
    const body = layout.lines[layout.lines.length - 1].text.slice(0, -1)
    expect(body.length % family.length).toBe(0)
  })
})

// ───────────────────────────── the review screens hold a saved quick post to the composer's rules ─────────────────────────────

describe('a saved card post whose caption changed without the owner (the group\'s "Adapt with AI")', () => {
  const stored = saved({ postType: 'quick', title: null, text: 'Launch day\nWe are live.', markup: 'legacy', card: { style: 'bold', colour: 'sunset', shape: 'portrait', headline: 'Launch day', headlineEdited: false }, attachments: [{ name: 'card-launch-day.png', path: '/c.png', mime: 'image/png', sha256: 'c', mediaId: 'm1' }] })

  it('is not changed while the headline is still the first line of its caption', () => {
    expect(quickDirty(quickFormOf(stored), stored)).toBe(false)
  })

  it('is changed once the caption starts with other words, because the card on file says the old ones: it is offered for saving and drawn again', () => {
    // The draft the adaptation saved: a new caption on the card parameters (and the picture) of the old one.
    const adapted = { ...stored, text: 'Mercury turns retrograde\nWe are live.' }
    expect(needsNewCard(quickFormOf(adapted), adapted)).toBe(true)
    expect(quickDirty(quickFormOf(adapted), adapted)).toBe(true)
  })

  it('stays unchanged for a headline that is the owner\'s own, and for the owner\'s own picture', () => {
    const own = { ...stored, text: 'Other words', card: { ...stored.card!, headlineEdited: true } }
    expect(quickDirty(quickFormOf(own), own)).toBe(false)
    const picture = { ...stored, card: null, text: 'Other words' }
    expect(quickDirty(quickFormOf(picture), picture)).toBe(false)
  })
})

describe('what stops Save and Approve on the review screens', () => {
  const input = { text: 'caption', attachments: [{ name: 'a.png', path: '/a.png', mime: 'image/png', sha256: 'a', mediaId: 'm' }] }

  it('is the composer\'s own reason: a card with the headline cleared cannot be approved, though its stand-in picture is there', () => {
    const cleared = { ...withCaption(emptyQuickForm(), 'caption'), card: { ...DEFAULT_CARD, headline: '', headlineEdited: true } }
    expect(quickReason(cleared)).toBe(WRITE_A_HEADLINE)
    expect(hasContent(input, quickReason(cleared))).toBe(false)
    expect(hasContent(input, null)).toBe(true)
  })

  it('still needs some text, a link or a picture when nothing else stops it', () => {
    expect(hasContent({ text: '  ' }, null)).toBe(false)
    expect(hasContent({ text: '', link: 'https://x.dev' }, null)).toBe(true)
  })

  it('stops an own-picture post whose picture was not chosen', () => {
    const none = { ...withCaption(emptyQuickForm(), 'caption'), source: 'picture' as const }
    expect(quickReason(none)).toBe(CHOOSE_A_PICTURE)
  })
})

describe('"Also post to…" asks the kind of the post, not of its channel (DEC-041)', () => {
  const rows: KindRow[] = [
    { channelId: 'rd', platform: 'reddit' },
    { channelId: 'ig', platform: 'instagram' }
  ]
  it('keeps an old article in a Facebook channel an article: Reddit may be added, Instagram may not', () => {
    const own: KindRow = { channelId: 'fb', platform: 'facebook', type: 'article' }
    const blocked = blockedChannels(rows, ['fb'], own)
    expect(blocked.rd).toBeUndefined()
    expect(blocked.ig).toMatch(/picture post and an article cannot go together/i)
  })
  it('reads a picture post in a Facebook channel as before: Reddit is refused', () => {
    expect(blockedChannels(rows, ['fb'], { channelId: 'fb', platform: 'facebook', type: 'quick' }).rd).toBeDefined()
    expect(blockedChannels(rows, ['fb'], { channelId: 'fb', platform: 'facebook' }).rd).toBeDefined()
  })
})

describe('a label is short even without spaces to cut at', () => {
  it('cuts a caption of one long word and leaves a short one whole', () => {
    const label = captionLabel('x'.repeat(300))
    expect([...label]).toHaveLength(81)
    expect(label.endsWith('…')).toBe(true)
    expect(captionLabel('short label')).toBe('short label')
    expect(captionLabel('a'.repeat(80))).toBe('a'.repeat(80))
  })
})

describe('the preview offers each platform once', () => {
  it('names two Instagram channels once', () => {
    expect(distinctPlatforms(['instagram', 'instagram', 'threads'])).toEqual(['instagram', 'threads'])
  })
})
