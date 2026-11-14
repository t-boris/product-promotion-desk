import { describe, expect, it } from 'vitest'
import { disclosureProblem, mentionsProductIn, statesConnection } from './disclosure'

const NATAL = { name: 'Natal Mystic', websiteUrl: 'https://natalmystic.com' }
const text = (body: string, extra: { title?: string; link?: string } = {}) => ({ text: body, ...extra })

describe('what counts as mentioning the product', () => {
  it('finds the name as whole words, in any case, with any spacing', () => {
    expect(mentionsProductIn(text('Try Natal Mystic today'), NATAL)).toBe(true)
    expect(mentionsProductIn(text('try NATAL   mystic today'), NATAL)).toBe(true)
    expect(mentionsProductIn(text('natal mystic'), NATAL)).toBe(true)
    expect(mentionsProductIn(text('Natal Mystic.'), NATAL)).toBe(true)
  })

  it('finds the name in the title and the website in the text or the link', () => {
    expect(mentionsProductIn({ title: 'Natal Mystic update', text: 'Charts got faster.' }, NATAL)).toBe(true)
    expect(mentionsProductIn(text('See natalmystic.com for the details'), NATAL)).toBe(true)
    expect(mentionsProductIn(text('See https://www.natalmystic.com/pricing'), NATAL)).toBe(true)
    expect(mentionsProductIn(text('Charts got faster.', { link: 'https://natalmystic.com/blog' }), NATAL)).toBe(true)
    expect(mentionsProductIn(text('Charts got faster.', { link: 'https://app.natalmystic.com/' }), NATAL)).toBe(true)
  })

  it('does not mistake other words, other hosts or a look-alike host for the product', () => {
    expect(mentionsProductIn(text('A natal chart shows where the planets stood when you were born.'), NATAL)).toBe(false)
    expect(mentionsProductIn(text('It is a mystic experience, truly natal.'), NATAL)).toBe(false)
    expect(mentionsProductIn(text('Natal Mysticism is a broader subject'), NATAL)).toBe(false)
    expect(mentionsProductIn(text('See evilnatalmystic.com'), NATAL)).toBe(false)
    expect(mentionsProductIn(text('See natalmystic.com.evil.example'), NATAL)).toBe(false)
    expect(mentionsProductIn(text('Read this', { link: 'https://example.org/natalmystic.com' }), NATAL)).toBe(false)
    expect(mentionsProductIn(text('Read this', { link: 'https://notnatalmystic.com/' }), NATAL)).toBe(false)
    expect(mentionsProductIn(text('anything'), { name: '', websiteUrl: null })).toBe(false)
  })

  it('treats a short one-word name as the product only when written as it is, because it is also an ordinary word', () => {
    const pulse = { name: 'Pulse', websiteUrl: null }
    expect(mentionsProductIn(text('Pulse helps you track your heart rate'), pulse)).toBe(true)
    expect(mentionsProductIn(text('Check your pulse after running'), pulse)).toBe(false)
    expect(mentionsProductIn(text('PULSE is great'), pulse)).toBe(false)
    // A longer single word is distinctive enough to be matched whatever its case.
    expect(mentionsProductIn(text('astrolabe is great'), { name: 'Astrolabe', websiteUrl: null })).toBe(true)
  })

  it('handles names with punctuation and names in other alphabets', () => {
    expect(mentionsProductIn(text('We like C++ Studio a lot'), { name: 'C++ Studio', websiteUrl: null })).toBe(true)
    expect(mentionsProductIn(text('Приложение Натальная Карта строит карту'), { name: 'Натальная Карта', websiteUrl: null })).toBe(true)
    expect(mentionsProductIn(text('натальная картина мира'), { name: 'Натальная Карта', websiteUrl: null })).toBe(false)
  })
})

describe('what counts as stating the connection', () => {
  const says = (body: string) => statesConnection(text(body), NATAL)

  it.each([
    'I work on Natal Mystic.',
    'I work on it, so take this with a grain of salt.',
    "I'm the developer of Natal Mystic.",
    'I am the creator of this app.',
    "I'm one of the makers.",
    'We are the team behind it.',
    "I'm a founder of Natal Mystic.",
    "I'm a solo developer.",
    'I built Natal Mystic for exactly this.',
    "I've built this myself.",
    'We made it because charts were slow.',
    'Disclosure: I am connected with Natal Mystic.',
    'Full disclosure, this is my app.',
    'As the founder of Natal Mystic I can say it is free.',
    'Я разработчик Natal Mystic.',
    'Я сделал это приложение сам.',
    'Раскрытие информации: я работаю над Natal Mystic.',
    'Это наш продукт.'
  ])('accepts: %s', (sentence) => {
    expect(says(sentence)).toBe(true)
  })

  it('accepts a statement anywhere in a longer text, and in the title', () => {
    expect(says('Natal Mystic builds a chart from your birth data.\nIt is free for a week.\nDisclosure: I work on it.')).toBe(true)
    expect(statesConnection({ title: 'Why I built Natal Mystic', text: 'It started with a spreadsheet.' }, NATAL)).toBe(true)
  })

  it.each([
    'Natal Mystic builds a natal chart from your birth data.',
    'I love Natal Mystic, it changed my mornings.',
    'I use Natal Mystic every day and it is great.',
    'I found Natal Mystic on a forum last week.',
    'My friend built Natal Mystic.',
    'You can build charts with it.',
    'They work on it.',
    'I work in a bank and this is not related.',
    'Thanks, I will try it!',
    'Natal Mystic, the developers say, is free.',
    'Я пользуюсь Natal Mystic каждый день.',
    // A possessive that is the subject of a clause is not the product by being near it (see the table of possessives below).
    'Our product does that too.'
  ])('rejects: %s', (sentence) => {
    expect(says(sentence)).toBe(false)
  })
})

describe('the verdict', () => {
  it('never touches a text that does not mention the product, whatever else it says', () => {
    expect(disclosureProblem(text('Glad you like it, enjoy!'), NATAL)).toBeNull()
    expect(disclosureProblem(text('A natal chart needs the exact birth time.'), NATAL)).toBeNull()
    expect(disclosureProblem(text('Thanks!', { link: 'https://example.org/' }), NATAL)).toBeNull()
    expect(disclosureProblem({ title: 'Reading charts', text: 'The houses matter most.' }, NATAL)).toBeNull()
  })

  it('refuses a text that mentions the product without saying the author is connected, and says how to fix it', () => {
    const problem = disclosureProblem(text('Natal Mystic builds a natal chart from your birth data.'), NATAL)
    expect(problem).toContain('Natal Mystic')
    expect(problem).toContain('does not say that you are connected')
    expect(problem).toContain('Disclosure')
    expect(disclosureProblem(text('Charts got faster.', { link: 'https://natalmystic.com' }), NATAL)).not.toBeNull()
  })

  it('lets a text through that mentions the product and says it', () => {
    expect(disclosureProblem(text('I work on Natal Mystic; it builds a chart from your birth data.'), NATAL)).toBeNull()
    expect(disclosureProblem(text('Charts got faster.\nDisclosure: I am the developer.', { link: 'https://natalmystic.com' }), NATAL)).toBeNull()
  })

  it('does not decide on a statement that is about something else than the product', () => {
    // The author says "I built" about a different thing: the sentence is not about the product, so it does not disclose.
    expect(disclosureProblem(text('I built a shed last summer. Natal Mystic is a nice chart app.'), NATAL)).not.toBeNull()
  })
})

// The samples of the independent review of the post mission (finding H3): each of these passed the check while it denied the
// connection or only told what a customer says.
describe('a denial is never a disclosure, and is itself a problem', () => {
  it.each([
    "No affiliation, just a happy user.",
    "I'm not affiliated with Natal Mystic",
    "Disclaimer: I have no connection to Natal Mystic.",
    "I'm not a developer of Natal Mystic",
    "I'm not the developer behind Natal Mystic",
    "Natal Mystic is great. Not affiliated, just a fan.",
    'Natal Mystic is great, and I have no ties to them.',
    'Natal Mystic is great. I am in no way connected with them.',
    "Full disclosure: I don't work for Natal Mystic.",
    'Honest review of Natal Mystic. This is not an ad.',
    'Natal Mystic is great. No conflict of interest here.',
    'Natal Mystic works. Unaffiliated, I just use it.',
    "We're not the team behind Natal Mystic, we just like it.",
    'I did not create Natal Mystic, I only use it.',
    'Natal Mystic is great. I have nothing to do with the company.',
    'Disclosure: I am just a customer of Natal Mystic.',
    'Я не связан с Natal Mystic, просто пользуюсь.',
    'Natal Mystic отличный. Нет никакой связи, я просто пользователь.',
    'Я не разработчик Natal Mystic.',
    'Natal Mystic хорош. Это не реклама.'
  ])('refuses: %s', (body) => {
    const problem = disclosureProblem(text(body), NATAL)
    expect(problem).not.toBeNull()
    expect(problem).toContain('not connected')
  })

  it('refuses a denial in the title, or next to a link to the product', () => {
    expect(disclosureProblem({ title: 'No affiliation, just a fan', text: 'Charts got faster.' }, NATAL)).toContain('not connected')
    expect(disclosureProblem(text('No affiliation, just a happy user.', { link: 'https://natalmystic.com/' }), NATAL)).toContain('not connected')
  })

  it('refuses a denial that names nobody, also in a text that does not mention the product', () => {
    expect(disclosureProblem(text('No affiliation, just a happy user.'), NATAL)).toContain('not connected')
    expect(disclosureProblem(text("I'm not affiliated, I just use it."), NATAL)).toContain('not connected')
    expect(disclosureProblem(text('Я просто пользователь.'), NATAL)).toContain('not connected')
  })

  it('leaves alone a denial that is about something else, in a text that does not mention the product', () => {
    expect(disclosureProblem(text("I'm not affiliated with Reddit, but the rules say so."), NATAL)).toBeNull()
    expect(disclosureProblem(text('Not connected to the company that runs the forum.'), NATAL)).not.toBeNull() // names nobody: bare
  })

  it('a denial beats a statement: the text is refused even when it also says it is connected', () => {
    const body = "I'm the developer of Natal Mystic. I'm not affiliated with Natal Mystic."
    expect(statesConnection(text(body), NATAL)).toBe(false)
    expect(disclosureProblem(text(body), NATAL)).toContain('not connected')
  })

  it('does not take a denial for what it is not', () => {
    for (const body of [
      "I work on Natal Mystic. I'm not sure I built it right.",
      "I'm the developer of Natal Mystic, not just a user.",
      "I'm not a lawyer, but I'm the developer of Natal Mystic.",
      'Disclosure: I built Natal Mystic. There is no connection between the planets and your day, though.',
      "I'm the founder of Natal Mystic. I have no interest in astrology fads, only in good charts."
    ]) {
      expect(disclosureProblem(text(body), NATAL), body).toBeNull()
    }
  })
})

describe('a customer is not connected with the product', () => {
  it.each([
    'Natal Mystic fixed my site speed problems',
    'This saved my business: Natal Mystic.',
    'I used it for my project and Natal Mystic helped.',
    "I've built my whole workflow around Natal Mystic.",
    'I run it every day, Natal Mystic is great.',
    'I tried Natal Mystic and I made it work in five minutes.',
    'I built my site with Natal Mystic in a weekend.',
    'I made a video about Natal Mystic last week.',
    'My app works great with Natal Mystic.',
    "I work at a bank, and Natal Mystic is great.",
    'I wrote a long review of Natal Mystic.',
    'I started using Natal Mystic last year.',
    "I'm a founder of a small bank and I love Natal Mystic.",
    'We use Natal Mystic in our company.',
    'Our team loves Natal Mystic.',
    'The team behind Natal Mystic is great.',
    'Я сделал сайт с помощью Natal Mystic.',
    'Natal Mystic помог моему бизнесу.',
    'Я использовал Natal Mystic в моём проекте.'
  ])('does not count: %s', (body) => {
    expect(statesConnection(text(body), NATAL)).toBe(false)
    expect(disclosureProblem(text(body), NATAL)).toContain('does not say that you are connected')
  })
})

describe('honest disclosures still pass', () => {
  it.each([
    'Disclosure: I work on Natal Mystic',
    "Natal Mystic builds a chart from your birth data. I'm the developer of it.",
    'Natal Mystic строит натальную карту. Я разработчик Natal Mystic.',
    'Natal Mystic is free for a week. Disclosure: I am the developer.',
    'I built Natal Mystic, and it is free for a week.',
    "I'm one of the people behind Natal Mystic.",
    'We are the team behind Natal Mystic.',
    "I'm a co-founder of Natal Mystic.",
    'Natal Mystic is my app, so I am biased.',
    "It's my side project, Natal Mystic.",
    'Natal Mystic - my app. Charts got faster.',
    'My app Natal Mystic got faster charts.',
    'Natal Mystic is our product. Charts got faster.',
    'Our product Natal Mystic is free for a week.',
    'Full disclosure: I work on the app, Natal Mystic.',
    "I'm working on Natal Mystic and charts got faster.",
    'As the founder of Natal Mystic, I can say it is free.',
    'Я создал Natal Mystic, и карты стали быстрее.',
    'Natal Mystic — мой проект.',
    'Natal Mystic — это наш продукт.',
    'Раскрытие информации: я работаю над Natal Mystic.'
  ])('passes: %s', (body) => {
    expect(disclosureProblem(text(body), NATAL)).toBeNull()
  })
})

describe('what is written to hide the name, and what is only alike', () => {
  it.each([
    'Try NatalMystic today',
    'Try natal-mystic today',
    'Try Natal\u200BMystic today',
    'Try Nat\u200Bal Mystic today',
    'Try Natal\u2060 Mystic today',
    'Try Natal\u00ADMystic today',
    'Try Natal\uFEFFMystic today',
    'See natal\u200Bmystic.com',
    'See natalmystic\u200D.com'
  ])('still finds the product in: %s', (body) => {
    expect(mentionsProductIn(text(body), NATAL)).toBe(true)
    expect(disclosureProblem(text(body), NATAL)).toContain('does not say that you are connected')
  })

  it('sees through a hidden character in the link and in a statement', () => {
    expect(mentionsProductIn(text('Charts got faster.', { link: 'https://natal\u200Bmystic.com/blog' }), NATAL)).toBe(true)
    expect(disclosureProblem(text('Try Natal\u200BMystic. I\u200B am the developer of it.'), NATAL)).toBeNull()
    expect(disclosureProblem(text("Try NatalMystic. I'm not affili\u200Bated with it."), NATAL)).toContain('not connected')
  })

  it('does not take a joined or hyphenated look-alike for the name', () => {
    expect(mentionsProductIn(text('See natalmystic.com.evil.example'), NATAL)).toBe(false)
    expect(mentionsProductIn(text('See natalmysticism'), NATAL)).toBe(false)
    expect(mentionsProductIn(text('See supernatalmystic'), NATAL)).toBe(false)
    expect(mentionsProductIn(text('See natal-mysticism'), NATAL)).toBe(false)
  })
})

describe('a website on a host that holds many sites', () => {
  const TOOL = { name: 'ToolX', websiteUrl: 'https://github.com/me/toolx' }

  it('does not make every mention of the host a mention of the product', () => {
    expect(mentionsProductIn(text('I keep my code on github.com, of course'), TOOL)).toBe(false)
    expect(mentionsProductIn(text('See https://github.com/someone/else for another one'), TOOL)).toBe(false)
    expect(mentionsProductIn(text('Read this', { link: 'https://github.com/someone/else' }), TOOL)).toBe(false)
    expect(mentionsProductIn(text('Read this', { link: 'https://github.com/me' }), TOOL)).toBe(false)
    expect(mentionsProductIn(text('See github.com/me/toolx-two'), TOOL)).toBe(false)
    expect(mentionsProductIn(text('See github.com/me/toolx2'), TOOL)).toBe(false)
    expect(disclosureProblem(text('Thanks, I keep it on github.com too.'), TOOL)).toBeNull()
  })

  it('still finds the product by its own path', () => {
    expect(mentionsProductIn(text('See github.com/me/toolx for the source'), TOOL)).toBe(true)
    expect(mentionsProductIn(text('See https://github.com/me/toolx/issues/3'), TOOL)).toBe(true)
    expect(mentionsProductIn(text('See https://www.github.com/Me/ToolX.'), TOOL)).toBe(true)
    expect(mentionsProductIn(text('Read this', { link: 'https://github.com/me/toolx' }), TOOL)).toBe(true)
    expect(mentionsProductIn(text('Read this', { link: 'https://github.com/me/toolx/releases' }), TOOL)).toBe(true)
    expect(disclosureProblem(text('The source is at github.com/me/toolx'), TOOL)).toContain('does not say that you are connected')
  })

  it('names nothing by a bare shared host, and a site of its own is told by its host as before', () => {
    expect(mentionsProductIn(text('I keep my code on github.com'), { name: 'ToolX', websiteUrl: 'https://github.com' })).toBe(false)
    expect(mentionsProductIn(text('Read this', { link: 'https://github.com/anyone' }), { name: 'ToolX', websiteUrl: 'https://github.com/' })).toBe(false)
    const pages = { name: 'ToolX', websiteUrl: 'https://me.github.io' }
    expect(mentionsProductIn(text('See me.github.io'), pages)).toBe(true)
    expect(mentionsProductIn(text('See other.github.io'), pages)).toBe(false)
    expect(mentionsProductIn(text('See natalmystic.com/pricing'), { name: 'Natal Mystic', websiteUrl: 'https://natalmystic.com/app' })).toBe(true)
  })
})

describe('the documented trade-off for very short names', () => {
  it('a name of five letters or fewer matches only as written, so a sentence that starts with the word is taken for the product', () => {
    const go = { name: 'Go', websiteUrl: null }
    expect(mentionsProductIn(text('Go to settings and turn it off'), go)).toBe(true)
    expect(mentionsProductIn(text('you can go to settings'), go)).toBe(false)
    expect(disclosureProblem(text('Go to settings and turn it off'), go)).toContain('does not say that you are connected')
    expect(disclosureProblem(text('Go to settings. Disclosure: I work on Go.'), go)).toBeNull()
  })
})

// The samples of the second review (M-3): each of these passed the check while it said what a customer says, or only used a word.
describe('a label is not a statement', () => {
  it.each([
    'Disclosure: none. Natal Mystic is great.',
    'Disclosure: N/A. Natal Mystic is great.',
    'Disclosure: n/a Natal Mystic is great.',
    'No disclosure needed, Natal Mystic is great.',
    'Nothing to disclose. Natal Mystic is great.',
    'Conflict of interest: no. Natal Mystic is great.',
    'Affiliation: none. Natal Mystic is great.',
    "Disclosure: I'm a regular customer of Natal Mystic.",
    'Disclosure: I use Natal Mystic daily.',
    'Full transparency: I love Natal Mystic.',
    'Full disclosure: Natal Mystic changed my mornings.',
    'Self-promotion: Natal Mystic is great.',
    "I'm affiliated with Reddit. Natal Mystic is great.",
    'Раскрытие информации: нет. Natal Mystic отличный.',
    'Раскрытие информации: я пользуюсь Natal Mystic каждый день.'
  ])('refuses: %s', (body) => {
    expect(disclosureProblem(text(body), NATAL)).not.toBeNull()
    expect(statesConnection(text(body), NATAL)).toBe(false)
  })

  it('says "not connected" for a label that answers "none", also in a text that does not mention the product', () => {
    for (const body of ['Disclosure: none. Natal Mystic is great.', 'Conflict of interest: no.', 'No disclosure needed.', 'Раскрытие информации: нет.']) {
      expect(disclosureProblem(text(body), NATAL), body).toContain('not connected')
    }
  })

  it.each([
    "Disclosure: I'm connected with Natal Mystic.",
    "Disclosure: I'm affiliated with Natal Mystic, so I'm biased.",
    'I have a financial interest in Natal Mystic.',
    "I'm closely affiliated with Natal Mystic.",
    "Disclosure: I'm the developer of Natal Mystic.",
    'Я связан с Natal Mystic: я там работаю.',
    'Я связан с Natal Mystic.'
  ])('still accepts a label with a statement after it: %s', (body) => {
    expect(disclosureProblem(text(body), NATAL)).toBeNull()
  })
})

describe('"I have a stake in it" is a statement; "I have no stake in it" is not', () => {
  it.each([
    'I have no stake in Natal Mystic, just recommending it.',
    'I have no interest in Natal Mystic.',
    'I have zero stake in Natal Mystic.',
    'We have no connection with Natal Mystic.',
    'I have not any stake in Natal Mystic.',
    'I have hardly any stake in Natal Mystic, I just like it.',
    'I have barely any interest in Natal Mystic beyond using it.',
    'We hold no stake in Natal Mystic.',
    'I have little stake in Natal Mystic.',
    'I have nothing to gain, no stake in Natal Mystic.'
  ])('does not take it for a statement of the connection: %s', (body) => {
    expect(statesConnection(text(body), NATAL), body).toBe(false)
    expect(disclosureProblem(text(body), NATAL), body).not.toBeNull()
  })

  it.each([
    'I have a stake in Natal Mystic.',
    'I have a small stake in Natal Mystic.',
    'We hold a financial interest in Natal Mystic.',
    'I have a personal connection with Natal Mystic.',
    'I have a close relationship with Natal Mystic.',
    "I'm the founder of Natal Mystic. I have no interest in astrology fads, only in good charts."
  ])('still takes it for a statement: %s', (body) => {
    expect(disclosureProblem(text(body), NATAL), body).toBeNull()
  })
})

describe('a possessive that is the subject of a clause is not the product', () => {
  it.each(['My app was crashing. Natal Mystic fixed it.', 'Our product had bugs. Natal Mystic found them.', 'My startup uses Natal Mystic for charts.', 'Our company switched to Natal Mystic.'])('refuses: %s', (body) => {
    expect(disclosureProblem(text(body), NATAL)).toContain('does not say that you are connected')
  })

  it.each(['Natal Mystic is my app.', 'My app Natal Mystic is free.', "It's our product, Natal Mystic.", 'Natal Mystic — my startup.'])('still accepts when it says so: %s', (body) => {
    expect(disclosureProblem(text(body), NATAL)).toBeNull()
  })
})

describe('"this app" and "it" are the product only when the text has already named it', () => {
  it.each([
    'I built this app last year. Natal Mystic is great for charts.',
    'I work on it. Natal Mystic is free this week.',
    'I made this app in 2020.\nTry Natal Mystic.',
    'I built this site on Natal Mystic in a weekend.',
    'I made this on Natal Mystic.',
    'I built this app using Natal Mystic.',
    'I built this site with Natal Mystic.',
    'I made this app for Natal Mystic.',
    'I built the site around Natal Mystic.',
    'Я сделал этот сайт на Natal Mystic.'
  ])('refuses: %s', (body) => {
    expect(disclosureProblem(text(body), NATAL)).toContain('does not say that you are connected')
  })

  it.each([
    'Natal Mystic is great for charts. I built this app last year.',
    'Natal Mystic builds a chart from your birth data. It is free for a week. I work on it.',
    'I built this app, Natal Mystic, last year.',
    'Natal Mystic is free. I made it because charts were slow.'
  ])('accepts when it has been named: %s', (body) => {
    expect(disclosureProblem(text(body), NATAL)).toBeNull()
  })

  it('accepts a "this app" that the link names, and one in a text that names the product nowhere', () => {
    expect(disclosureProblem(text('I built this app last year.', { link: 'https://natalmystic.com' }), NATAL)).toBeNull()
    expect(statesConnection(text('I work on it, so take this with a grain of salt.'), NATAL)).toBe(true)
  })
})

describe('a role says nothing about the product when the clause says it is of something else', () => {
  it.each([
    "I'm the owner and I love Natal Mystic.",
    "I'm the founder and CEO of Initech. Try Natal Mystic.",
    "I'm the team lead at an agency and I use Natal Mystic.",
    "I'm the developer and I use Natal Mystic.",
    "I'm the CEO at a bank and Natal Mystic is great.",
    'We are the team at an agency that uses Natal Mystic.'
  ])('refuses: %s', (body) => {
    expect(disclosureProblem(text(body), NATAL)).toContain('does not say that you are connected')
  })

  it.each([
    "Natal Mystic is free this week. I'm the developer.",
    "I'm the developer. Natal Mystic is free this week.",
    "I'm the developer and I'm biased. Natal Mystic is free this week.",
    "I'm one of the makers. Try Natal Mystic.",
    "I'm a solo developer. Try Natal Mystic.",
    'Я разработчик. Natal Mystic бесплатный.'
  ])('accepts a role of nothing else: %s', (body) => {
    expect(disclosureProblem(text(body), NATAL)).toBeNull()
  })
})

describe('the name written so that the plain test misses it', () => {
  it.each([
    'Try **Natal** Mystic today',
    'Try *Natal* *Mystic* today',
    'Try __Natal__ _Mystic_ today',
    'Try ~~Natal~~ `Mystic` today',
    'Try [Natal](https://x.example) Mystic today',
    'Try [Natal Mystic](https://x.example) today',
    'Try <b>Natal</b> Mystic today',
    'Try Natal. Mystic today',
    'Try Natal · Mystic today',
    'Try Natal_Mystic today',
    'Try N\u0430tal Mystic today', // Cyrillic а
    'Try Natal Mystіc today', // Cyrillic і
    'Try \u039Datal Mystic today', // Greek Ν
    'Try Натал Мистик today',
    'Try натал мистик today'
  ])('is still the product, and a problem without a statement: %s', (body) => {
    expect(mentionsProductIn(text(body), NATAL)).toBe(true)
    expect(disclosureProblem(text(body), NATAL)).toContain('does not say that you are connected')
  })

  it('finds a Cyrillic name written in Latin letters', () => {
    const natalnaya = { name: 'Натальная Карта', websiteUrl: null }
    expect(mentionsProductIn(text('Try Natalnaya Karta today'), natalnaya)).toBe(false) // what is not found is said in the report
    expect(mentionsProductIn(text('Try **Натальная** Карта today'), natalnaya)).toBe(true)
  })

  it('finds a name written wholly in look-alike letters of another alphabet, which no mixed word betrays', () => {
    const mapex = { name: 'Mapex', websiteUrl: null }
    expect(mentionsProductIn(text('Try Mapex today'), mapex)).toBe(true)
    expect(mentionsProductIn(text('Try \u041C\u0430\u0440\u0435\u0445 today'), mapex)).toBe(true) // Мареx in Cyrillic letters only
    expect(mentionsProductIn(text('Try \u041C\u0430\u0440\u0435\u0445 today'), NATAL)).toBe(false)
  })

  it('does not take other words for it, and leaves a Russian text alone', () => {
    expect(mentionsProductIn(text('Это натальная карта мира, очень мистическая'), NATAL)).toBe(false)
    expect(mentionsProductIn(text('Натальная карта и мистика'), NATAL)).toBe(false)
    expect(mentionsProductIn(text('Natal charts are mystic, said Natalia'), NATAL)).toBe(false)
    expect(mentionsProductIn(text('Try Natal, Mystic and Tarot apps'), NATAL)).toBe(false)
  })

  it('still reads a statement written with markup, and with a look-alike letter', () => {
    expect(disclosureProblem(text("I'm the **developer** of **Natal** Mystic."), NATAL)).toBeNull()
    expect(disclosureProblem(text('I _built_ [Natal Mystic](https://natalmystic.com).'), NATAL)).toBeNull()
    expect(disclosureProblem(text("I'm the d\u0435veloper of Natal Mystic."), NATAL)).toBeNull() // Cyrillic е
    expect(disclosureProblem(text("I'm not affil\u0456ated with Natal Mystic."), NATAL)).toContain('not connected') // Cyrillic і
  })
})

describe('what somebody else said, and what is wished or imagined, is not the author\'s statement', () => {
  it.each([
    "> I'm the developer of Natal Mystic",
    "> I'm the developer of Natal Mystic\n\nNatal Mystic is great.",
    'Someone said "I built Natal Mystic" and I agree.',
    'He wrote: “I work on Natal Mystic” in the thread. Natal Mystic is great.',
    'The page says «we are the team behind Natal Mystic». Natal Mystic is great.',
    'I wish I had built Natal Mystic.',
    'If I had built Natal Mystic, I would be rich.',
    'I would love to say I built Natal Mystic.',
    'Imagine I built Natal Mystic.',
    "I'd like to say I'm the developer of Natal Mystic, but I'm not."
  ])('refuses: %s', (body) => {
    expect(disclosureProblem(text(body), NATAL)).not.toBeNull()
  })

  it.each([
    'I built Natal Mystic last year. Someone asked me if I wish I had built it sooner.',
    '> Is this your app?\n\nYes, I built Natal Mystic.',
    'He asked "who made this?" and I said: I built Natal Mystic.',
    "I'm the developer of Natal Mystic, if you wondered."
  ])('accepts a statement that has such a thing next to it, not in front of it: %s', (body) => {
    expect(disclosureProblem(text(body), NATAL)).toBeNull()
  })
})

describe('honest disclosures that the review feared would be refused', () => {
  it.each([
    'I built Natal Mystic - a free tool.',
    'I built Natal Mystic - a free tool for charts.',
    'I built Natal Mystic out of frustration.',
    'I built Natal Mystic back in 2020.',
    'I made Natal Mystic free.',
    'I run Natal Mystic.',
    'I own Natal Mystic.',
    'We run Natal Mystic together.',
    'I run Natal Mystic - a free tool.',
    'I run Natal Mystic, a free tool for charts.',
    'I run Natal Mystic and maintain it.',
    'I own Natal Mystic and built it with a friend.',
    'We own Natal Mystic and host it ourselves.',
    "I'm the developer of Natal Mystic | free charts.",
    "I'm the developer of Natal Mystic • free charts.",
    'I built Natal Mystic after being just a user of other tools.',
    "I used to be just a user of charts apps before I became the developer of Natal Mystic.",
    "I'm the developer of Natal Mystic. It isn't an ad.",
    "I'm the developer of Natal Mystic. This is not an ad.",
    "I'm the developer of Natal Mystic. Not affiliated with Reddit.",
    "I didn't want to build another dashboard, so I built Natal Mystic.",
    'I did not want to build another app. Then I built Natal Mystic.',
    'Я создал Natal Mystic. Это не реклама.'
  ])('passes: %s', (body) => {
    expect(disclosureProblem(text(body), NATAL)).toBeNull()
  })

  it.each([
    'I run it every day, Natal Mystic is great.',
    'I run Natal Mystic every day and it is great.',
    'I own a copy of Natal Mystic.',
    'I run Natal Mystic on my laptop.',
    'I run Natal Mystic and love it.',
    'I own Natal Mystic with Docker.',
    'I run Natal Mystic from my laptop.',
    'I run Natal Mystic and recommend it to friends.',
    'We run Natal Mystic and rely on it for our charts.',
    'I run Natal Mystic because it is fast.',
    'I run Natal Mystic so my charts load faster.',
    'I own Natal Mystic since last year and swear by it.',
    'I run Natal Mystic alone from my laptop.',
    'I run Natal Mystic out of habit.',
    'I run Natal Mystic and Docker on a small server.',
    'I run Natal Mystic and Hostinger hosts it for me.',
    "I'm just a user of Natal Mystic and other tools.",
    "I'm just a user of it.",
    "I'm just a user."
  ])('still refuses: %s', (body) => {
    expect(disclosureProblem(text(body), NATAL)).not.toBeNull()
  })

  it('a denial that is about something else does not count against the statement, also when it is lowercase', () => {
    expect(disclosureProblem(text("I'm just a user of other tools too, and I'm the developer of Natal Mystic."), NATAL)).toBeNull()
    expect(disclosureProblem(text("I'm just a user of several apps. I'm the developer of Natal Mystic."), NATAL)).toBeNull()
  })

  it('a denial of advertising alone is still refused, and is said as a denial', () => {
    expect(disclosureProblem(text('This is not an ad.'), NATAL)).toContain('not connected')
    expect(disclosureProblem(text('Honest review of Natal Mystic. It is not an ad.'), NATAL)).toContain('not connected')
  })
})
