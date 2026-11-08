/** URL globs for profiles: `*` matches within a path segment, `**` matches anything, `{id}` captures a segment. */

const SPECIAL = /[.+?^$()|[\]\\]/g

export function globToRegExp(glob: string): RegExp {
  let source = ''
  for (let i = 0; i < glob.length; i += 1) {
    const char = glob[i]
    if (char === '*') {
      if (glob[i + 1] === '*') {
        source += '.*'
        i += 1
      } else source += '[^/?#]*'
    } else if (char === '{') {
      const end = glob.indexOf('}', i)
      const name = end > i ? glob.slice(i + 1, end) : ''
      if (!/^[a-z]+$/i.test(name)) throw new Error(`Bad capture in URL pattern: ${glob}`)
      source += `(?<${name}>[^/?#]+)`
      i = end
    } else source += char.replace(SPECIAL, '\\$&')
  }
  return new RegExp(`^${source}/?$`, 'i')
}

export function matchGlob(glob: string, url: string): Record<string, string> | null {
  const match = globToRegExp(glob).exec(url.replace(/#.*$/, ''))
  return match ? { ...(match.groups ?? {}) } : null
}

export function matchesAnyGlob(globs: string[], url: string): boolean {
  return globs.some((g) => matchGlob(g, url) !== null)
}

/** True when `hostname` is `host` or one of its subdomains. */
export function hostBelongsTo(hostname: string, host: string): boolean {
  const h = hostname.toLowerCase()
  return h === host || h.endsWith(`.${host}`)
}
