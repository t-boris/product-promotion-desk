import { useEffect, useState, type ReactNode } from 'react'
import { judgedForFit, parseBlocks, platformLabel, renderForPlatform, sendProblems, type Block, type Inline, type PostContent, type RenderedPost } from '../../../../shared/post-format'
import { PREVIEW_PLATFORMS, counterFor, fold, initialOf, previewKind, sketchNote, sketchNoteLook, visiblePictures, whereLine, type PreviewKind } from '../../../../shared/post-preview'
import type { CardShape } from '../../../../shared/quick-post'
import { ViewableImage } from '../../pictures/ViewableImage'
import { CARD_PICTURE_NAME, drawnPicture, mediaPicture } from '../../pictures/picture-viewer'
import { CopyButton } from '../channels/CopyButton'
import { previewPlatformOf } from './quick/preview-model'
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

/** A picture that is not saved yet and is drawn from what is on the screen (the card of a quick post): the first picture of the post that has no library id. */
export interface LivePicture {
  url: string
  alt: string
}

/** The pictures of the post in the layout of the platform: one after another (Reddit), a grid with "+N" (a feed), an album (a chat), the first with a count (Instagram). */
function Pictures({ rendered, kind, thumbs, live }: { rendered: RenderedPost; kind: PreviewKind; thumbs: Thumbs; live?: LivePicture }) {
  const all = rendered.attachments
  const { shown, more } = visiblePictures(kind, all.length)
  if (shown === 0) return null
  const items = all.slice(0, shown)
  // Every picture of the post that is in the library opens large, among the others of the post (also the ones the layout counts as "+N"); the card of a quick post is drawn on the screen.
  const viewable = all.flatMap((a) => (a.mediaId ? [mediaPicture({ id: a.mediaId, name: a.name }, thumbs[a.mediaId])] : []))
  return (
    <div className={`pv-pictures pv-pictures-${kind} n${Math.min(shown, 4)}`} data-testid="preview-pictures">
      {items.map((a, index) => (
        <div key={a.mediaId ?? a.path} className="pv-picture">
          {a.mediaId && thumbs[a.mediaId] ? (
            <ViewableImage src={thumbs[a.mediaId]} alt={a.name} picture={viewable.find((v) => v.key === a.mediaId) ?? viewable[0]} group={viewable} index={Math.max(0, viewable.findIndex((v) => v.key === a.mediaId))} />
          ) : live && index === 0 && !a.mediaId ? (
            <ViewableImage src={live.url} alt={live.alt} picture={drawnPicture(live.url, CARD_PICTURE_NAME, live.alt)} data-testid="preview-live-picture" />
          ) : <span className="muted small">{a.name}</span>}
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

function Sketch({ rendered, kind, author, thumbs, markdown, live }: { rendered: RenderedPost; kind: PreviewKind; author: PostAuthor; thumbs: Thumbs; markdown: boolean; live?: LivePicture }) {
  const link = rendered.link ? <div className="pv-link small">{rendered.link}</div> : null
  const pictures = <Pictures rendered={rendered} kind={kind} thumbs={thumbs} live={live} />
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

export function PostPreview({
  content,
  channelPlatform,
  author,
  aiBrowser = false,
  noConnector = false,
  platforms,
  ticked,
  livePicture,
  pictureShape
}: {
  content: PostContent
  channelPlatform: string
  author: PostAuthor
  /** The AI publishes in the account's browser (chosen in Settings, or the channel has no other way): pictures then go to any platform that takes them. */
  aiBrowser?: boolean
  /** The application does not read the channel, so no connector can post to it (DEC-035). */
  noConnector?: boolean
  /**
   * The platforms the owner can look at the post as, when they are only the channels it goes to (the quick-post composer): the pop-up offers these and
   * no other, and the sketch's note speaks of the platform shown, since each of them is a place the post is going.
   */
  platforms?: readonly string[]
  /** Of `platforms`, the ones the post goes to; the others are only a look (they are marked "not selected"). All of them when absent. */
  ticked?: readonly string[]
  /** The first picture of the post without a library id, drawn from what is on the screen (the card of a quick post that is not saved yet). */
  livePicture?: LivePicture
  /** The shape of the picture when it is known (the card's): the sketch gives the picture that shape instead of its own. */
  pictureShape?: CardShape
}) {
  const [picked, setPicked] = useState(channelPlatform)
  // A different channel starts at its own platform again.
  useEffect(() => setPicked(channelPlatform), [channelPlatform])
  const platform = platforms ? (previewPlatformOf(picked, platforms) ?? channelPlatform) : picked
  const choices = platforms
    ? platforms.map((p) => ({ platform: p, label: `${platformLabel(p)}${ticked && !ticked.includes(p) ? ' (not selected)' : ''}` }))
    : PREVIEW_PLATFORMS.some((p) => p.platform === channelPlatform)
      ? PREVIEW_PLATFORMS
      : [...PREVIEW_PLATFORMS, { platform: channelPlatform, label: platformLabel(channelPlatform) }]
  const kind = previewKind(platform)
  const rendered = renderForPlatform(content, platform)
  // An older draft is judged by its connector; the one thing said of it is that a link added to the end of the text took it over the limit (DEC-036). A quick post is judged whole, like a post written in the editor (its picture's own rules are shown by the composer).
  const problems = judgedForFit(content) ? sendProblems(platform, rendered, { aiBrowser, ...(noConnector ? { noConnector } : {}) }) : rendered.problems
  const ids = rendered.attachments.map((a) => a.mediaId).filter((id): id is string => id !== undefined)
  const thumbs = useThumbs(ids, 320)
  const empty = !rendered.title && rendered.text.trim() === '' && rendered.attachments.length === 0 && !rendered.link
  const markdown = rendered.format === 'markdown' && content.markup === 'markdown'
  const counter = counterFor(platform, rendered.text)
  return (
    <section className="post-preview" aria-label={`The post as ${platformLabel(platform)} shows it`} data-testid="post-preview" data-platform={platform} data-shape={pictureShape}>
      <div className="post-preview-head">
        <label className="post-preview-pick">
          <span className="post-preview-title">Preview as</span>
          <select className="input" value={platform} onChange={(e) => setPicked(e.target.value)} data-testid="preview-platform">
            {choices.map((p) => (
              <option key={p.platform} value={p.platform}>
                {p.label}
                {!platforms && p.platform === channelPlatform ? ' (this channel)' : ''}
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
        {empty ? <div className="muted small">Nothing to show yet.</div> : <Sketch rendered={rendered} kind={kind} author={author} thumbs={thumbs} markdown={markdown} live={livePicture} />}
      </div>
      <div className="muted small">{platforms && ticked && !ticked.includes(platform) ? sketchNoteLook(platform) : sketchNote(platform, platforms ? platform : channelPlatform)}</div>
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
