import { useEffect, useState, type ReactNode } from 'react'
import { parseBlocks, platformLabel, renderForPlatform, sendProblems, type Block, type Inline, type PostContent, type RenderedPost } from '../../../../shared/post-format'
import { PREVIEW_PLATFORMS, counterFor, fold, initialOf, previewKind, sketchNote, visiblePictures, whereLine, type PreviewKind } from '../../../../shared/post-preview'
import { CopyButton } from '../channels/CopyButton'
import { useThumbs } from './useMedia'

/** The marks of a text as React elements: no HTML is ever built from the text, and a link is shown, never followed. */
function inline(nodes: Inline[], soft: 'space' | 'line', prefix: string): ReactNode[] {
  return nodes.map((node, index): ReactNode => {
    const key = `${prefix}${index}`
    switch (node.t) {
      case 'text':
        return node.v
      case 'strong':
        return <strong key={key}>{inline(node.c, soft, `${key}.`)}</strong>
      case 'em':
        return <em key={key}>{inline(node.c, soft, `${key}.`)}</em>
      case 'code':
        return <code key={key}>{node.v}</code>
      case 'link':
        return (
          <span key={key} className="post-preview-link" title={node.href}>
            {inline(node.c, soft, `${key}.`)}
          </span>
        )
      case 'image':
        return null
      case 'br':
        return node.hard || soft === 'line' ? <br key={key} /> : ' '
    }
  })
}

function blocks(list: Block[]): ReactNode[] {
  return list.map((block, index): ReactNode => {
    const key = `b${index}`
    switch (block.t) {
      case 'p':
        return <p key={key}>{inline(block.c, 'space', `${key}.`)}</p>
      case 'h': {
        const Tag = `h${Math.min(6, block.level + 1)}` as 'h2'
        return <Tag key={key}>{inline(block.c, 'space', `${key}.`)}</Tag>
      }
      case 'ul':
        return (
          <ul key={key}>
            {block.items.map((item, i) => (
              <li key={i} style={block.depths[i] > 0 ? { marginLeft: `${block.depths[i] * 1.25}em` } : undefined}>
                {inline(item, 'space', `${key}.${i}.`)}
              </li>
            ))}
          </ul>
        )
      case 'ol':
        return (
          <ol key={key} start={block.start}>
            {block.items.map((item, i) => (
              <li key={i} style={block.depths[i] > 0 ? { marginLeft: `${block.depths[i] * 1.25}em` } : undefined}>
                {inline(item, 'space', `${key}.${i}.`)}
              </li>
            ))}
          </ol>
        )
      case 'quote':
        return (
          <blockquote key={key}>
            {block.c.map((paragraph, i) => (
              <p key={i}>{inline(paragraph, 'space', `${key}.${i}.`)}</p>
            ))}
          </blockquote>
        )
      case 'pre':
        return <pre key={key}>{block.v}</pre>
      case 'hr':
        return <hr key={key} />
    }
  })
}

/** Who the post is from and where it goes, as the sketch names them. */
export interface PostAuthor {
  /** The account's name ("selena"). */
  name: string
  /** The channel's address ("r/astrology"); only Reddit shows it. */
  target: string
}

type Thumbs = Record<string, string>

/** The pictures of the post in the layout of the platform: one after another (Reddit), a grid with "+N" (a feed), an album (a chat), the first with a count (Instagram). */
function Pictures({ rendered, kind, thumbs }: { rendered: RenderedPost; kind: PreviewKind; thumbs: Thumbs }) {
  const all = rendered.attachments
  const { shown, more } = visiblePictures(kind, all.length)
  if (shown === 0) return null
  const items = all.slice(0, shown)
  return (
    <div className={`pv-pictures pv-pictures-${kind} n${Math.min(shown, 4)}`} data-testid="preview-pictures">
      {items.map((a, index) => (
        <div key={a.mediaId ?? a.path} className="pv-picture">
          {a.mediaId && thumbs[a.mediaId] ? <img src={thumbs[a.mediaId]} alt={a.name} /> : <span className="muted small">{a.name}</span>}
          {more > 0 && index === items.length - 1 && kind !== 'instagram' && <span className="pv-more">+{more}</span>}
        </div>
      ))}
      {kind === 'instagram' && all.length > 1 && <span className="pv-count">1 / {all.length}</span>}
    </div>
  )
}

function Author({ author, kind, line }: { author: PostAuthor; kind: PreviewKind; line?: string }) {
  return (
    <div className="pv-author">
      <span className="pv-avatar" aria-hidden="true">
        {initialOf(author.name)}
      </span>
      <span className="pv-author-text">
        <span className="pv-author-name">{kind === 'reddit' ? whereLine(kind, author.target, author.name) : author.name}</span>
        {line && <span className="pv-author-line muted small">{line}</span>}
      </span>
    </div>
  )
}

function Words({ rendered, markdown }: { rendered: RenderedPost; markdown: boolean }) {
  return markdown ? <div className="pv-words marked">{blocks(parseBlocks(rendered.text))}</div> : rendered.text !== '' ? <div className="pv-words pv-plain">{rendered.text}</div> : null
}

function Sketch({ rendered, kind, author, thumbs, markdown }: { rendered: RenderedPost; kind: PreviewKind; author: PostAuthor; thumbs: Thumbs; markdown: boolean }) {
  const link = rendered.link ? <div className="pv-link small">{rendered.link}</div> : null
  const pictures = <Pictures rendered={rendered} kind={kind} thumbs={thumbs} />
  switch (kind) {
    case 'reddit':
      return (
        <>
          <Author author={author} kind={kind} />
          {rendered.title && <div className="pv-title">{rendered.title}</div>}
          <Words rendered={rendered} markdown={markdown} />
          {pictures}
          {link}
        </>
      )
    case 'instagram': {
      const { shown, hidden } = fold(rendered.text, kind)
      return (
        <>
          <Author author={author} kind={kind} />
          {rendered.attachments.length > 0 ? pictures : <div className="pv-pictures pv-pictures-instagram pv-needed">Instagram needs a picture: add one.</div>}
          <div className="pv-caption">
            <strong>{author.name || 'account'}</strong> {shown}
            {hidden !== '' && <span className="muted"> … more</span>}
          </div>
          {link}
        </>
      )
    }
    case 'feed':
      return (
        <>
          <Author author={author} kind={kind} />
          <Words rendered={rendered} markdown={false} />
          {link}
          {pictures}
        </>
      )
    case 'short':
      return (
        <div className="pv-short">
          <span className="pv-avatar" aria-hidden="true">
            {initialOf(author.name)}
          </span>
          <div className="pv-short-body">
            <span className="pv-author-name">{author.name || 'account'}</span>
            <Words rendered={rendered} markdown={false} />
            {link}
            {pictures}
          </div>
        </div>
      )
    case 'chat':
      return (
        <div className="pv-bubble">
          {pictures}
          <Words rendered={rendered} markdown={false} />
          {link}
        </div>
      )
    default:
      return (
        <>
          <Words rendered={rendered} markdown={false} />
          {link}
          {pictures}
        </>
      )
  }
}

/**
 * The post as a platform shows it (DEC-030), from the same function the application sends with: what is here is what goes out. Each platform
 * has its own sketch (Reddit a titled post, Instagram a picture over a caption, Facebook a feed post, Threads and X a short post, Telegram a
 * message), and the owner can look at the post as any of them: the platform of the channel is the start. Below the sketch, in words, what
 * the platform changes in the post and why it cannot be sent, if it cannot.
 */
/** The post as one text to paste into a site by hand: the title, the words and the link, each on its own paragraph. */
export const postAsText = (rendered: { title: string | null; text: string; link: string | null }): string =>
  [rendered.title, rendered.text, rendered.link].filter((part): part is string => typeof part === 'string' && part.trim() !== '').join('\n\n')

export function PostPreview({ content, channelPlatform, author }: { content: PostContent; channelPlatform: string; author: PostAuthor }) {
  const [platform, setPlatform] = useState(channelPlatform)
  // A different channel starts at its own platform again.
  useEffect(() => setPlatform(channelPlatform), [channelPlatform])
  const choices = PREVIEW_PLATFORMS.some((p) => p.platform === channelPlatform) ? PREVIEW_PLATFORMS : [...PREVIEW_PLATFORMS, { platform: channelPlatform, label: platformLabel(channelPlatform) }]
  const kind = previewKind(platform)
  const rendered = renderForPlatform(content, platform)
  const problems = content.markup === 'markdown' ? sendProblems(platform, rendered) : []
  const ids = rendered.attachments.map((a) => a.mediaId).filter((id): id is string => id !== undefined)
  const thumbs = useThumbs(ids, 320)
  const empty = !rendered.title && rendered.text.trim() === '' && rendered.attachments.length === 0 && !rendered.link
  const markdown = rendered.format === 'markdown' && content.markup === 'markdown'
  const counter = counterFor(platform, rendered.text)
  return (
    <section className="post-preview" aria-label={`The post as ${platformLabel(platform)} shows it`} data-testid="post-preview" data-platform={platform}>
      <div className="post-preview-head">
        <label className="post-preview-pick">
          <span className="post-preview-title">Preview as</span>
          <select className="input" value={platform} onChange={(e) => setPlatform(e.target.value)} data-testid="preview-platform">
            {choices.map((p) => (
              <option key={p.platform} value={p.platform}>
                {p.label}
                {p.platform === channelPlatform ? ' (this channel)' : ''}
              </option>
            ))}
          </select>
        </label>
        {counter && (
          <span className={`post-preview-count small${counter.over ? ' over' : ' muted'}`} data-testid="preview-count">
            {counter.label}
          </span>
        )}
      </div>
      <div className={`pv pv-${kind}`} data-testid="preview-sketch" data-kind={kind}>
        {empty ? <div className="muted small">Nothing to show yet.</div> : <Sketch rendered={rendered} kind={kind} author={author} thumbs={thumbs} markdown={markdown} />}
      </div>
      <div className="muted small">{sketchNote(platform, channelPlatform)}</div>
      {!empty && (
        <div className="post-preview-copy">
          <CopyButton text={postAsText(rendered)} label="Copy post" testId="copy-post" />
          <span className="muted small">The words as {platformLabel(platform)} receives them, to publish by hand.</span>
        </div>
      )}
      {rendered.notes.length > 0 && (
        <ul className="post-preview-notes muted small" data-testid="post-notes">
          {rendered.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}
      {problems.length > 0 && (
        <ul className="post-preview-problems small" data-testid="post-problems">
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}
    </section>
  )
}
