// An own update (DEC-033) may state what the owner's note says and nothing else. The model is told so and must say so itself
// (`addsFactsBeyondNote`); this is the part a rule can check, so it does not rest on the model's word: no number in the post that the
// note does not contain. (Addresses are checked by the safety check with the note's own addresses as the only ones allowed; any other
// fact is for the owner to catch while reading, as the post is only a draft.)

const NUMBER = /\d[\d.,]*/g

/** A number as it is compared: no trailing punctuation, one decimal mark. */
const normalized = (value: string): string => value.replace(/[.,]+$/, '').replace(',', '.')

/** The numbers (amounts, counts, versions, years) of a text. */
export function numbersOf(text: string): Set<string> {
  const numbers = new Set<string>()
  for (const match of text.matchAll(NUMBER)) numbers.add(normalized(match[0]))
  return numbers
}

/** The numbers of the post that the note does not contain, in the order they appear. */
export function numbersNotInNote(post: string, note: string): string[] {
  const known = numbersOf(note)
  const missing: string[] = []
  for (const match of post.matchAll(NUMBER)) {
    const number = normalized(match[0])
    if (!known.has(number) && !missing.includes(number)) missing.push(number)
  }
  return missing
}
