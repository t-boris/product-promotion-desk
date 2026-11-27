import { useState } from 'react'
import { READING_LANGUAGES, type ReadingLanguage } from '../../../../shared/reading-language'
import { call, useAction } from '../../hooks'
import { Button, ErrorNote } from '../../ui'

/**
 * "Translate my post" (DEC-065): the title and the text of the draft in the editor, put into the chosen language by the AI. The translation
 * goes into the editor, never into storage: the owner reads it and saves. "Undo" puts back what was there until the owner types over it.
 */
export function TranslateDraft({ title, text, disabled, onTranslated }: { title: string; text: string; disabled: boolean; onTranslated: (form: { title: string; text: string }) => void }) {
  const [language, setLanguage] = useState<ReadingLanguage>('English')
  const [undo, setUndo] = useState<{ before: { title: string; text: string }; after: { title: string; text: string } } | null>(null)
  const [translate, translating] = useAction(async () => {
    const before = { title, text }
    const after = await call('drafts.translate', { form: before, language })
    onTranslated(after)
    setUndo({ before, after })
  })
  const canUndo = undo !== null && undo.after.title === title && undo.after.text === text
  return (
    <div className="draft-translate" data-testid="draft-translate">
      <label htmlFor="draft-translate-language">Translate into</label>
      <select id="draft-translate-language" className="input" value={language} onChange={(e) => setLanguage(e.target.value as ReadingLanguage)} disabled={disabled || translating.busy} data-testid="draft-translate-language">
        {READING_LANGUAGES.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
      <Button variant="secondary" onClick={() => void translate()} disabled={disabled || translating.busy || (title.trim() === '' && text.trim() === '')} data-testid="draft-translate-run">
        {translating.busy ? 'Translating…' : 'Translate'}
      </Button>
      {canUndo && (
        <>
          <span className="hint">The AI translated this text. Check it before you save.</span>
          <Button
            variant="quiet"
            onClick={() => {
              onTranslated(undo.before)
              setUndo(null)
            }}
            data-testid="draft-translate-undo"
          >
            Undo
          </Button>
        </>
      )}
      <ErrorNote error={translating.error} />
    </div>
  )
}
