// The pure logic of the AI helps of the quick-post composer (src/renderer/src/pages/review/quick/ai, REQ-004): which action each button offers or why it
// cannot, what each question to the core holds, what an answer that arrives late may still do, when Undo is honest, and what the owner is shown of an
// answer. The components are checked in the packaged build. The last block asks the REAL core with what these functions build, so the two layers cannot
// drift apart.

import { afterEach, describe, expect, it } from 'vitest'
import { quickTrendsSubject, type QuickAssessment, type QuickSuggestion, type QuickTrendsResult } from '../shared/quick-ai'
import type { QuickCard } from '../shared/quick-post'
import { answerFate } from '../renderer/src/assist/field-logic'
import { angleLine, captionAction, captionArgs, captionAround, captionBlockedReason, whereReason } from '../renderer/src/pages/review/quick/ai/caption-logic'
import { assessArgs, goalLine, marketerBlockedReason, pictureFacts, readingCurrent, readingOf, suggestionLabel, suggestionState, suggestionText, VERDICT_VIEW } from '../renderer/src/pages/review/quick/ai/marketer-logic'
import { appliedCard, cardUndoable, cardValue, pictureAction, pictureArgs, pictureAround, pictureSkippedNote, undoCard } from '../renderer/src/pages/review/quick/ai/picture-logic'
import { angleInUse, angleToUse, angleUsable, progressSubject, STILL_YOURS, trendsArgs, trendsBlockedReason, trendsFate, trendsSkippedNote, trendsView } from '../renderer/src/pages/review/quick/ai/trends-logic'
import { closeWorld, makeWorld, type World } from '../core/pipeline/test-fixture'

const card = (over: Partial<QuickCard> = {}): QuickCard => ({ style: 'bold', colour: 'indigo', shape: 'square', headline: 'Your chart in a minute', headlineEdited: false, ...over })
const post = { productId: 'p1', channelId: 'c1', platform: 'instagram', caption: 'Read your chart.', angle: '' }

describe('whereReason', () => {
  it('asks for a channel first, and refuses a platform that does not make a picture post', () => {
    expect(whereReason('instagram', 'writes')).toBeNull()
    expect(whereReason('threads', 'writes')).toBeNull()
    expect(whereReason('facebook', 'writes')).toBeNull()
    expect(whereReason(null, 'writes')).toBe('Choose where to post first, so the AI writes for that platform.')
    expect(whereReason('reddit', 'reads the post')).toBe('The AI reads the post for Instagram, Threads and Facebook only.')
  })
})

describe('the caption help', () => {
  it('writes an empty caption and improves a filled one', () => {
    expect(captionAction('')).toEqual({ kind: 'write', label: 'Write with AI' })
    expect(captionAction('  \n ')).toEqual({ kind: 'write', label: 'Write with AI' })
    expect(captionAction('Hello')).toEqual({ kind: 'improve', label: 'Improve with AI' })
    expect(captionBlockedReason(null)).toContain('Choose where to post first')
    expect(captionBlockedReason('instagram')).toBeNull()
  })

  it('asks with the wish of an improvement only, and with an angle or a headline only when there is one', () => {
    const base = { ...post, headline: '' }
    expect(captionArgs({ ...base, caption: '' }, 'shorter')).toEqual({ productId: 'p1', channelId: 'c1', platform: 'instagram', caption: '' })
    expect(captionArgs(base, '  shorter ')).toEqual({ productId: 'p1', channelId: 'c1', platform: 'instagram', caption: 'Read your chart.', wish: 'shorter' })
    expect(captionArgs(base, '   ')).not.toHaveProperty('wish')
    expect(captionArgs({ ...base, angle: ' Birth chart memes ', headline: ' Your chart ' }, '')).toMatchObject({ angle: 'Birth chart memes', headline: 'Your chart' })
    expect(captionArgs({ ...base, channelId: null }, '').channelId).toBeNull()
  })

  it('never sends a wish or an angle longer than the core takes', () => {
    const args = captionArgs({ ...post, headline: '', angle: 'a'.repeat(400) }, 'w'.repeat(400))
    expect(args.wish).toHaveLength(300)
    expect(args.angle).toHaveLength(300)
  })

  it('says which angle steers it, and nothing when there is none', () => {
    expect(angleLine('  Birth chart memes ')).toBe('Steered by your angle: Birth chart memes')
    expect(angleLine('  ')).toBeNull()
  })

  it('drops an answer for another channel or platform, and keeps the typing of the owner', () => {
    const asked = { value: 'Read it.', around: captionAround('c1', 'instagram') }
    expect(answerFate(asked, { value: 'Read it.', around: captionAround('c1', 'instagram'), locked: false })).toBe('apply')
    expect(answerFate(asked, { value: 'Read it now.', around: captionAround('c1', 'instagram'), locked: false })).toBe('typed')
    expect(answerFate(asked, { value: 'Read it.', around: captionAround('c2', 'threads'), locked: false })).toBe('draft_changed')
    expect(answerFate(asked, { value: 'Read it.', around: captionAround('c1', 'instagram'), locked: true })).toBe('locked')
    expect(captionAround('c1', 'instagram')).not.toBe(captionAround('c1', 'threads'))
  })
})

describe('the picture help', () => {
  it('offers the card, the illustration, and says why it cannot do anything for a file, for nothing, or without a channel', () => {
    expect(pictureAction('card', 'instagram', '')).toEqual({ ok: true, kind: 'card', label: 'Suggest a card with AI' })
    expect(pictureAction('illustration', 'instagram', '')).toEqual({ ok: true, kind: 'illustration', label: 'Suggest a description with AI' })
    expect(pictureAction('illustration', 'instagram', 'A night sky')).toEqual({ ok: true, kind: 'illustration', label: 'Improve the description with AI' })
    expect(pictureAction('file', 'instagram', '')).toEqual({ ok: false, hint: expect.stringContaining('does not change a picture you chose') })
    expect(pictureAction('none', 'instagram', '')).toEqual({ ok: false, hint: expect.stringContaining('Choose the card') })
    expect(pictureAction('card', null, '')).toEqual({ ok: false, hint: 'Choose where to post first, so the AI plans the picture for that platform.' })
  })

  it('asks for the card with its headline now, and for the illustration without one', () => {
    expect(pictureArgs(post, { kind: 'card' }, { headline: ' Your chart ', description: '' })).toEqual({ productId: 'p1', channelId: 'c1', platform: 'instagram', kind: 'card', caption: 'Read your chart.', headline: 'Your chart' })
    expect(pictureArgs({ ...post, angle: ' memes ' }, { kind: 'illustration' }, { headline: 'ignored', description: 'A night sky' })).toEqual({ productId: 'p1', channelId: 'c1', platform: 'instagram', kind: 'illustration', caption: 'Read your chart.', angle: 'memes' })
  })

  it('drops an answer when the owner changed the card, the channel or the kind of picture meanwhile', () => {
    const asked = { value: cardValue(card()), around: pictureAround('c1', 'instagram', 'card') }
    expect(answerFate(asked, { ...asked, locked: false })).toBe('apply')
    expect(answerFate(asked, { value: cardValue(card({ colour: 'ocean' })), around: asked.around, locked: false })).toBe('typed')
    expect(answerFate(asked, { value: cardValue(card({ headline: 'Mine', headlineEdited: true })), around: asked.around, locked: false })).toBe('typed')
    expect(answerFate(asked, { value: asked.value, around: pictureAround('c1', 'instagram', 'illustration'), locked: false })).toBe('draft_changed')
    expect(answerFate(asked, { value: asked.value, around: pictureAround('c2', 'threads', 'card'), locked: false })).toBe('draft_changed')
    // the shape is not the AI's to change, so changing it meanwhile does not drop the answer
    expect(cardValue(card({ shape: 'wide' }))).toBe(cardValue(card()))
    expect(cardValue(null)).toBe('null')
  })

  it('says why in words for each reason an answer was dropped', () => {
    expect(pictureSkippedNote('apply')).toBeNull()
    expect(pictureSkippedNote('typed')).toContain('You changed the picture while the AI was working')
    expect(pictureSkippedNote('draft_changed')).toContain('The post changed while the AI was working')
    expect(pictureSkippedNote('locked')).toContain('being saved')
  })

  it('undoes a used card while it still shows what the AI put on it, and gives the headline back to the caption when it followed it', () => {
    const before = card()
    const applied = appliedCard(before, { headline: 'Read your chart tonight', style: 'quote', colour: 'sunset' })
    const after = card({ headline: 'Read your chart tonight', headlineEdited: true, style: 'quote', colour: 'sunset' })
    expect(cardUndoable(after, applied)).toBe(true)
    expect(cardUndoable(card({ ...after, headline: 'Mine' }), applied)).toBe(false)
    expect(cardUndoable(card({ ...after, colour: 'ocean' }), applied)).toBe(false)
    expect(cardUndoable(null, applied)).toBe(false)
    expect(cardUndoable(after, null)).toBe(false)
    expect(undoCard(applied)).toEqual({ headline: null, look: { style: 'bold', colour: 'indigo' } })
    // a headline the owner had written is put back as written
    expect(undoCard(appliedCard(card({ headline: 'Mine', headlineEdited: true, style: 'minimal' }), { headline: 'X', style: 'bold', colour: 'ocean' }))).toEqual({ headline: 'Mine', look: { style: 'minimal', colour: 'indigo' } })
  })
})

describe('the trends help', () => {
  it('needs a channel, because the search runs in its account\'s browser', () => {
    expect(trendsBlockedReason(null, null)).toContain('Choose a channel first')
    expect(trendsBlockedReason('c1', 'reddit')).toBe('The AI searches for Instagram, Threads and Facebook only.')
    expect(trendsBlockedReason('c1', 'threads')).toBeNull()
  })

  it('asks with the wish only when there is one, never longer than the core takes', () => {
    expect(trendsArgs('p1', 'c1', '  ')).toEqual({ productId: 'p1', channelId: 'c1' })
    expect(trendsArgs('p1', 'c1', ' astrology memes ')).toEqual({ productId: 'p1', channelId: 'c1', wish: 'astrology memes' })
    expect(trendsArgs('p1', 'c1', 'x'.repeat(200)).wish).toHaveLength(120)
  })

  it('shows the progress of this channel\'s search only', () => {
    expect(progressSubject('c1')).toBe(quickTrendsSubject('c1'))
    expect(progressSubject(null)).toBeUndefined()
  })

  it('shows the topics and the angle first, and says when there is no angle', () => {
    const ready: QuickTrendsResult = { state: 'ready', topics: [{ topic: 'Birth chart memes', what: 'People joke.', url: null }], angle: { text: 'Show a real chart.', why: 'It takes topic 1.' }, searched: ['astrology', 'natal chart'], note: null }
    expect(trendsView(ready)).toEqual({ kind: 'topics', topics: ready.topics, angle: { text: 'Show a real chart.', why: 'It takes topic 1.' }, searched: 'Searched for: astrology, natal chart', note: null })
    expect(trendsView({ ...ready, angle: null, searched: [], note: 'The AI did not finish in time and was stopped. These are the topics found so far.' })).toMatchObject({ kind: 'topics', angle: null, searched: null, note: expect.stringContaining('topics found so far') })
  })

  it('says in words, and says the owner can go on, when the search could not run or did not finish', () => {
    for (const state of ['unavailable', 'needs_owner', 'failed'] as const) {
      expect(trendsView({ state, message: 'The AI browser is not available.' })).toEqual({ kind: 'message', state, tone: 'warn', text: `The AI browser is not available. ${STILL_YOURS}` })
    }
    // the owner stopped it: nothing to explain, nothing to excuse
    expect(trendsView({ state: 'stopped', message: 'You stopped the search. Nothing was changed.' })).toEqual({ kind: 'message', state: 'stopped', tone: 'neutral', text: 'You stopped the search. Nothing was changed.' })
  })

  it('drops the topics when the post goes to another channel by the time they arrive', () => {
    expect(trendsFate('c1', 'c1')).toBe('show')
    expect(trendsFate('c1', 'c2')).toBe('channel_changed')
    expect(trendsFate('c1', null)).toBe('channel_changed')
    expect(trendsSkippedNote('show')).toBeNull()
    expect(trendsSkippedNote('channel_changed')).toContain('You changed the channel while the AI was searching')
  })

  it('lets the owner use an angle they may have edited, one that is not empty and not longer than an angle', () => {
    expect(angleUsable('Show a real chart.')).toBe(true)
    expect(angleUsable('   ')).toBe(false)
    expect(angleUsable('x'.repeat(301))).toBe(false)
    expect(angleToUse('  Show a real chart.  ')).toBe('Show a real chart.')
    expect(angleInUse('Show a real chart.', ' Show a real chart. ')).toBe(true)
    expect(angleInUse('Show a real chart.', 'Show a chart.')).toBe(false)
    expect(angleInUse('', '')).toBe(false)
  })
})

describe('the marketer', () => {
  it('tells what the picture is: the card\'s words and look, the illustration\'s description, or only that a file exists', () => {
    expect(pictureFacts('card', card(), '')).toEqual({ kind: 'card', headline: 'Your chart in a minute', style: 'bold', colour: 'indigo' })
    expect(pictureFacts('card', card({ headline: '  ' }), '')).toEqual({ kind: 'none' })
    expect(pictureFacts('card', null, '')).toEqual({ kind: 'none' })
    expect(pictureFacts('illustration', null, ' A night sky ')).toEqual({ kind: 'illustration', description: 'A night sky' })
    expect(pictureFacts('illustration', null, '')).toEqual({ kind: 'none' })
    expect(pictureFacts('file', null, '')).toEqual({ kind: 'file' })
    expect(pictureFacts('none', card(), 'ignored')).toEqual({ kind: 'none' })
  })

  it('has nothing to read without a channel, or without a caption and a picture', () => {
    expect(marketerBlockedReason(null, 'x', { kind: 'file' })).toContain('Choose where to post first')
    expect(marketerBlockedReason('instagram', '  ', { kind: 'none' })).toBe('Write a caption or choose a picture first: there is nothing to read yet.')
    expect(marketerBlockedReason('instagram', 'Hello', { kind: 'none' })).toBeNull()
    expect(marketerBlockedReason('instagram', '', { kind: 'file' })).toBeNull()
  })

  it('asks with the picture facts and the angle when there is one', () => {
    expect(assessArgs(post, { kind: 'file' })).toEqual({ productId: 'p1', channelId: 'c1', platform: 'instagram', caption: 'Read your chart.', picture: { kind: 'file' } })
    expect(assessArgs({ ...post, angle: ' memes ' }, { kind: 'none' })).toMatchObject({ angle: 'memes' })
  })

  describe('a reading and what it may still change', () => {
    const asked = readingOf({ caption: 'Read your chart.', angle: '', channelId: 'c1', platform: 'instagram' }, 'card', card(), '')
    const captionSuggestion: QuickSuggestion = { kind: 'caption', caption: 'Better.', why: 'Clearer.' }
    const headlineSuggestion: QuickSuggestion = { kind: 'headline', headline: 'Better', why: 'Shorter.' }

    it('is current while nothing it was made from changed', () => {
      expect(readingCurrent(asked, { ...asked })).toBe(true)
      expect(readingCurrent(asked, { ...asked, caption: 'Read your chart!' })).toBe(false)
      expect(readingCurrent(asked, { ...asked, angle: 'memes' })).toBe(false)
      expect(readingCurrent(asked, { ...asked, platform: 'threads' })).toBe(false)
      expect(readingCurrent(asked, readingOf({ caption: 'Read your chart.', angle: '', channelId: 'c1', platform: 'instagram' }, 'illustration', null, 'A sky'))).toBe(false)
    })

    it('applies a caption suggestion only to the caption it was read from', () => {
      expect(suggestionState(captionSuggestion, asked, { ...asked })).toEqual({ usable: true })
      // the card changed: a caption suggestion does not depend on it
      expect(suggestionState(captionSuggestion, asked, { ...asked, headline: 'Mine' })).toEqual({ usable: true })
      expect(suggestionState(captionSuggestion, asked, { ...asked, caption: 'Typed since.' })).toEqual({ usable: false, reason: expect.stringContaining('The caption changed since this reading') })
    })

    it('applies a headline suggestion only to the card it was read from', () => {
      expect(suggestionState(headlineSuggestion, asked, { ...asked })).toEqual({ usable: true })
      expect(suggestionState(headlineSuggestion, asked, { ...asked, headline: 'Mine' })).toEqual({ usable: false, reason: expect.stringContaining('The card changed since this reading') })
      expect(suggestionState(headlineSuggestion, asked, { ...asked, source: 'illustration' })).toEqual({ usable: false, reason: expect.stringContaining('not the card any more') })
    })
  })

  it('words the verdicts, the goal it used and what it offers', () => {
    expect(VERDICT_VIEW).toEqual({
      on_goal: { label: 'On goal', tone: 'good' },
      partly: { label: 'Partly on goal', tone: 'warn' },
      off_goal: { label: 'Off goal', tone: 'bad' },
      unclear: { label: 'Goal unclear', tone: 'neutral' }
    })
    const used = { goal: 'Get people to try the natal chart.' } as QuickAssessment
    expect(goalLine(used)).toBe('Goal used: Get people to try the natal chart.')
    expect(goalLine({ goal: null })).toContain('does not say what this promotion is for')
    expect(suggestionLabel({ kind: 'caption', caption: 'x', why: 'y' })).toBe('Use this caption')
    expect(suggestionLabel({ kind: 'headline', headline: 'x', why: 'y' })).toBe('Use this headline')
    expect(suggestionText({ kind: 'caption', caption: 'Caption text', why: 'y' })).toBe('Caption text')
    expect(suggestionText({ kind: 'headline', headline: 'Headline text', why: 'y' })).toBe('Headline text')
  })
})

// ───────────────────────────── the two layers agree ─────────────────────────────

describe('what the interface asks, the core takes', () => {
  let world: World
  afterEach(async () => {
    await closeWorld(world)
  })

  const json = (o: Record<string, unknown>): string => JSON.stringify({ usedClaimIds: ['c1'], statesProductFacts: true, disclosesConnection: false, ...o })

  it('answers every question the interface builds, for every kind of picture and every platform it offers', async () => {
    world = makeWorld()
    const channel = world.addChannel({ platform: 'threads', reads: false, target: '@natalmystic', settings: { topics: ['astrology'], queries: [], languages: ['en'], style: '' } })
    const base = { productId: world.product.id, channelId: channel.id, platform: 'threads', caption: 'Your chart in a minute.', angle: ' Birth chart memes ' }
    world.engine.on('quick.caption', json({ caption: 'Your chart in a minute. #astrology' }))
    world.engine.on('quick.picture', json({ headline: 'Your chart', style: 'quote', colour: 'ocean', why: 'Short.' }))
    world.engine.on('quick.assess', JSON.stringify({ goal: 'Get people to try the natal chart.', goalClaimIds: ['c1'], verdict: 'partly', summary: 'Warm, but no next step.', points: [], suggestions: [] }))

    const call = (method: string, args: unknown): Promise<unknown> => world.core.router.call(method as never, args as never)
    expect(await call('quick.caption', captionArgs({ ...base, headline: 'Your chart' }, 'shorter'))).toEqual({ caption: 'Your chart in a minute. #astrology' })
    expect(await call('quick.picture', pictureArgs(base, { kind: 'card' }, { headline: 'Your chart', description: '' }))).toMatchObject({ kind: 'card', style: 'quote' })
    world.engine.on('quick.picture', json({ description: 'A night sky with a star chart.', why: 'It shows the app.' }))
    expect(await call('quick.picture', pictureArgs(base, { kind: 'illustration' }, { headline: '', description: '' }))).toMatchObject({ kind: 'illustration' })
    for (const facts of [pictureFacts('card', card(), ''), pictureFacts('illustration', null, 'A night sky'), pictureFacts('file', null, ''), pictureFacts('none', null, '')]) {
      expect(await call('quick.assess', assessArgs(base, facts))).toMatchObject({ verdict: 'partly', goal: 'Get people to try the natal chart.' })
    }
    // no search service is mounted: the core answers with a state in words, which the interface shows
    world.core.services.researchMissions = undefined
    expect(await call('quick.trends', trendsArgs(world.product.id, channel.id, ' astrology '))).toMatchObject({ state: 'unavailable' })
  })

  it('takes a post of any of the three platforms and no channel at all', async () => {
    world = makeWorld()
    world.engine.on('quick.caption', json({ caption: 'Your chart in a minute.' }))
    for (const platform of ['instagram', 'threads', 'facebook']) {
      expect(await world.core.router.call('quick.caption', captionArgs({ productId: world.product.id, channelId: null, platform, caption: '', angle: '', headline: '' }, ''))).toEqual({ caption: 'Your chart in a minute.' })
    }
  })
})
