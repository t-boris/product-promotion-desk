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
import { fileInputByRefScript, locateScript, markOptionScript, mouseSeenScript, mouseWatchScript, prepareTypingScript, scriptClickScript, selectOptionScript, setValueScript, typedScript, type ActionResult, type LocatedElement } from './page-scripts'

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024

/** What a back end has to be able to do to a page. Every call is on the one page the agent works in. */
export interface StepDriver {
  /** The address of the page now, for the host check; '' when no page is loaded. */
  currentUrl(): string
  /** Evaluates a script in the page (never as a user gesture) and returns its JSON-serializable result. */
  read<T>(script: string): Promise<T>
  /** A real key press on the focused element: down, the character when there is one, up. */
  pressKey(key: 'Enter' | 'Tab' | 'Escape'): Promise<void>
  /** A real mouse move, press and release at a point of the page. */
  mouseClick(x: number, y: number): Promise<void>
  /** Puts the page in front for the input that follows and types the text into the focused element, as the browser's own text insertion. */
  insertText(text: string): Promise<void>
  /** Brings the page's window to a state that takes input (focus); called before a click or typing. */
  focus(): Promise<void>
  /** Sets the files of the <input type=file> that `expression` evaluates to (a script cannot do this). */
  attachFile(expression: string, path: string, what: string): Promise<void>
}

/** The pause after a step, so that the page has reacted before it is looked at again. */
export const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 350))

/** A file may be uploaded when it is an absolute path to a regular file of a sensible size. */
export async function checkUploadable(path: string): Promise<void> {
  if (!isAbsolute(path)) throw new Error('Only absolute file paths can be uploaded')
  const info = await stat(path)
  if (!info.isFile()) throw new Error('The upload path is not a file')
  if (info.size > MAX_UPLOAD_BYTES) throw new Error('The file is too large to upload')
}

export async function putFile(driver: StepDriver, expression: string, path: string, what: string): Promise<void> {
  await checkUploadable(path)
  await driver.attachFile(expression, path, what)
}

export async function runPageStep(driver: StepDriver, step: PageStep, hosts: string[]): Promise<PageStepResult> {
  let host = ''
  try {
    host = new URL(driver.currentUrl()).hostname.toLowerCase()
  } catch {
    // No page yet.
  }
  if (!hosts.some((domain) => host === domain || host.endsWith(`.${domain}`))) {
    return { status: 'wrong_host', detail: `The page is ${host ? `on ${host}` : 'not loaded'}, which is not a page of this platform, so nothing was done.` }
  }

  if (step.do === 'key') {
    await driver.focus()
    await driver.pressKey(step.key)
    await settle()
    return { status: 'done', detail: `Pressed ${step.key}.` }
  }

  if (step.do === 'upload') {
    try {
      await putFile(driver, fileInputByRefScript(step.ref), step.path, step.ref)
    } catch (error) {
      return { status: 'refused', detail: `${step.ref} did not take the file (${error instanceof Error ? error.message : String(error)}).` }
    }
    await settle()
    return { status: 'done', detail: `Put the file into ${step.ref}.` }
  }

  const located = await driver.read<LocatedElement>(locateScript(step.ref))
  if (!located.ok) return { status: 'not_found', detail: `There is no element ${step.ref} on the page now: it changed since the snapshot.` }

  if (step.do === 'click') {
    if (located.disabled) return { status: 'refused', detail: `${step.ref} is disabled.` }
    const how = await clickElement(driver, step.ref, located)
    return how === null ? { status: 'refused', detail: `${step.ref} could not be clicked.` } : { status: 'done', detail: `Clicked ${step.ref} ${how}.` }
  }

  if (step.do === 'select') {
    const chosen = await driver.read<ActionResult>(selectOptionScript(step.ref, step.text))
    await settle()
    if (chosen.ok) return { status: 'done', detail: `Chose an option in ${step.ref}.` }
    if (chosen.reason !== 'not_a_list') return { status: 'refused', detail: chosen.reason === 'no_such_option' ? `${step.ref} has no option like that.` : `${step.ref} cannot be chosen from (${chosen.reason ?? 'unknown'}).` }
    return chooseInDropDown(driver, step.ref, step.text, located)
  }

  const prepared = await driver.read<ActionResult>(prepareTypingScript(step.ref))
  if (!prepared.ok) return { status: 'refused', detail: prepared.reason === 'disabled' ? `${step.ref} is disabled.` : `${step.ref} does not take text.` }
  await driver.focus()
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

/**
 * Clicks an element: with the browser's own mouse when the page takes it, otherwise with the page's own events. A page that is not
 * drawn drops a real mouse press, so whether it arrived is looked at, not assumed. Returns how it was done, or null when it could not be.
 */
async function clickElement(driver: StepDriver, ref: string, located: LocatedElement): Promise<string | null> {
  if (located.hit && located.x !== undefined && located.y !== undefined) {
    await driver.read<ActionResult>(mouseWatchScript())
    await driver.focus()
    await driver.mouseClick(located.x, located.y)
    if ((await driver.read<ActionResult>(mouseSeenScript())).ok) {
      await settle()
      return 'with a mouse click'
    }
  }
  const scripted = await driver.read<ActionResult>(scriptClickScript(ref))
  await settle()
  return scripted.ok ? 'by script (a real click does not reach a tab that is not drawn, or something covers the element)' : null
}

/** A drop-down that is not a plain list (Facebook's birthday lists): open it, click the option with this text, as a person would. */
async function chooseInDropDown(driver: StepDriver, ref: string, text: string, located: LocatedElement): Promise<PageStepResult> {
  if (located.disabled) return { status: 'refused', detail: `${ref} is disabled.` }
  if ((await clickElement(driver, ref, located)) === null) return { status: 'refused', detail: `${ref} could not be opened.` }
  const found = await driver.read<{ ok: boolean; reason?: string; ref?: string; options?: string[] }>(markOptionScript(ref, text))
  if (!found.ok || !found.ref) {
    const offered = found.options && found.options.length > 0 ? ` It offers: ${found.options.join(', ')}.` : ''
    return { status: 'refused', detail: found.reason === 'no_options' ? `${ref} showed no options after it was opened.` : `${ref} has no option like that.${offered}` }
  }
  const option = await driver.read<LocatedElement>(locateScript(found.ref))
  if (!option.ok || (await clickElement(driver, found.ref, option)) === null) return { status: 'refused', detail: `The option in ${ref} could not be clicked.` }
  return { status: 'done', detail: `Chose an option in ${ref}.` }
}
