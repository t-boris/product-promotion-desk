import { useState } from 'react'
import type { AgentLesson, PlatformInfo } from '../../../shared/types'
import { call, useAction, useQuery } from '../hooks'
import { Badge, Button, Card, ErrorNote, Field, Hint, More } from '../ui'

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
  return (
    <Card title="What the AI learned">
      <Hint data-testid="lessons-note">When you answer the AI’s question with a rule, it keeps the rule and follows it on the next accounts, without asking again. You can write a rule yourself too.</Hint>
      <More label="Examples">
        <Hint>“Compress the picture”, “edit only the editable fields”.</Hint>
      </More>
      <div className="form-row">
        <Field label="A rule of your own" hint="One short sentence, at least 8 characters.">
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
      </div>
      <div className="row">
        <Button variant="primary" onClick={() => void add()} disabled={adding.busy || rule.trim().length < 8} data-testid="lesson-add">
          {adding.busy ? 'Adding…' : 'Add the rule'}
        </Button>
        {/* Why the button is off, beside it (QA finding 9). */}
        {rule.trim().length < 8 && (
          <Hint data-testid="lesson-add-reason">{rule.trim().length === 0 ? 'Write a rule of at least 8 characters.' : `${8 - rule.trim().length} more character${8 - rule.trim().length === 1 ? '' : 's'} needed.`}</Hint>
        )}
      </div>
      <ErrorNote error={adding.error ?? lessons.error} />
      <h3 className="list-title">Saved rules{list.length > 0 ? ` (${list.length})` : ''}</h3>
      {list.length === 0 ? (
        <p className="muted" data-testid="lessons-empty">
          Nothing learned yet.
        </p>
      ) : (
        <div className="stack" data-testid="lessons-list">
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
    <div className="stack rule-row" data-testid={`lesson-${lesson.id}`}>
      <div className="form-row">
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
      <div className="row">
        <Badge tone={lesson.enabled ? 'good' : 'neutral'}>{lesson.enabled ? 'On' : 'Off'}</Badge>
        <Button onClick={() => void save()} disabled={busy || !dirty || rule.trim().length < 8} data-testid={`lesson-save-${lesson.id}`}>
          Save
        </Button>
        <Button onClick={() => void toggle()} disabled={busy} data-testid={`lesson-toggle-${lesson.id}`}>
          {lesson.enabled ? 'Switch off' : 'Switch on'}
        </Button>
        <Button onClick={() => void remove()} disabled={busy} data-testid={`lesson-remove-${lesson.id}`}>
          Remove
        </Button>
        <span className="hint">
          {lesson.uses === 0 ? 'not used yet' : `used in ${lesson.uses} mission${lesson.uses === 1 ? '' : 's'}`}
          {lesson.answer ? ` · you said: “${lesson.answer}”` : ' · written by you'}
        </span>
      </div>
      <ErrorNote error={saving.error ?? toggling.error ?? removing.error} />
    </div>
  )
}
