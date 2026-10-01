/**
 * Prompt builders. The model contract is embedded in every prompt: echo the
 * requestId/baseRevision/baseHash verbatim and answer with one ```json block.
 */

const CONTRACT_NOTE = `You are a writing assistant embedded in an editor. Answer with exactly one \`\`\`json fenced block and nothing outside it.
The JSON object MUST include the fields "requestId", "baseRevision", "baseHash" copied verbatim from the request below.
Anchors refer to text leaves: "leafId" (given per leaf), "from"/"to" are UTF-16 character offsets inside that leaf's text (start inclusive, end exclusive), and "quote" MUST equal the exact text at those offsets.
Never invent offsets that split a character or emoji. Never rewrite text you were not asked to rewrite.`

export interface LeafPayload { leafId: string; text: string }

function leafSection(leaves: LeafPayload[]): string {
  return leaves.map(l => `[leaf ${l.leafId}]\n${l.text}`).join('\n\n')
}

export function alternativesPrompt(args: {
  requestId: string
  baseRevision: number
  baseHash: string
  scope: 'word' | 'sentence' | 'paragraph'
  target: string
  context: string
  count: number
}): string {
  const scopeLabel = args.scope === 'word' ? 'word or short phrase' : args.scope
  return `${CONTRACT_NOTE}

Task: propose ${args.count} alternative phrasings for the TARGET ${scopeLabel} below. Keep the author's meaning and register; similar length is fine but a tighter option is welcome. Do not number or annotate the options inside "text"; put any brief note in "reason". The alternatives must differ from each other and from the target.

TARGET:
${args.target}

SURROUNDING CONTEXT (for tone only; never change it):
${args.context}

Respond with JSON: {"kind":"alternatives","requestId":"${args.requestId}","baseRevision":${args.baseRevision},"baseHash":"${args.baseHash}","items":[{"text":"...","reason":"..."}]}`
}

export type LabGoal =
  | 'fix-punctuation'
  | 'weakest-sentences'
  | 'long-sentences'
  | 'convoluted-sentences'
  | 'tone-misfit'
  | 'hedges-filler'

const GOAL_INSTRUCTIONS: Record<LabGoal, string> = {
  'fix-punctuation': 'Find and fix objective errors: punctuation misuse, typos, and clear grammar errors. For each issue give an anchor over the smallest range containing the error, plus "after" with the corrected text (a minimal replacement for that range only).',
  'weakest-sentences': 'Identify the weakest sentences — vague, flat, or off-tone — that most hurt the piece. Anchor the whole sentence (excluding surrounding whitespace). Mark them only; do not rewrite.',
  'long-sentences': 'Identify sentences that are too long for this piece (readability problem). Anchor each whole sentence excluding surrounding whitespace. Mark only; do not rewrite.',
  'convoluted-sentences': 'Identify convoluted, tangled, or hard-to-parse sentences. Anchor each whole sentence excluding surrounding whitespace. Mark only; do not rewrite.',
  'tone-misfit': 'Identify words or phrases whose tone clashes with the piece (too formal, too casual, off-voice). Anchor just the misfit word or phrase. Mark only; do not rewrite.',
  'hedges-filler': 'Identify hedges, filler, and throat-clearing that can be cut or tightened (e.g. "I think", "just", "kind of", empty openers). Anchor just the offending span. Mark only; do not rewrite.',
}

export function labPrompt(args: {
  requestId: string
  baseRevision: number
  baseHash: string
  goal: LabGoal
  fix: boolean
  leaves: LeafPayload[]
  language: string
}): string {
  const kind = args.fix ? 'fix' : 'diagnose'
  const extra = args.fix
    ? ' Include "after" — the minimal replacement text for each anchored range.'
    : ' Do not include replacement text; mark only.'
  return `${CONTRACT_NOTE}

Task: ${GOAL_INSTRUCTIONS[args.goal]}${extra}
Write "category" as "${args.goal}" for every proposal. If nothing qualifies, return an empty "proposals" array — do not invent issues.
Language of the text: ${args.language}.

TEXT (leaf by leaf):
${leafSection(args.leaves)}

Respond with JSON: {"kind":"${kind}","requestId":"${args.requestId}","baseRevision":${args.baseRevision},"baseHash":"${args.baseHash}","proposals":[{"leafId":"...","from":0,"to":0,"quote":"...","category":"${args.goal}","reason":"..."${args.fix ? ',"after":"..."' : ''}}]}`
}

export function trimPrompt(args: {
  requestId: string
  baseRevision: number
  baseHash: string
  level: number
  targetWords: number
  currentWords: number
  leaves: LeafPayload[]
  language: string
}): string {
  return `${CONTRACT_NOTE}

Task: choose delete-only cuts that reduce this text by about ${args.level}% (from ${args.currentWords} to ~${args.targetWords} words).
Rules: cuts may only DELETE ranges — never rewrite or add. Every cut is an anchor over exactly the characters to remove. If a cut needs adjacent spaces or punctuation removed to stay clean, include those characters in the same or an additional cut — whitespace/punctuation cleanup is itself an explicit cut. Keep the author's voice, cadence, and the strongest specifics; cut redundancy, filler, and weak modifiers first. Cuts must not overlap. Respect sentence and paragraph structure; never leave a broken fragment.
Language of the text: ${args.language}.

TEXT (leaf by leaf):
${leafSection(args.leaves)}

Respond with JSON: {"kind":"trim","requestId":"${args.requestId}","baseRevision":${args.baseRevision},"baseHash":"${args.baseHash}","level":${args.level},"cuts":[{"leafId":"...","from":0,"to":0,"quote":"...","reason":"..."}]}`
}
