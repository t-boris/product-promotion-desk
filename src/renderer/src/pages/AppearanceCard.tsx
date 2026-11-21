import type { ReactNode } from 'react'
import { SYSTEM_THEMES, THEMES, THEME_CHOICES, type ThemeChoice, type ThemeId } from '../../../shared/themes'
import { call, useAction } from '../hooks'
import { Icon } from '../icons'
import { adoptSettings, previewAppearance, refreshAppearance, useAppearance } from '../theme'
import { Card, ErrorNote, Hint, Switch } from '../ui'

/** A miniature window painted with one theme's own tokens: the sidebar, the page, a card with two lines of text and the accent. */
function Swatch({ id }: { id: ThemeId }): ReactNode {
  return (
    <span className="theme-swatch" data-theme={id} aria-hidden="true">
      <span className="theme-swatch-side" />
      <span className="theme-swatch-page">
        <span className="theme-swatch-card">
          <span className="theme-swatch-bar" />
          <span className="theme-swatch-bar short" />
        </span>
        <span className="theme-swatch-accent" />
      </span>
    </span>
  )
}

function Preview({ choice }: { choice: ThemeChoice }): ReactNode {
  if (choice !== 'system') return <Swatch id={choice} />
  // "Follow macOS" shows both of its looks, the light one over the dark one, split along the diagonal.
  return (
    <span className="theme-split" aria-hidden="true">
      <Swatch id={SYSTEM_THEMES.light} />
      <span className="theme-split-dark">
        <Swatch id={SYSTEM_THEMES.dark} />
      </span>
    </span>
  )
}

const FOLLOW_MACOS = { label: 'Follow macOS', note: `${THEMES[SYSTEM_THEMES.light].label} in a light appearance, ${THEMES[SYSTEM_THEMES.dark].label} in a dark one` }

/**
 * Settings, Appearance (visual-system.md §33): the theme as a group of radio cards and the animated background as a switch. A choice shows
 * at once (theme.ts), is saved with the other settings, and is the same in every window. No filled button: the choice is the control.
 */
export function AppearanceCard() {
  const { settings, animation } = useAppearance()
  const [save, saving] = useAction(async (patch: { theme?: ThemeChoice; animatedBackground?: boolean }) => {
    previewAppearance(patch)
    try {
      adoptSettings(await call('app.settings.update', patch))
    } catch (error) {
      // Refused or not saved: the page goes back to what is stored, and the reason is shown below.
      await refreshAppearance()
      throw error
    }
  })

  return (
    <Card title="Appearance">
      <Hint>
        A theme changes the backgrounds, the surfaces and the accent colour, and nothing else: red still means a failure, amber a decision and green a success, in every theme.
      </Hint>
      <ErrorNote error={saving.error} />
      <div className="rows">
        <div className="theme-block">
          <div className="field-label" id="theme-label">
            Theme
          </div>
          <div className="theme-grid" role="radiogroup" aria-labelledby="theme-label" data-testid="theme-picker">
            {THEME_CHOICES.map((choice) => {
              const label = choice === 'system' ? FOLLOW_MACOS.label : THEMES[choice].label
              const note = choice === 'system' ? FOLLOW_MACOS.note : THEMES[choice].character
              return (
                <label key={choice} className="theme-option">
                  <input
                    type="radio"
                    name="theme"
                    value={choice}
                    checked={settings.theme === choice}
                    onChange={() => void save({ theme: choice })}
                    aria-labelledby={`theme-name-${choice}`}
                    aria-describedby={`theme-note-${choice}`}
                    data-testid={`theme-option-${choice}`}
                  />
                  <Preview choice={choice} />
                  <span className="theme-title">
                    <span className="theme-name" id={`theme-name-${choice}`}>
                      {label}
                    </span>
                    <span className="theme-check" aria-hidden="true">
                      <Icon name="check" />
                    </span>
                  </span>
                  <span className="theme-note" id={`theme-note-${choice}`}>
                    {note}
                  </span>
                </label>
              )
            })}
          </div>
        </div>
        <div className="group-row">
          <Switch
            checked={settings.animatedBackground}
            disabled={animation.locked}
            onChange={(next) => void save({ animatedBackground: next })}
            label="Animated background"
            note={animation.reason ?? 'A slow, soft glow behind the pages. Off unless you turn it on.'}
            testId="animated-background-switch"
          />
        </div>
      </div>
    </Card>
  )
}
