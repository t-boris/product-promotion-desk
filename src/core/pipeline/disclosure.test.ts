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
    'Our product does that too.',
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
    'Я пользуюсь Natal Mystic каждый день.'
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
