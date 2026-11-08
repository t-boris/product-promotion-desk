// Test-only helpers for the universal connector. Not imported by production code.

import { FakePage } from '../../core/testing/fakes'
import type { SiteProfile } from './profile'
import type { RawItem } from './reader'

export function validProfileDefinition(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: 1,
    name: 'Example forum',
    host: 'forum.example.com',
    channelUrls: ['https://forum.example.com/c/*'],
    discussionUrls: ['https://forum.example.com/t/*'],
    loginUrl: 'https://forum.example.com/login',
    login: { loggedInSelector: '#current-user', identitySelector: '#current-user .name', captchaSelector: '.captcha' },
    discussions: {
      containerSelector: 'ul.topics',
      itemSelector: 'li.topic',
      id: { attr: 'data-id' },
      title: { selector: 'a.title' },
      author: { selector: '.author' },
      body: { selector: '.excerpt' },
      permalink: { selector: 'a.title', attr: 'href' },
      time: { selector: 'time', attr: 'datetime' }
    },
    comments: {
      containerSelector: 'div.posts',
      itemSelector: 'div.post',
      id: { attr: 'data-id' },
      author: { selector: '.author' },
      body: { selector: '.body' },
      permalink: { selector: 'a.permalink', attr: 'href' },
      time: { selector: 'time', attr: 'datetime' },
      parentId: { attr: 'data-parent' }
    },
    ownContent: {
      url: 'https://forum.example.com/u/{{identity}}/posts',
      reader: {
        containerSelector: 'div.mine',
        itemSelector: 'div.post',
        id: { attr: 'data-id' },
        title: { selector: '.title' },
        body: { selector: '.body' },
        permalink: { selector: 'a.permalink', attr: 'href' },
        time: { selector: 'time', attr: 'datetime' },
        parentId: { attr: 'data-parent' }
      }
    },
    publish: {
      post: {
        steps: [
          { type: 'goto', url: '{{channelUrl}}' },
          { type: 'waitFor', selector: 'button.new-topic' },
          { type: 'click', selector: 'button.new-topic' },
          { type: 'fill', selector: 'input.title', value: '{{title}}' },
          { type: 'fill', selector: 'textarea.editor', value: '{{text}}' },
          { type: 'click', selector: 'button.submit' }
        ],
        verify: { urlGlob: 'https://forum.example.com/t/{id}', textIncludes: '{{title}}', errorSelector: '.alert-error' }
      },
      reply: {
        steps: [
          { type: 'goto', url: '{{destination}}' },
          { type: 'waitFor', selector: 'div.post[data-id="{{parentId}}"]' },
          { type: 'click', selector: 'div.post[data-id="{{parentId}}"] button.reply' },
          { type: 'fill', selector: 'textarea.editor', value: '{{text}}' },
          { type: 'click', selector: 'button.submit' }
        ],
        verify: { selector: 'div.post.mine', errorSelector: '.alert-error' }
      }
    },
    metrics: [{ key: 'members', label: 'Members', selector: '.member-count' }],
    rulesUrl: 'https://forum.example.com/rules',
    rulesSelector: 'div.rules',
    ...over
  }
}

interface SitePage {
  selectors: Set<string>
  items: Record<string, RawItem[]>
  texts: Record<string, string>
  pageText: string
}

/** A page that serves scripted "sites": per URL, which selectors exist and which items each item selector yields. */
export class SiteFakePage extends FakePage {
  readonly site = new Map<string, SitePage>()
  login = { loggedIn: true, identity: 'natal', captcha: false }
  gate = { captcha: false, blocked: false, title: 'Forum', signal: '' }
  /** What the session probe sees (a site we have no profile for): by default a drawn page that does not ask to sign in. */
  session = { signedOut: false, signal: '', textLength: 5000 }
  sessionLooks = 0
  errors: string[] = []
  /** URL the page lands on after the last click of a flow (simulates the result page). */
  afterSubmitUrl: string | null = null
  failOnClickAt: number | null = null
  private clicks = 0
  private landed = false

  get writes(): string[] {
    return this.log.filter((entry) => /^(fill|click|upload) /.test(entry))
  }

  at(url: string, page: Partial<SitePage> = {}): SitePage {
    const entry: SitePage = { selectors: new Set(), items: {}, texts: {}, pageText: '', ...page }
    this.site.set(url, entry)
    return entry
  }

  private current(): SitePage | undefined {
    return this.site.get(this.currentUrl)
  }

  override async url(): Promise<string> {
    return this.landed && this.afterSubmitUrl ? this.afterSubmitUrl : this.currentUrl
  }

  override async goto(url: string): Promise<void> {
    this.landed = false
    await super.goto(url)
  }

  override async waitForSelector(selector: string): Promise<boolean> {
    this.log.push(`wait ${selector}`)
    const here = this.landed && this.afterSubmitUrl ? this.site.get(this.afterSubmitUrl) : this.current()
    return here?.selectors.has(selector) ?? false
  }

  override async click(selector: string): Promise<void> {
    await super.click(selector)
    this.clicks += 1
    if (this.failOnClickAt === this.clicks) throw new Error('page crashed')
    if (selector.includes('button.submit')) this.landed = true
  }

  override async read<T>(script: string): Promise<T> {
    if (script.includes('recaptcha')) return this.gate as T
    if (script.includes('session-probe')) {
      this.sessionLooks += 1
      return this.session as T
    }
    if (script.includes('loggedInSelector')) return this.login as T
    if (script.includes('cfg.fields')) {
      const config = JSON.parse(script.slice(script.lastIndexOf('})(') + 3, -1)) as { itemSelector: string; limit: number }
      return (this.current()?.items[config.itemSelector]?.slice(0, config.limit) ?? []) as T
    }
    if (script.includes('document.body ? document.body.innerText')) return ((this.landed && this.afterSubmitUrl ? this.site.get(this.afterSubmitUrl)?.pageText : this.current()?.pageText) ?? '') as T
    if (script.includes('getClientRects')) return this.errors as T
    if (script.includes('cfg.attr')) {
      const config = JSON.parse(script.slice(script.lastIndexOf('})(') + 3, -1)) as { selector: string }
      return (this.current()?.texts[config.selector] ?? null) as T
    }
    return super.read<T>(script)
  }
}

export const item = (over: Partial<RawItem> & { id: string }): RawItem => ({ title: '', author: '', body: '', permalink: '', time: '', parentId: '', ...over })

/** Serves the example forum of validProfileDefinition(). */
export function armForum(page: SiteFakePage): void {
  page.at('https://forum.example.com/c/news', {
    selectors: new Set(['ul.topics', 'li.topic', 'button.new-topic']),
    items: {
      'li.topic': [
        item({ id: 't2', title: 'Newer topic', author: 'ann', body: 'excerpt 2', permalink: 'https://forum.example.com/t/2', time: '2026-11-08T10:00:00Z' }),
        item({ id: 't1', title: 'Older topic', author: 'bob', body: 'excerpt 1', permalink: 'https://forum.example.com/t/1', time: '2026-11-07T10:00:00Z' })
      ]
    },
    texts: { '.member-count': '1.2k members' }
  })
  const thread = (id: string) => ({
    selectors: new Set(['div.posts', 'div.post', `div.post[data-id="${id}-p1"]`, 'textarea.editor']),
    items: {
      'div.post': [
        item({ id: `${id}-p1`, author: 'carl', body: 'first!', permalink: `https://forum.example.com/t/${id}#1`, time: '2026-11-08T10:05:00Z' }),
        item({ id: `${id}-p2`, author: 'dana', body: 'a reply', parentId: `${id}-p1`, permalink: `https://forum.example.com/t/${id}#2`, time: '2026-11-08T10:06:00Z' })
      ]
    }
  })
  page.at('https://forum.example.com/t/2', thread('t2'))
  page.at('https://forum.example.com/t/1', { ...thread('t1'), items: { 'div.post': [] } })
  page.at('https://forum.example.com/rules', { selectors: new Set(['div.rules']), texts: { 'div.rules': 'Be kind. Share your own work only on Fridays.' } })
  page.at('https://forum.example.com/u/natal/posts', {
    selectors: new Set(['div.mine', 'div.post']),
    items: { 'div.post': [item({ id: 'mine-1', body: 'My earlier reply', permalink: 'https://forum.example.com/t/2#9', time: '2026-11-08T12:00:00Z', parentId: 't2-p1' })] }
  })
}

export type { SiteProfile }
