import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { READING_LANGUAGES, type ReadingLanguage } from '../../../../shared/reading-language'
import type { AssistAngle, AssistJudgement, Finding, FindingAssist, FindingComment, FindingTranslation } from '../../../../shared/types'
import { AiProgressPanel } from '../../AiProgress'
import { call, useAction, useQuery } from '../../hooks'
import { Badge, Button, ErrorNote, Hint, formatTime } from '../../ui'
import { FoundSources } from '../review/FoundSources'
import { createLanguageStore, angleWhere, angleWish, anglePlace, ASSIST_STALE, assistLine, basisLabel, BODY_NONE, BODY_UNREAD, bodyShown, bodyState, explainPhase, translationLine, type LanguageStorage } from './post-tools'
import type { Place } from './reply-composer'

/** The browser's storage, or undefined where the browser refuses even to hand it out. */
function browserStorage(): LanguageStorage | undefined {
  try {
    return window.localStorage
  } catch {
    return undefined
  }
}

/** The one reading language of the window: choosing it on one post is the choice for every post, and it is remembered. */
const languageStore = createLanguageStore(browserStorage())

export function useReadingLanguage(): [ReadingLanguage, (language: ReadingLanguage) => void] {
  const language = useSyncExternalStore(languageStore.subscribe, languageStore.snapshot, languageStore.snapshot)
  return [language, languageStore.choose]
}

/** The language the owner reads in, from the fixed list: the one dropdown of the card's tools. */
function LanguagePicker({ value, onChange, disabled }: { value: ReadingLanguage; onChange: (language: ReadingLanguage) => void; disabled: boolean }) {
  return (
    <select
      className="input post-tools-language"
      value={value}
      disabled={disabled}
      aria-label="Language to read in"
      title="The language the AI translates and explains in"
      onChange={(e) => onChange(e.target.value as ReadingLanguage)}
      data-testid="post-language"
    >
      {READING_LANGUAGES.map((language) => (
        <option key={language} value={language}>
          {language}
        </option>
      ))}
    </select>
  )
}

export type PostPanel = 'explain' | 'read' | null

/**
 * The tools of a post: Explain, Read the post, Translate and the language they work in. They only help the owner read: the AI's explanation and translation
 * are shown as its own words, and nothing is posted or sent from here.
 */
export function PostToolsRow({
  panel,
  onPanel,
  language,
  onLanguage,
  translation,
  translated,
  onTranslate,
  onShowOriginal,
  translating
}: {
  panel: PostPanel
  onPanel: (panel: PostPanel) => void
  language: ReadingLanguage
  onLanguage: (language: ReadingLanguage) => void
  /** The kept translation into `language`, or null. */
  translation: FindingTranslation | null
  translated: boolean
  onTranslate: () => void
  onShowOriginal: () => void
  translating: boolean
}) {
  const translateLabel = translating ? 'Translating…' : translated ? 'Show original' : translation === null ? 'Translate' : translation.stale ? 'Translate again' : 'Show translation'
  return (
    <div className="post-tools" role="group" aria-label="Tools for reading the post" data-testid="post-tools">
      <Button variant={panel === 'explain' ? 'secondary' : 'quiet'} onClick={() => onPanel(panel === 'explain' ? null : 'explain')} aria-pressed={panel === 'explain'} data-testid="post-explain">
        Explain
      </Button>
      <Button variant={panel === 'read' ? 'secondary' : 'quiet'} onClick={() => onPanel(panel === 'read' ? null : 'read')} aria-pressed={panel === 'read'} data-testid="post-read">
        Read the post
      </Button>
      <Button variant="quiet" onClick={translated && !translating ? onShowOriginal : onTranslate} disabled={translating} data-testid="post-translate">
        {translateLabel}
      </Button>
      <LanguagePicker value={language} onChange={onLanguage} disabled={translating} />
    </div>
  )
}

/** Over the title while the owner reads the translation: what it is, and how to go back. */
export function TranslationLine({ translation, translated, onShowOriginal }: { translation: FindingTranslation | null; translated: boolean; onShowOriginal: () => void }) {
  const line = translationLine(translation, translated)
  if (line === null || !translated) return null
  return (
    <p className="post-translation muted small" data-testid="post-translation-line" data-stale={translation?.stale ? 'true' : 'false'}>
      <span>{line}</span>{' '}
      <Button variant="quiet" onClick={onShowOriginal} data-testid="post-show-original">
        Show original
      </Button>
    </p>
  )
}

/** The text of the post as its own page showed it, as plain text; or why there is none, and the one thing to do about it. */
export function BodyPanel({ finding, translation, translated, onRead, reading }: { finding: Finding; translation: FindingTranslation | null; translated: boolean; onRead: () => void; reading: boolean }) {
  const state = bodyState(finding)
  const text = bodyShown(finding, translation, translated)
  return (
    <section className="post-panel" aria-label="The text of the post" data-testid="post-body-panel" data-state={state}>
      <h4 className="stream-section-title">The post</h4>
      {state === 'text' && (
        <div className="post-body" data-testid="post-body">
          {text
            .split(/\n{2,}/)
            .filter((paragraph) => paragraph.trim() !== '')
            .map((paragraph, index) => (
              <p key={index}>{paragraph}</p>
            ))}
        </div>
      )}
      {state === 'none' && (
        <p className="muted small" data-testid="post-body-none">
          {BODY_NONE}
        </p>
      )}
      {state === 'unread' && (
        <>
          <p className="muted small" data-testid="post-body-unread">
            {BODY_UNREAD}
          </p>
          <Button variant="secondary" onClick={onRead} disabled={reading} data-testid="post-body-read">
            {reading ? 'Reading…' : 'Let the AI read it'}
          </Button>
        </>
      )}
    </section>
  )
}

function Judgements({ title, items, testId }: { title: string; items: readonly AssistJudgement[]; testId: string }) {
  if (items.length === 0) return null
  return (
    <section className="post-assist-part" data-testid={testId}>
      <h4 className="stream-section-title">{title}</h4>
      <ul>
        {items.map((item, index) => (
          <li key={`${index}-${item.point}`}>
            {item.point} <Badge tone={item.basis === 'facts' ? 'info' : 'neutral'}>{basisLabel(item.basis)}</Badge>
          </li>
        ))}
      </ul>
    </section>
  )
}

function Answers({ answers, comments, author, onWrite }: { answers: readonly AssistAngle[]; comments: readonly FindingComment[]; author: string; onWrite: (place: Place, wish: string) => void }) {
  if (answers.length === 0) return null
  return (
    <section className="post-assist-part" data-testid="post-assist-answers">
      <h4 className="stream-section-title">What could be answered</h4>
      <ul className="post-assist-answers">
        {answers.map((angle, index) => (
          <li key={`${index}-${angle.angle}`} data-testid="post-assist-answer">
            <strong>{angle.angle}</strong>
            {angle.why.trim() !== '' && <span className="muted small"> {angle.why}</span>}
            <span className="muted small"> · to {angleWhere(angle, comments, author)}</span>
            <div>
              <Button variant="secondary" onClick={() => onWrite(anglePlace(angle, comments), angleWish(angle))} data-testid="post-assist-write">
                Write a reply from this
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

export function Explanation({ assist, comments, author, onWrite }: { assist: FindingAssist; comments: readonly FindingComment[]; author: string; onWrite: (place: Place, wish: string) => void }) {
  return (
    <div className="post-assist-body" data-testid="post-assist-body">
      <p className="muted small" data-testid="post-assist-line">
        {assistLine(assist, formatTime(assist.at))}
      </p>
      {assist.about !== '' && (
        <section className="post-assist-part" data-testid="post-assist-about">
          <h4 className="stream-section-title">What it is about</h4>
          <p>{assist.about}</p>
        </section>
      )}
      {assist.wants !== '' && (
        <section className="post-assist-part" data-testid="post-assist-wants">
          <h4 className="stream-section-title">What the person wants</h4>
          <p>{assist.wants}</p>
        </section>
      )}
      {assist.interesting.length > 0 && (
        <section className="post-assist-part" data-testid="post-assist-interesting">
          <h4 className="stream-section-title">What is worth noticing</h4>
          <ul>
            {assist.interesting.map((item, index) => (
              <li key={`${index}-${item}`}>{item}</li>
            ))}
          </ul>
        </section>
      )}
      <Judgements title="Where the person is right" items={assist.right} testId="post-assist-right" />
      <Judgements title="Where the person is wrong" items={assist.wrong} testId="post-assist-wrong" />
      {assist.right.length === 0 && assist.wrong.length === 0 && assist.noJudgement !== '' && (
        <section className="post-assist-part" data-testid="post-assist-nojudgement">
          <h4 className="stream-section-title">Right and wrong</h4>
          <p className="muted">{assist.noJudgement}</p>
        </section>
      )}
      <Answers answers={assist.answers} comments={comments} author={author} onWrite={onWrite} />
      <FoundSources sources={assist.sources} />
      {assist.followUps.length > 0 && (
        <section className="post-assist-part" data-testid="post-assist-followups">
          <h4 className="stream-section-title">What you asked</h4>
          <ul>
            {assist.followUps.map((followUp, index) => (
              <li key={`${index}-${followUp.question}`} data-testid="post-assist-followup">
                <span className="muted small">You: {followUp.question}</span>
                <p>{followUp.reply}</p>
                <FoundSources sources={followUp.sources} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

const QUESTION_MAX = 400

/**
 * "Explain" for one post: the AI's own words about it, in the language the owner reads in. It reads the post first when it has not (and says so), looks
 * at the web only when the post needs facts, and offers to write a reply from any of the angles it names. What it writes is its reading, not the post's and
 * not the owner's: it is labelled as the AI's, and nothing is sent or posted from it.
 */
export function AssistPanel({
  finding,
  comments,
  language,
  onWrite
}: {
  finding: Finding
  comments: readonly FindingComment[]
  language: ReadingLanguage
  /** Opens the reply window at the place with the wish; nothing is sent. */
  onWrite: (place: Place, wish: string) => void
}) {
  const kept = useQuery('findings.assistance', { id: finding.id, language }, [])
  // The answer for another language may still be in hand for a moment after the language changed: it is not this one.
  const assist = kept.data && kept.data.language === language ? kept.data : null
  const [question, setQuestion] = useState('')
  const [asking, setAsking] = useState(false)
  const [run, running] = useAction(async (args: { question?: string; refresh?: boolean }) => {
    setAsking(args.question !== undefined)
    const made = await call('findings.assist', { id: finding.id, language, ...args })
    kept.reload()
    if (args.question !== undefined) setQuestion('')
    return made
  })
  // Opening the panel on a post that has no explanation yet is the owner's press on Explain: it starts. Changing the language afterwards does not (it costs a run).
  const settled = useRef(false)
  useEffect(() => {
    if (kept.loading || kept.data === undefined || settled.current) return
    settled.current = true
    if (kept.data === null) void run({})
  }, [kept.loading, kept.data, run])

  const phase = running.busy ? (asking ? 'asking' : finding.readAt === null ? 'reading' : 'thinking') : null
  const ask = (): void => {
    if (question.trim() !== '' && !running.busy) void run({ question: question.trim() })
  }
  return (
    <section className="post-panel post-assist" aria-label="The AI's explanation of the post" data-testid="post-assist" data-state={running.busy ? 'working' : assist ? 'ready' : 'empty'}>
      <h4 className="stream-section-title">Explained by the AI</h4>
      {phase !== null && (
        <p className="muted small" data-testid="post-assist-phase">
          {explainPhase(phase)}
        </p>
      )}
      {running.busy && <AiProgressPanel />}
      <ErrorNote error={running.error ?? kept.error} />
      {assist?.stale && !running.busy && <Hint tone="warn" data-testid="post-assist-stale">{ASSIST_STALE}</Hint>}
      {assist && <Explanation assist={assist} comments={comments} author={finding.author} onWrite={onWrite} />}
      {!running.busy && assist === null && !kept.loading && (
        <p className="muted small" data-testid="post-assist-none">
          No explanation in {language} yet.
        </p>
      )}
      <div className="post-assist-actions">
        <Button variant={assist === null ? 'primary' : 'secondary'} onClick={() => void run({ refresh: assist !== null })} disabled={running.busy} data-testid="post-assist-run">
          {running.busy && !asking ? 'Explaining…' : assist === null ? `Explain in ${language}` : 'Explain again'}
        </Button>
      </div>
      {assist && (
        <div className="post-assist-ask">
          <input
            className="input"
            value={question}
            maxLength={QUESTION_MAX}
            placeholder="Ask the AI about this post"
            aria-label="Ask the AI about this post"
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') ask()
            }}
            data-testid="post-assist-question"
          />
          <Button variant="secondary" onClick={ask} disabled={running.busy || question.trim() === ''} data-testid="post-assist-ask">
            {running.busy && asking ? 'Thinking…' : 'Ask'}
          </Button>
        </div>
      )}
    </section>
  )
}
