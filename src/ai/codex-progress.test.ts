// What the progress panel shows of the transcript `codex exec` prints to stderr: the words a person means to read, never a piece of the answer's JSON.

import { describe, expect, it } from 'vitest'
import { codexProgress } from './codex'

/** The lines the panel would show for a transcript, one line of stderr at a time. */
function shown(transcript: string): string[] {
  const out: string[] = []
  const sink = codexProgress((line) => out.push(line))
  for (const line of transcript.split('\n')) sink(line)
  return out
}

const BANNER = 'OpenAI Codex v0.170\n--------\nworkdir: /tmp/x\nmodel: gpt-5.5\n--------\nuser\nThe whole prompt, which must never reach the screen.\nSecond line of the prompt.\n'

describe('codexProgress: the transcript of a run', () => {
  it('shows what Codex says, the commands and tools it runs and the searches it makes, and nothing of the banner, the prompt or the token count', () => {
    const out = shown(`${BANNER}thinking\n**Planning the search**\nmcp: ppd starting\nweb search: \nweb search: swiss ephemeris history\ncodex\nI found two sources.\nexec\nbash -lc 'ls' in /tmp/x\ntokens used\n1,234\nthe last line\n`)
    expect(out).toEqual(['**Planning the search**', 'mcp: ppd starting', 'web search: swiss ephemeris history', 'I found two sources.', 'exec', "bash -lc 'ls' in /tmp/x"])
  })

  it('leaves out the whole answer when it is pretty-printed JSON over many lines (the fragments the owner saw: braces, "title", "url", a flag)', () => {
    const out = shown(`${BANNER}codex\nI will write the post now.\ncodex\n{\n  "text": "A post about charts.",\n  "sources": [\n    {\n      "title": "Swiss Ephemeris",\n      "url": "https://www.astro.com/swisseph/"\n    },\n    {\n      "title": "Other",\n      "url": "https://example.org/"\n    }\n  ],\n  "statesProductFacts": false\n}\ntokens used\n99\n`)
    expect(out).toEqual(['I will write the post now.'])
  })

  it('keeps what Codex says before the JSON in the same message, and drops everything after it up to the next section', () => {
    const out = shown(`${BANNER}codex\nHere is the result:\n{\n  "text": "x",\n  "a": [1, 2],\n  "b": false\n}\nexec\nsed -n 1,5p notes.txt\ncodex\nDone.\n`)
    expect(out).toEqual(['Here is the result:', 'exec', 'sed -n 1,5p notes.txt', 'Done.'])
  })

  it('leaves out an answer inside a code fence, with the fences', () => {
    const out = shown(`${BANNER}codex\nThe answer:\n\`\`\`json\n{\n  "text": "x"\n}\n\`\`\`\n`)
    expect(out).toEqual(['The answer:'])
  })

  it('leaves out what a tool returns as JSON, and shows the line that says the tool was called', () => {
    const out = shown(`${BANNER}mcp ppd.browser_open("https://example.org") success in 120ms:\n{\n  "ok": true,\n  "title": "Example"\n}\ncodex\nThe page is open.\n`)
    expect(out).toEqual(['mcp ppd.browser_open("https://example.org") success in 120ms:', 'The page is open.'])
  })

  it('leaves out an answer written on one line, and an answer that is a list', () => {
    expect(shown(`${BANNER}codex\n{"text":"x","sources":[],"statesProductFacts":false}\ntokens used\n1\n`)).toEqual([])
    expect(shown(`${BANNER}codex\n[\n  "one",\n  "two"\n]\n`)).toEqual([])
  })

  it('shows lines that only look like data when they are words: a sentence that starts with a quote or a number is not an opening', () => {
    const out = shown(`${BANNER}codex\n"Houses" is the word the post uses.\n3 sources found.\n`)
    expect(out).toEqual(['"Houses" is the word the post uses.', '3 sources found.'])
  })

  it('cuts a very long line, and ignores blank lines', () => {
    const out = shown(`${BANNER}codex\n\n${'a'.repeat(500)}\n\n`)
    expect(out).toHaveLength(1)
    expect(out[0]).toHaveLength(200)
  })

  it('shows nothing from a run that never printed its prompt (a banner only), and does not fail on it', () => {
    expect(shown('OpenAI Codex v0.170\n--------\nworkdir: /tmp/x\n')).toEqual([])
  })
})
