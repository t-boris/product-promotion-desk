// One step of the browser agent (DEC-017), done the way a person's hands would: a real mouse click at the element's centre and real
// keystrokes, because a site tells a person's input from a script's. A script is the fallback when the tab cannot take real input or the
// text did not land. Refuses a page outside `hosts`.
//
// The same code serves every back end of the browser service (the built-in Electron page and the installed Chrome): what differs is only
// how a mouse press, a key or a file reaches the page, so that is all a driver has to say. The host check, the vocabulary of the steps and
// their wording are in one place.

import { stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import type { PageStep, PageStepResult } from '../core/ports'
import { cursorAtScript, cursorScript, fileInputByRefScript, locateScript, markOptionScript, mouseSeenScript, mouseWatchScript, prepareTypingScript, scriptClickScript, scrollIntoViewScript, scrollStateScript, selectOptionScript, setValueScript, typedScript, typingGuardScript, type ActionResult, type LocatedElement, type ScrollState } from './page-scripts'

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024

/** What a back end has to be able to do to a page. Every call is on the one page the agent works in. */
export interface StepDriver {
  /** The address of the page now, for the host check; '' when no page is loaded. */
  currentUrl(): string
  /** Evaluates a script in the page (never as a user gesture) and returns its JSON-serializable result. */
  read<T>(script: string): Promise<T>
  /** A real key press on the focused element: down, the character when there is one, up. */
  pressKey(key: 'Enter' | 'Tab' | 'Escape'): Promise<void>
  /** A real mouse move to a point of the page (the page sees the pointer arrive, as it does for a person). */
  mouseMove(x: number, y: number): Promise<void>
  /** A real mouse press and release where the pointer is, with a short hold in between (`holdMs`). */
  mouseClick(x: number, y: number): Promise<void>
  /** One turn of the mouse wheel over a point: `dy` pixels, positive down. */
  wheel(x: number, y: number, dy: number): Promise<void>
  /** Puts the page in front for the input that follows and types the text into the focused element, as the browser's own text insertion. */
  insertText(text: string): Promise<void>
  /** Brings the page's window to a state that takes input (focus); called before a click or typing. */
  focus(): Promise<void>
  /** Sets the files of the <input type=file> that `expression` evaluates to, all of them at once (a script cannot do this). */
  attachFile(expression: string, paths: string[], what: string): Promise<void>
}

/**
 * How a person's hands are paced: the waits and the small randomness of a path, in one place so a test can make them instant and exact.
 * Nothing here decides what is done, only how long it takes.
 */
export const pacing = {
  sleep: (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms)),
  random: (): number => Math.random()
}
const between = (low: number, high: number): number => low + pacing.random() * (high - low)

/** The pause after a step, so that the page has reacted before it is looked at again. */
export const settle = (): Promise<void> => pacing.sleep(350)

/** How long a mouse button is held down: a person does not release it in the same instant. */
export const holdMs = (): number => Math.round(between(55, 120))

/** The pointer glides to a point in this many small moves, with an easing, as a hand does (a click does not come from nowhere). */
const GLIDE_STEPS = 16
/** A wheel turn is this many pixels (a notch of a mouse wheel), one every few milliseconds, so a scroll is smooth and not a jump. */
const WHEEL_NOTCH = 100
const WHEEL_EVERY_MS = 28
/** What is tried before an element is taken to be out of reach of the wheel. */
const MAX_SCROLL_TURNS = 10

/** A file may be uploaded when it is an absolute path to a regular file of a sensible size. */
export async function checkUploadable(path: string): Promise<void> {
  if (!isAbsolute(path)) throw new Error('Only absolute file paths can be uploaded')
  const info = await stat(path)
  if (!info.isFile()) throw new Error('The upload path is not a file')
  if (info.size > MAX_UPLOAD_BYTES) throw new Error('The file is too large to upload')
}

export async function putFile(driver: StepDriver, expression: string, path: string | string[], what: string): Promise<void> {
  const paths = Array.isArray(path) ? path : [path]
  for (const each of paths) await checkUploadable(each)
  await driver.attachFile(expression, paths, what)
}

function wrongHost(host: string): PageStepResult {
  return { status: 'wrong_host', detail: `The page is ${host ? `on ${host}` : 'not loaded'}, which is not a page of this platform, so nothing was done.` }
}

export async function runPageStep(driver: StepDriver, step: PageStep, hosts: string[], alive?: () => void): Promise<PageStepResult> {
  let host = ''
  try {
    host = new URL(driver.currentUrl()).hostname.toLowerCase()
  } catch {
    // No page yet.
  }
  if (!hosts.some((domain) => host === domain || host.endsWith(`.${domain}`))) return wrongHost(host)

  if (step.do === 'key') {
    await driver.focus()
    await driver.pressKey(step.key)
    await settle()
    return { status: 'done', detail: `Pressed ${step.key}.` }
  }

  if (step.do === 'scroll') return scrollPage(driver, step.direction, step.amount, alive)

  if (step.do === 'upload') {
    try {
      await putFile(driver, fileInputByRefScript(step.ref), [step.path, ...(step.also ?? [])], step.ref)
    } catch (error) {
      return { status: 'refused', detail: `${step.ref} did not take the file (${error instanceof Error ? error.message : String(error)}).` }
    }
    await settle()
    return { status: 'done', detail: `Put the file into ${step.ref}.` }
  }

  const located = await driver.read<LocatedElement>(locateScript(step.ref))
  if (!located.ok) return { status: 'not_found', detail: `There is no element ${step.ref} on the page now: it changed since the snapshot.` }

  if (step.do === 'hover') {
    const aimed = await pointAt(driver, step.ref, located, alive, true)
    if (aimed.kind === 'gone') return { status: 'not_found', detail: `There is no element ${step.ref} on the page now: it changed since the snapshot.` }
    if (aimed.kind === 'moving') return { status: 'not_found', detail: `${step.ref} kept moving, so the pointer could not rest on it. Nothing was pressed.` }
    return { status: 'done', detail: aimed.kind === 'at' ? `The pointer rests on ${step.ref}.` : `The pointer could not rest on ${step.ref} (something covers it).` }
  }

  if (step.do === 'click') {
    if (located.disabled) return { status: 'refused', detail: `${step.ref} is disabled.` }
    const how = await clickElement(driver, step.ref, located, alive, step.still === true)
    // Nothing was pressed when the element left the page or kept moving while the pointer was aimed at it: `not_found`, so a caller may try again.
    // `refused` is what is left: a press that was made and not seen, and a script click that did not take; it does not say that nothing happened.
    if (how === 'gone') return { status: 'not_found', detail: `There is no element ${step.ref} on the page now: it changed since the snapshot. Nothing was pressed.` }
    if (how === 'moving') return { status: 'not_found', detail: step.still === true ? `${step.ref} is not under the pointer any more (the page moved it). Nothing was pressed.` : `${step.ref} kept moving. Nothing was pressed.` }
    return how === null ? { status: 'refused', detail: `${step.ref} could not be clicked.` } : { status: 'done', detail: `Clicked ${step.ref} ${how}.` }
  }

  if (step.do === 'select') {
    const chosen = await driver.read<ActionResult>(selectOptionScript(step.ref, step.text))
    await settle()
    if (chosen.ok) return { status: 'done', detail: `Chose an option in ${step.ref}.` }
    if (chosen.reason !== 'not_a_list') return { status: 'refused', detail: chosen.reason === 'no_such_option' ? `${step.ref} has no option like that.` : `${step.ref} cannot be chosen from (${chosen.reason ?? 'unknown'}).` }
    return chooseInDropDown(driver, step.ref, step.text, located, alive)
  }

  const prepared = await driver.read<ActionResult>(prepareTypingScript(step.ref))
  if (!prepared.ok) return { status: 'refused', detail: prepared.reason === 'disabled' ? `${step.ref} is disabled.` : `${step.ref} does not take text.` }
  await driver.focus()
  // The window was given focus after the element was prepared, and an earlier host check is a moment old: before a single character is typed (a
  // password among them) the page itself says it is still this platform's and that the cursor is in this element.
  const guard = await driver.read<ActionResult & { host?: string }>(typingGuardScript(step.ref, hosts))
  if (!guard.ok) {
    if (guard.reason === 'wrong_host') return wrongHost(guard.host ?? '')
    if (guard.reason === 'not_found') return { status: 'not_found', detail: `There is no element ${step.ref} on the page now: it changed since the snapshot.` }
    return { status: 'refused', detail: `The cursor is not in ${step.ref}, so nothing was typed.` }
  }
  await driver.insertText(step.text)
  if (!(await driver.read<ActionResult>(typedScript(step.ref, step.text))).ok) {
    const fallback = await driver.read<ActionResult>(setValueScript(step.ref, step.text))
    if (!fallback.ok) return { status: 'refused', detail: `${step.ref} did not take the text.` }
    await settle()
    return { status: 'done', detail: `Typed into ${step.ref} by script (real typing did not take).` }
  }
  await settle()
  return { status: 'done', detail: `Typed into ${step.ref}.` }
}

/** How close, in pixels, the pointer has to be to a point to be taken as being on it already, and how far an element may drift between two looks. */
const ON_POINT_PX = 3
/** How many times the pointer is aimed again when the page moves the element while the pointer is on its way. */
const MAX_AIMS = 3

/**
 * Where the pointer ends up on an element. `at`: it rests on it, and `where` is where the element was found by the last look (taken after the
 * pointer arrived, so it is what a press would meet). `covered`: the element has a point, but something else is on it (the press falls back to
 * the page's own event on this very element). `moving`: the page kept moving the element, so no press was aimed. `gone`: it is not on the page now.
 */
type Aim = { kind: 'at'; where: LocatedElement & { x: number; y: number } } | { kind: 'covered'; where: LocatedElement } | { kind: 'moving' } | { kind: 'gone' }

/**
 * The wheel brings the element onto the screen when it is off it, the pointer glides to it (the owner sees a dot follow it) and rests on it
 * for a moment, as a hand does (`rest`: false when only the press is wanted and the pointer is already there). What was found before the
 * pointer arrived is old by then (a dialog moves, a list loads), so the element is looked at again after the glide, and only a point that the
 * element still holds, and that has stopped moving, is taken as aimed at: a press goes to the element that was judged, not to what the page
 * put under the old point.
 */
async function pointAt(driver: StepDriver, ref: string, located: LocatedElement, alive: (() => void) | undefined, rest: boolean): Promise<Aim> {
  let where = located
  for (let attempt = 0; attempt < MAX_AIMS; attempt++) {
    if (where.inView === false) where = (await scrollTo(driver, ref, where, alive)) ?? where
    // In the window, but under something (a box with its own scroll, a header): the browser's own scroll-to is tried before a script is.
    else if (!where.hit) {
      await driver.read<ActionResult>(scrollIntoViewScript(ref))
      const moved = await driver.read<LocatedElement>(locateScript(ref))
      if (moved.ok) where = moved
    }
    if (!where.hit || where.x === undefined || where.y === undefined) return { kind: 'covered', where }
    const { x, y } = where
    const here = await driver.read<{ x: number | null; y: number | null }>(cursorAtScript())
    const already = typeof here.x === 'number' && typeof here.y === 'number' && Math.abs(here.x - x) <= ON_POINT_PX && Math.abs(here.y - y) <= ON_POINT_PX
    if (!already) {
      alive?.()
      await driver.focus()
      await glideTo(driver, x, y, alive)
      // The pointer rests on the control before the press: a person reads it, and a page may show a hover state or a tooltip first.
      if (rest) await pacing.sleep(Math.round(between(180, 420)))
    }
    alive?.()
    const fresh = await driver.read<LocatedElement>(locateScript(ref))
    if (!fresh.ok) return { kind: 'gone' }
    if (fresh.inView === false) {
      where = fresh
      continue
    }
    if (fresh.hit && fresh.x !== undefined && fresh.y !== undefined) {
      if (Math.abs(fresh.x - x) <= ON_POINT_PX && Math.abs(fresh.y - y) <= ON_POINT_PX) return { kind: 'at', where: { ...fresh, x: fresh.x, y: fresh.y } }
      where = fresh
      continue
    }
    return { kind: 'covered', where: fresh }
  }
  return { kind: 'moving' }
}

/**
 * The press of a caller that has already pointed at the element: it is under the pointer, or it is not. Nothing scrolls, glides or waits. An
 * element the page covers still goes to the page's own event on it, as with any click; one that has left the point is not pressed.
 */
async function stillAt(driver: StepDriver, located: LocatedElement): Promise<Aim> {
  if (!located.hit || located.x === undefined || located.y === undefined) return { kind: 'covered', where: located }
  const here = await driver.read<{ x: number | null; y: number | null }>(cursorAtScript())
  const on = typeof here.x === 'number' && typeof here.y === 'number' && Math.abs(here.x - located.x) <= ON_POINT_PX && Math.abs(here.y - located.y) <= ON_POINT_PX
  return on ? { kind: 'at', where: { ...located, x: located.x, y: located.y } } : { kind: 'moving' }
}

/**
 * Clicks an element the way a person does: the pointer is aimed at it (`pointAt`), and the button is pressed and released at the point the
 * element held at the last look, a moment before. The page's own events are the fallback, since a page that is not drawn drops a real mouse press, so
 * whether the press arrived is looked at, not assumed: the watch is armed right before every press (a watch armed earlier counts an earlier
 * press, and a pointer already on the point arms nothing). Returns how it was done; 'gone' or 'moving' when nothing was pressed (an element
 * that kept moving is not pressed at all: a press at a point it has left would land on whatever the page put there); null when a press was
 * made or tried and did not take. `still`: only a press where the pointer already rests, with nothing waited for (the caller made a hover and
 * took its last look; the point of no return has passed).
 */
async function clickElement(driver: StepDriver, ref: string, located: LocatedElement, alive?: () => void, still = false): Promise<string | null> {
  const aimed = still ? await stillAt(driver, located) : await pointAt(driver, ref, located, alive, true)
  if (aimed.kind === 'gone' || aimed.kind === 'moving') return aimed.kind
  if (aimed.kind === 'at') {
    const { x, y } = aimed.where
    await driver.read<ActionResult>(mouseWatchScript())
    await driver.read(cursorScript(x, y, 'down'))
    alive?.()
    await driver.mouseClick(x, y)
    await driver.read(cursorScript(x, y, 'up'))
    if ((await driver.read<ActionResult>(mouseSeenScript())).ok) {
      await settle()
      return 'with a mouse click'
    }
  }
  alive?.()
  const scripted = await driver.read<ActionResult>(scriptClickScript(ref))
  await settle()
  return scripted.ok ? 'by script (a real click does not reach a tab that is not drawn, or something covers the element)' : null
}

/** The size of the window as the page says it: a number from a page is not trusted, so a window of a few thousand pixels at most is worked with. */
const clampWindow = (value: number | undefined, fallback: number): number => (typeof value === 'number' && Number.isFinite(value) ? Math.min(4000, Math.max(200, value)) : fallback)

/** The pointer moves from where it was (or from a corner of the window the first time) to a point, along a slightly bent path that slows at the end. */
async function glideTo(driver: StepDriver, x: number, y: number, alive?: () => void): Promise<void> {
  const start = await driver.read<{ x: number | null; y: number | null; vw?: number; vh?: number }>(cursorAtScript())
  const fromX = typeof start.x === 'number' ? start.x : Math.max(10, (start.vw ?? 800) * between(0.05, 0.25))
  const fromY = typeof start.y === 'number' ? start.y : Math.max(10, (start.vh ?? 600) * between(0.05, 0.25))
  const bend = between(-0.12, 0.12) * Math.hypot(x - fromX, y - fromY)
  for (let step = 1; step <= GLIDE_STEPS; step++) {
    const t = step / GLIDE_STEPS
    const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
    // The bend is largest in the middle of the way and nothing at the ends, so the pointer arrives exactly on the point.
    const arc = Math.sin(Math.PI * t) * bend
    const px = Math.round(fromX + (x - fromX) * eased + arc * 0.4)
    const py = Math.round(fromY + (y - fromY) * eased + arc)
    const atEnd = step === GLIDE_STEPS
    const mx = atEnd ? Math.round(x) : px
    const my = atEnd ? Math.round(y) : py
    alive?.()
    await driver.mouseMove(mx, my)
    await driver.read(cursorScript(mx, my, 'move'))
    await pacing.sleep(Math.round(between(6, 16)))
  }
}

/** Turns the wheel by `dy` pixels (positive down) over a point, a notch at a time: a smooth scroll the page sees as wheel events. */
async function turnWheel(driver: StepDriver, x: number, y: number, dy: number, alive?: () => void): Promise<void> {
  let left = Math.abs(dy)
  const sign = dy < 0 ? -1 : 1
  while (left > 0) {
    const notch = Math.min(left, WHEEL_NOTCH)
    alive?.()
    await driver.wheel(x, y, sign * notch)
    left -= notch
    await pacing.sleep(WHEEL_EVERY_MS)
  }
}

/**
 * Brings an element that is off the screen onto it with the wheel, turning it toward the element a screen at a time and looking again,
 * as a person scrolls to what they want. When the wheel does not move the page (the element is in a box the pointer is not over) the browser's
 * own scroll-to is the last resort. Null when the element could not be found again.
 */
async function scrollTo(driver: StepDriver, ref: string, from: LocatedElement, alive?: () => void): Promise<LocatedElement | null> {
  let current = from
  for (let turn = 0; turn < MAX_SCROLL_TURNS; turn++) {
    if (current.inView || current.x === undefined || current.y === undefined) return current
    const vh = clampWindow(current.vh, 600)
    const vw = clampWindow(current.vw, 800)
    const dy = Math.max(-0.8 * vh, Math.min(0.8 * vh, current.y - vh / 2))
    await glideTo(driver, vw / 2, vh / 2, alive)
    await turnWheel(driver, vw / 2, vh / 2, dy, alive)
    await pacing.sleep(Math.round(between(120, 260)))
    const again = await driver.read<LocatedElement>(locateScript(ref))
    if (!again.ok) return null
    // The element did not move on the screen: the wheel scrolled nothing here.
    if (again.y !== undefined && current.y !== undefined && Math.abs(again.y - current.y) < 2) {
      await driver.read<ActionResult>(scrollIntoViewScript(ref))
      const forced = await driver.read<LocatedElement>(locateScript(ref))
      return forced.ok ? forced : null
    }
    current = again
  }
  return current
}

/** A scroll the AI asked for: most of a screen (or half) down or up, over the middle of the page, and where the page is afterwards. */
async function scrollPage(driver: StepDriver, direction: 'down' | 'up', amount: 'screen' | 'half', alive?: () => void): Promise<PageStepResult> {
  const probe = await driver.read<ScrollState>(scrollStateScript(400, 300))
  const vw = clampWindow(probe.vw, 800)
  const vh = clampWindow(probe.vh, 600)
  const x = Math.round(vw / 2)
  const y = Math.round(vh / 2)
  const before = await driver.read<ScrollState>(scrollStateScript(x, y))
  await driver.focus()
  await glideTo(driver, x, y, alive)
  const distance = Math.round(vh * (amount === 'screen' ? 0.8 : 0.4))
  await turnWheel(driver, x, y, direction === 'down' ? distance : -distance, alive)
  await settle()
  const after = await driver.read<ScrollState>(scrollStateScript(x, y))
  return { status: 'done', detail: scrolled(direction, before, after) }
}

/** What a scroll did, in words: how far down the page (or the box under the pointer) now is, and whether there is more in that direction. */
function scrolled(direction: 'down' | 'up', before: ScrollState, after: ScrollState): string {
  const max = after.max ?? 0
  const top = after.top ?? 0
  const where = max <= 0 ? 'The page has nothing more to scroll to.' : `It is now ${Math.round((top / max) * 100)}% of the way down${after.inner ? ' (the box under the pointer, not the whole page)' : ''}.`
  if ((before.top ?? 0) === top) return `The page did not move: it is already at the ${direction === 'down' ? 'bottom' : 'top'}. ${where}`
  const more = direction === 'down' ? max - top > 4 : top > 4
  return `${where} ${more ? `There is more ${direction === 'down' ? 'below' : 'above'}.` : `This is the ${direction === 'down' ? 'bottom' : 'top'}.`}`
}

/** A drop-down that is not a plain list (Facebook's birthday lists): open it, click the option with this text, as a person would. */
async function chooseInDropDown(driver: StepDriver, ref: string, text: string, located: LocatedElement, alive?: () => void): Promise<PageStepResult> {
  if (located.disabled) return { status: 'refused', detail: `${ref} is disabled.` }
  if ((await clickElement(driver, ref, located, alive)) === null) return { status: 'refused', detail: `${ref} could not be opened.` }
  const found = await driver.read<{ ok: boolean; reason?: string; ref?: string; options?: string[] }>(markOptionScript(ref, text))
  if (!found.ok || !found.ref) {
    const offered = found.options && found.options.length > 0 ? ` It offers: ${found.options.join(', ')}.` : ''
    return { status: 'refused', detail: found.reason === 'no_options' ? `${ref} showed no options after it was opened.` : `${ref} has no option like that.${offered}` }
  }
  const option = await driver.read<LocatedElement>(locateScript(found.ref))
  if (!option.ok || (await clickElement(driver, found.ref, option, alive)) === null) return { status: 'refused', detail: `The option in ${ref} could not be clicked.` }
  return { status: 'done', detail: `Chose an option in ${ref}.` }
}
