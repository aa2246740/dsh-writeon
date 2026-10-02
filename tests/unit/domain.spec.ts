import { describe, expect, it } from 'vitest'
import { detectDocLanguage, graphemeLength, isGraphemeBoundary, sentenceRanges, wordRanges, wordUnitRanges, countWords } from '../../src/domain/segment.js'
import { computeStats } from '../../src/domain/stats.js'
import { articleFor, isArticle, matchCase } from '../../src/domain/article.js'
import { textHash, docHash, validateAnchor, validateCuts, type FlatLeaf } from '../../src/domain/anchors.js'
import { deserializeProject, serializeProject, newProject, looksLikeProject } from '../../src/domain/serialize.js'
import { extractJson } from '../../src/domain/contract.js'
import { SCHEMA_VERSION, emptyEntities } from '../../src/domain/entities.js'

describe('segment', () => {
  it('splits CJK runs into per-character word ranges', () => {
    const r = wordRanges('我喜欢写作')
    expect(r).toEqual([
      { from: 0, to: 1 }, { from: 1, to: 2 }, { from: 2, to: 3 }, { from: 3, to: 4 }, { from: 4, to: 5 },
    ])
  })
  it('keeps latin words whole and drops whitespace', () => {
    const r = wordRanges('the quick fox')
    expect(r).toEqual([{ from: 0, to: 3 }, { from: 4, to: 9 }, { from: 10, to: 13 }])
  })
  it('mixed CJK and latin', () => {
    const r = wordRanges('我爱cats')
    expect(r.map(x => x.to - x.from)).toEqual([1, 1, 4])
  })
  it('sentence ranges trim trailing whitespace', () => {
    const r = sentenceRanges('Hello world. Next one!')
    expect(r).toHaveLength(2)
    expect('Hello world. Next one!'.slice(r[0]!.from, r[0]!.to)).toBe('Hello world.')
  })
  it('grapheme boundaries respect combining marks and emoji', () => {
    const s = 'a\u0301b' // a + combining accent = á b
    expect(graphemeLength(s)).toBe(2)
    expect(isGraphemeBoundary(s, 1)).toBe(false) // splits á
    expect(isGraphemeBoundary(s, 2)).toBe(true)
    const emoji = 'a👍🏽b' // 👍🏽 is 4 UTF-16 units
    expect(isGraphemeBoundary(emoji, 2)).toBe(false)
    expect(isGraphemeBoundary(emoji, 4)).toBe(false)
    expect(isGraphemeBoundary(emoji, 5)).toBe(true)
  })
  it('countWords counts CJK per char and latin per word', () => {
    expect(countWords('hello world')).toBe(2)
    expect(countWords('三个字')).toBe(3)
  })
  it('countWords does not count punctuation as words', () => {
    expect(countWords('A cat sits on an owl. The dog runs fast.')).toBe(10)
    expect(countWords('hello, world!')).toBe(2)
  })
  it('countWords counts each CJK char as one word (字数 convention)', () => {
    expect(countWords('我喜欢写作')).toBe(5)
    expect(countWords('I think 写作很酷')).toBe(6) // 2 latin words + 4 CJK chars
  })
  it('wordUnitRanges keeps ICU CJK words whole for variant snapping', () => {
    const r = wordUnitRanges('我喜欢写作')
    expect(r).toContainEqual({ from: 3, to: 5 }) // '写作' one unit, not two chars
    const m = wordUnitRanges('I think 写作很酷')
    expect(m.map(x => 'I think 写作很酷'.slice(x.from, x.to))).toEqual(['I', 'think', '写作', '很酷'])
  })
  it('sentenceRanges splits CJK sentence terminators 。！？', () => {
    const r = sentenceRanges('今天下雨了。我明天去公园！你好吗？')
    expect(r.map(x => '今天下雨了。我明天去公园！你好吗？'.slice(x.from, x.to))).toEqual(['今天下雨了。', '我明天去公园！', '你好吗？'])
  })
  it('detectDocLanguage picks dominant script', () => {
    expect(detectDocLanguage('今天下雨了，明天去公园。')).toBe('zh')
    expect(detectDocLanguage('A cat sits on an owl.')).toBe('en')
    expect(detectDocLanguage('mainly English with 少量中文')).toBe('en')
  })
  it('computeStats blends latin wpm and CJK cpm for minutes', () => {
    const zh = computeStats([{ text: '我喜欢写作这个插件' }])
    expect(zh.words).toBe(9)
    const en = computeStats([{ text: 'hello world ' .repeat(100).trim() }])
    expect(en.minutes).toBe(1) // 200 words / 220 wpm
  })
})

describe('articleFor (a/an)', () => {
  it('known exception words', () => {
    expect(articleFor('hour')).toBe('an')
    expect(articleFor('honest')).toBe('an')
    expect(articleFor('university')).toBe('a')
    expect(articleFor('user')).toBe('a')
    expect(articleFor('one')).toBe('a')
    expect(articleFor('European')).toBe('a')
  })
  it('everyday dictionary words', () => {
    expect(articleFor('cat')).toBe('a')
    expect(articleFor('apple')).toBe('an')
    expect(articleFor('owl')).toBe('an')
    expect(articleFor('idea')).toBe('an')
  })  
  it('letter-read acronyms from the dictionary; unresolvable all-caps → unknown', () => {
    expect(articleFor('FBI')).toBe('an')
    expect(articleFor('LED')).toBe('an')
    expect(articleFor('SQL')).toBe('an')
    expect(articleFor('NASA')).toBeNull() // word-acronym — pronunciation not letter-by-letter
    expect(articleFor('XYZW')).toBeNull() // unknown acronym → conservative
  })
  it('single letters by letter name', () => {
    expect(articleFor('F')).toBe('an')
    expect(articleFor('S')).toBe('an')
    expect(articleFor('B')).toBe('a')
    expect(articleFor('U')).toBe('a')
  })
  it('consonant-letter onset is a safe a, even unlisted', () => {
    expect(articleFor('bird')).toBe('a')
    expect(articleFor('xzyq')).toBe('a') // consonant onset (/z/ or /ks/)
  })
  it('conservative null on empty/unknown vowel onset', () => {
    expect(articleFor('')).toBeNull()
    expect(articleFor('ezzplo')).toBeNull() // vowel-onset made-up word: pronunciation unknown
  })
  it('matchCase preserves casing', () => {
    expect(matchCase('a', 'an')).toBe('an')
    expect(matchCase('A', 'an')).toBe('An')
    expect(matchCase('an', 'a')).toBe('a')
  })
  it('isArticle', () => {
    expect(isArticle('a')).toBe(true)
    expect(isArticle('An')).toBe(true)
    expect(isArticle('the')).toBe(false)
  })
})

describe('anchors', () => {
  const leaf: FlatLeaf = { leafId: 'b0', textStart: 1, text: 'hello world' }
  it('valid anchor returns leaf', () => {
    const r = validateAnchor([leaf], { leafId: 'b0', from: 0, to: 5, quote: 'hello' })
    expect(r).toEqual({ leaf })
  })
  it('unknown leaf rejected', () => {
    const r = validateAnchor([leaf], { leafId: 'b9', from: 0, to: 1, quote: 'x' })
    expect(r).toMatchObject({ error: { kind: 'unknown-leaf' } })
  })
  it('range out of bounds rejected', () => {
    const r = validateAnchor([leaf], { leafId: 'b0', from: 0, to: 99, quote: 'x' })
    expect(r).toMatchObject({ error: { kind: 'range-out-of-bounds' } })
  })
  it('quote mismatch rejected', () => {
    const r = validateAnchor([leaf], { leafId: 'b0', from: 0, to: 5, quote: 'HELLO' })
    expect(r).toMatchObject({ error: { kind: 'quote-mismatch' } })
  })
  it('grapheme-splitting range rejected', () => {
    const l: FlatLeaf = { leafId: 'e', textStart: 0, text: 'a\u0301b' }
    const r = validateAnchor([l], { leafId: 'e', from: 0, to: 1, quote: 'a' })
    expect(r).toMatchObject({ error: { kind: 'grapheme-boundary' } })
  })
  it('validateCuts rejects overlaps in one leaf', () => {
    const cuts = [
      { anchor: { leafId: 'b0', from: 0, to: 5, quote: 'hello' } },
      { anchor: { leafId: 'b0', from: 4, to: 7, quote: 'o w' } },
    ]
    const r = validateCuts([leaf], cuts)
    expect(r).toMatchObject({ ok: false, error: { kind: 'range-out-of-bounds' }, index: 1 })
  })
  it('validateCuts accepts disjoint cuts', () => {
    const cuts = [
      { anchor: { leafId: 'b0', from: 0, to: 5, quote: 'hello' } },
      { anchor: { leafId: 'b0', from: 6, to: 11, quote: 'world' } },
    ]
    expect(validateCuts([leaf], cuts)).toEqual({ ok: true })
  })
  it('hash is stable and order-sensitive', () => {
    const a = docHash([leaf])
    expect(docHash([{ ...leaf }])).toBe(a)
    expect(docHash([leaf, { leafId: 'b1', textStart: 20, text: 'x' }])).not.toBe(a)
    expect(textHash('')).toBeTruthy()
  })
})

describe('serialize', () => {
  const project = { ...newProject('p1', { type: 'doc', content: [{ type: 'paragraph' }] }), entities: emptyEntities() }
  it('round-trips a project', () => {
    const text = serializeProject(project)
    const r = deserializeProject(text, 'x')
    expect('project' in r && r.project.id).toBe('p1')
  })
  it('rejects non-JSON', () => {
    expect(deserializeProject('nope{', 'x')).toMatchObject({ error: { kind: 'not-json' } })
  })
  it('rejects non-project JSON', () => {
    expect(deserializeProject('{"foo":1}', 'x')).toMatchObject({ error: { kind: 'not-project' } })
  })
  it('rejects newer schema', () => {
    const text = JSON.stringify({ ...project, schemaVersion: SCHEMA_VERSION + 1 })
    expect(deserializeProject(text, 'x')).toMatchObject({ error: { kind: 'newer-schema' } })
  })
  it('looksLikeProject requires entity tables', () => {
    expect(looksLikeProject(null)).toBe(false)
    expect(looksLikeProject({ schemaVersion: 1, id: 'x', doc: {}, entities: {}, meta: {} })).toBe(false)
    expect(looksLikeProject({ schemaVersion: 1, id: 'x', doc: {}, entities: emptyEntities(), meta: {} })).toBe(true)
  })
})

describe('extractJson', () => {
  it('prefers last json fence', () => {
    const raw = 'blabla\n```json\n{"a":1}\n```\nthen\n```json\n{"b":2}\n```\ntail'
    expect(extractJson(raw)).toEqual({ b: 2 })
  })
  it('falls back to outermost balanced braces', () => {
    expect(extractJson('prefix {"x":{"y":1}} suffix')).toEqual({ x: { y: 1 } })
  })
  it('returns undefined for garbage', () => {
    expect(extractJson('no json here')).toBeUndefined()
    expect(extractJson('{"unclosed": ')).toBeUndefined()
  })
})
