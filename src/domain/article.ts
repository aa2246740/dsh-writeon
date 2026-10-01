/**
 * a/an article linking. Spec rule: when the next word after an article is
 * replaced, adjust a↔an in the same transaction — but only when pronunciation
 * is predictable. Unknown words keep the article untouched (conservative), so
 * we never guess from a bare vowel letter.
 */

// everyday vowel-initial words (predictable pronunciation)
const AN_WORDS_EXTRA = [
  'actor', 'apple', 'artist', 'echo', 'eclipse', 'egg', 'emoji', 'ending', 'epic', 'era', 'error', 'essay', 'idea',
  'item', 'owl', 'umbrella', 'urge', 'urn', 'utterance',
]

const AN_WORDS = new Set([
  'honest', 'honestly', 'honesty', 'honor', 'honour', 'honorable', 'honourable', 'hour', 'hourly', 'heir', 'heirloom',
  'herb', // US pronunciation
  'fbi', 'fda', 'fcc', 'led', 'html', 'llc', 'lp', 'mp3', 'mri', 'nba', 'nfl', 'nhs', 'sms', 'ssd', 'sql', 'suv', 'tnt', 'usb', 'xml', 'xray', 'x-ray', 'xmas',
  ...AN_WORDS_EXTRA,
])

const A_WORDS = new Set([
  // "an" exceptions that take "a"
  'unicorn', 'unicycle', 'uniform', 'unify', 'unified', 'union', 'unique', 'uniquely', 'unison', 'unit', 'united', 'unity',
  'universal', 'universe', 'university', 'use', 'used', 'useful', 'useless', 'user', 'usual', 'usually', 'utility', 'utilize',
  'european', 'euro', 'eucalyptus', 'euphemism', 'euphoria', 'eulogy',
  'one', 'once', 'one-time', 'ouija',
  'ufo', 'usb-drive', 'u-turn', 'ukulele', 'uranium', 'urinal', 'urologist', 'us', 'usa', 'utc', 'uv', 'ux',
  // everyday consonant-initial words (predictable pronunciation)
  'answer', 'book', 'cat', 'chapter', 'city', 'country', 'day', 'dog', 'draft', 'dream', 'earth', 'globe',
  'heart', 'home', 'life', 'light', 'line', 'love', 'man', 'moment', 'name', 'night', 'novel', 'page', 'paragraph',
  'person', 'place', 'poem', 'problem', 'question', 'scene', 'sentence', 'song', 'story', 'thing', 'time', 'title',
  'tree', 'truth', 'version', 'voice', 'way', 'woman', 'word', 'work', 'world', 'year',
])

/** Articles recognized for linking; case preserved separately. */
const ARTICLE = /^(a|an)$/i

export function isArticle(text: string): boolean {
  return ARTICLE.test(text)
}

/**
 * Decide the article for `nextWord`, or null when pronunciation is unknown —
 * callers must then leave the existing article unchanged.
 */
export function articleFor(nextWord: string): 'a' | 'an' | null {
  const w = nextWord.trim().toLowerCase().replace(/^[^a-z]+/, '')
  if (w === '') return null
  if (AN_WORDS.has(w)) return 'an'
  if (A_WORDS.has(w)) return 'a'
  // Acronyms spelled letter-by-letter are in AN_WORDS (fbi, sql…); a bare
  // all-caps token we cannot resolve is "pronunciation unknown" → the caller
  // keeps the author's article and may hint for a manual lock (spec D).
  if (/^[A-Z]{2,}$/.test(nextWord.trim())) return null
  // Single letters read as their letter name.
  if (/^[a-zA-Z]$/.test(w)) return 'aefhilmnorsx'.includes(w) ? 'an' : 'a'
  // Consonant-letter onset is a safe "a": English has no common word whose
  // consonant-initial letter opens with a vowel sound (silent-h nouns live in
  // AN_WORDS above; letter-name words like "x-ray" are handled as acronyms).
  if (/^[b-df-hj-np-tv-z]/.test(w)) return 'a'
  // Vowel-letter onset but unlisted — genuinely unknowable → unknown.
  return null
}

/** Re-apply the case style of `prev` ("A"/"An" capitalized) onto `next`. */
export function matchCase(prev: string, next: 'a' | 'an'): string {
  return /^[A-Z]/.test(prev) ? next[0].toUpperCase() + next.slice(1) : next
}
