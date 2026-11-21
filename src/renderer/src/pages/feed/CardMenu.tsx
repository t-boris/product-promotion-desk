import { IconButton, MenuItem, usePopover } from '../../ui'

/** What the menu of a card offers, and what is true of the post it is on. */
export interface CardMenuState {
  /** The owner has not read the post (the card is unread). */
  unread: boolean
  /** The AI read the post in full: "Check again with AI" is offered here; a post it has not read has that button on the card itself. */
  aiRead: boolean
  checking: boolean
  /** "Read the post" (the text of the post and what to do when it has none) is open under the card. */
  readOpen: boolean
}

/** The entries of the card's menu: Mark as read / unread, Check again with AI, Read the post. */
export function CardMenuItems({ state, onToggleRead, onCheck, onReadPost }: { state: CardMenuState; onToggleRead: () => void; onCheck: () => void; onReadPost: () => void }) {
  return (
    <>
      <MenuItem onClick={onToggleRead} data-testid="stream-mark" data-state={state.unread ? 'unread' : 'read'}>
        {state.unread ? 'Mark as read' : 'Mark as unread'}
      </MenuItem>
      {state.aiRead && (
        <MenuItem onClick={onCheck} disabled={state.checking} data-testid="stream-check-ai">
          {state.checking ? 'Reading…' : 'Check again with AI'}
        </MenuItem>
      )}
      <MenuItem onClick={onReadPost} data-testid="post-read" aria-pressed={state.readOpen}>
        Read the post
      </MenuItem>
    </>
  )
}

/** The "⋯" of a card: what is done to the post as a whole, not to read it. A press on an entry closes the menu. */
export function CardMenu({ state, onToggleRead, onCheck, onReadPost }: { state: CardMenuState; onToggleRead: () => void; onCheck: () => void; onReadPost: () => void }) {
  const { open, setOpen, box } = usePopover()
  const done = (act: () => void) => (): void => {
    setOpen(false)
    act()
  }
  return (
    <div className="menu" ref={box}>
      <IconButton icon="ellipsis" label="More for this post" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)} data-testid="stream-menu" />
      {open && (
        <div className="menu-pop card-menu-pop" role="menu" data-testid="stream-menu-pop">
          <CardMenuItems state={state} onToggleRead={done(onToggleRead)} onCheck={done(onCheck)} onReadPost={done(onReadPost)} />
        </div>
      )}
    </div>
  )
}
