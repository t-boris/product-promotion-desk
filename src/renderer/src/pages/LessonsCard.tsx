import { useState } from 'react'
import type { AgentLesson, PlatformInfo } from '../../../shared/types'
import { call, useAction, useQuery } from '../hooks'
import { Badge, Button, Card, ConfirmAction, ErrorNote, Field, Hint, More } from '../ui'
import './settings.css'

const RULE_LIMIT = 200

/**
 * What the AI learned from the owner: the rules it keeps from answers ("shrink a picture under 500 KB", "edit only the editable fields"),
 * and rules the owner writes. Every mission on the platform is given them, so the owner is not asked the same thing again. One list:
 * edit the words, change the platform, switch a rule off, remove it.
 */
export function LessonsCard() {
  const lessons = useQuery('lessons.list', undefined, ['settings'])
  const platforms = useQuery('platforms.list', undefined, [])
  const [rule, setRule] = useState('')
  const [platform, setPlatform] = useState('')
  const [add, adding] = useAction(async () => {
    await call('lessons.add', { rule: rule.trim(), platform: platform || null })
    setRule('')
  })
  const list = lessons.data ?? []
  const missing = 8 - rule.trim().length
  return (
    <Card title="What the AI learned">
      <Hint data-testid="lessons-note">When you answer the AI’s question with a rule, it keeps the rule and follows it on the next accounts, without asking again. You can write a rule yourself too.</Hint>
      <More label="Examples">
        <Hint>“Compress the picture”, “edit only the editable fields”.</Hint>
      </More>
      {/* The add row: the rule, the platform it is for, and the button on one line (labels on top, level with each other). */}
      <div className="lesson-add">
        {/* The length rule is said once, beside the button it holds back (BUG-037). */}
        <Field label="A rule of your own" hint="One short sentence.">
          <input className="input" value={rule} maxLength={RULE_LIMIT} onChange={(e) => setRule(e.target.value)} data-testid="lesson-new-rule" />
        </Field>
        <Field label="For" hint="One platform, or all of them.">
          <select className="input" value={platform} onChange={(e) => setPlatform(e.target.value)} data-testid="lesson-new-platform">
            <option value="">All platforms</option>
            {(platforms.data ?? []).map((p) => (
              <option key={p.platform} value={p.platform}>
                {p.label}
              </option>
            ))}
          </select>
        </Field>
        <div className="lesson-add-action">
          <Button variant="secondary" onClick={() => void add()} disabled={adding.busy || missing > 0} data-testid="lesson-add">
            {adding.busy ? 'Adding…' : 'Add the rule'}
          </Button>
        </div>
      </div>
      {/* Why the button is off, beside it (QA finding 9). */}
      {missing > 0 && <Hint data-testid="lesson-add-reason">{rule.trim().length === 0 ? 'Write a rule of at least 8 characters.' : `${missing} more character${missing === 1 ? '' : 's'} needed.`}</Hint>}
      <ErrorNote error={adding.error ?? lessons.error} />
      <h3 className="lessons-title">Saved rules{list.length > 0 ? ` (${list.length})` : ''}</h3>
      {list.length === 0 ? (
        <p className="muted lessons-empty" data-testid="lessons-empty">
          Nothing learned yet.
        </p>
      ) : (
        <div className="rows" data-testid="lessons-list">
          {list.map((lesson) => (
            <LessonRow key={`${lesson.id}:${lesson.rule}:${lesson.platform}:${lesson.enabled}`} lesson={lesson} platforms={platforms.data ?? []} />
          ))}
        </div>
      )}
    </Card>
  )
}

function LessonRow({ lesson, platforms }: { lesson: AgentLesson; platforms: PlatformInfo[] }) {
  const [rule, setRule] = useState(lesson.rule)
  const [platform, setPlatform] = useState(lesson.platform ?? '')
  const [save, saving] = useAction(() => call('lessons.save', { id: lesson.id, rule: rule.trim(), platform: platform || null }))
  const [toggle, toggling] = useAction(() => call('lessons.save', { id: lesson.id, enabled: !lesson.enabled }))
  const [remove, removing] = useAction(() => call('lessons.remove', { id: lesson.id }))
  const dirty = rule.trim() !== lesson.rule || platform !== (lesson.platform ?? '')
  const busy = saving.busy || toggling.busy || removing.busy
  return (
    <div className="rule" data-testid={`lesson-${lesson.id}`}>
      <div className="rule-fields">
        <input className="input" value={rule} maxLength={RULE_LIMIT} onChange={(e) => setRule(e.target.value)} aria-label="The rule" data-testid={`lesson-rule-${lesson.id}`} />
        <select className="input" value={platform} onChange={(e) => setPlatform(e.target.value)} aria-label="Platform of the rule" data-testid={`lesson-platform-${lesson.id}`}>
          <option value="">All platforms</option>
          {platforms.map((p) => (
            <option key={p.platform} value={p.platform}>
              {p.label}
            </option>
          ))}
        </select>
      </div>
      <div className="rule-foot">
        <div className="rule-state">
          <Badge tone={lesson.enabled ? 'good' : 'neutral'}>{lesson.enabled ? 'On' : 'Off'}</Badge>
          <span className="hint">
            {lesson.uses === 0 ? 'not used yet' : `used in ${lesson.uses} mission${lesson.uses === 1 ? '' : 's'}`}
            {lesson.answer ? ` · you said: “${lesson.answer}”` : ' · written by you'}
          </span>
        </div>
        <div className="rule-actions">
          <Button variant="quiet" onClick={() => void toggle()} disabled={busy} data-testid={`lesson-toggle-${lesson.id}`}>
            {lesson.enabled ? 'Switch off' : 'Switch on'}
          </Button>
          <ConfirmAction
            label="Remove"
            variant="quiet"
            className="danger"
            question="Removes this rule. The AI no longer follows it."
            confirmLabel="Remove rule"
            onConfirm={() => remove()}
            disabled={busy}
            testId={`lesson-remove-${lesson.id}`}
            confirmTestId={`lesson-remove-confirm-${lesson.id}`}
          />
          <Button onClick={() => void save()} disabled={busy || !dirty || rule.trim().length < 8} data-testid={`lesson-save-${lesson.id}`}>
            Save
          </Button>
        </div>
      </div>
      <ErrorNote error={saving.error ?? toggling.error ?? removing.error} />
    </div>
  )
}
