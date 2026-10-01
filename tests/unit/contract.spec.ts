import { describe, expect, it } from 'vitest'
import { validateAlternatives, validateDiagnose, validateTrim } from '../../src/domain/contract-validate.js'
import type { FlatLeaf } from '../../src/domain/anchors.js'

const leaves: FlatLeaf[] = [
  { leafId: 'b1', textStart: 1, text: 'I really think this is very good.' },
]

const base = { requestId: 'r1', baseRevision: 3, baseHash: 'abc' }

describe('validateAlternatives', () => {
  it('accepts echoed base fields and dedupes', () => {
    const r = validateAlternatives({
      kind: 'alternatives', requestId: 'r1', baseRevision: 3, baseHash: 'abc',
      items: [{ text: 'one' }, { text: 'one' }, { text: 'two' }],
    }, base)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.response.items).toHaveLength(2)
  })
  it('rejects wrong requestId (stale/dup response)', () => {
    const r = validateAlternatives({ kind: 'alternatives', requestId: 'other', baseRevision: 3, baseHash: 'abc', items: [{ text: 'x' }] }, base)
    expect(r.ok).toBe(false)
  })
  it('rejects wrong baseHash (edited doc)', () => {
    const r = validateAlternatives({ kind: 'alternatives', requestId: 'r1', baseRevision: 3, baseHash: 'zzz', items: [{ text: 'x' }] }, base)
    expect(r.ok).toBe(false)
  })
  it('rejects empty/blank items', () => {
    const r = validateAlternatives({ kind: 'alternatives', requestId: 'r1', baseRevision: 3, baseHash: 'abc', items: [{ text: '  ' }] }, base)
    expect(r.ok).toBe(false)
  })
})

describe('validateDiagnose', () => {
  const mk = (p: unknown, kind: 'diagnose' | 'fix' = 'diagnose') => ({
    kind, requestId: 'r1', baseRevision: 3, baseHash: 'abc', proposals: [p],
  })
  it('accepts a valid mark-only proposal', () => {
    const r = validateDiagnose(mk({ leafId: 'b1', from: 2, to: 8, quote: 'really', category: 'hedges-filler', reason: 'hedge' }), base, leaves, 'diagnose')
    expect(r.ok).toBe(true)
  })
  it('rejects a wrong quote', () => {
    const r = validateDiagnose(mk({ leafId: 'b1', from: 2, to: 8, quote: 'realxx', category: 'x' }), base, leaves, 'diagnose')
    expect(r.ok).toBe(false)
  })
  it('rejects unknown leaf', () => {
    const r = validateDiagnose(mk({ leafId: 'zz', from: 0, to: 1, quote: 'x', category: 'x' }), base, leaves, 'diagnose')
    expect(r.ok).toBe(false)
  })
  it('fix requires after text', () => {
    const r = validateDiagnose(mk({ leafId: 'b1', from: 2, to: 8, quote: 'really', category: 'x' }, 'fix'), base, leaves, 'fix')
    expect(r.ok).toBe(false)
    const ok = validateDiagnose(mk({ leafId: 'b1', from: 2, to: 8, quote: 'really', category: 'x', after: '' }, 'fix'), base, leaves, 'fix')
    expect(ok.ok).toBe(true)
  })
  it('accepts zero proposals (model found nothing)', () => {
    const r = validateDiagnose({ kind: 'diagnose', ...base, proposals: [] }, base, leaves, 'diagnose')
    expect(r.ok).toBe(true)
  })
  it('repairs an anchor when the quote is unique but offsets are wrong', () => {
    // model said [0,4) for 'very' — wrong offsets, but 'very' occurs once
    const r = validateDiagnose(mk({ leafId: 'b1', from: 0, to: 4, quote: 'very', category: 'hedges-filler' }), base, leaves, 'diagnose')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.response.proposals[0]?.from).toBe(23)
      expect(r.response.proposals[0]?.to).toBe(27)
    }
  })
  it('still rejects an ambiguous quote the repairer cannot place', () => {
    // 'is' appears twice ("this is") — no unique landing spot
    const r = validateDiagnose(mk({ leafId: 'b1', from: 0, to: 2, quote: 'is', category: 'x' }), base, leaves, 'diagnose')
    expect(r.ok).toBe(false)
  })
})

describe('validateTrim', () => {
  it('accepts cuts at the matching level', () => {
    const r = validateTrim({
      kind: 'trim', ...base, level: 30,
      cuts: [{ leafId: 'b1', from: 2, to: 8, quote: 'really' }],
    }, { ...base, level: 30 }, leaves)
    expect(r.ok).toBe(true)
  })
  it('rejects wrong level echo', () => {
    const r = validateTrim({ kind: 'trim', ...base, level: 10, cuts: [] }, { ...base, level: 30 }, leaves)
    expect(r.ok).toBe(false)
  })
  it('rejects overlapping cuts', () => {
    const r = validateTrim({
      kind: 'trim', ...base, level: 30,
      cuts: [
        { leafId: 'b1', from: 2, to: 8, quote: 'really' },
        { leafId: 'b1', from: 5, to: 12, quote: 'ly thin' },
      ],
    }, { ...base, level: 30 }, leaves)
    expect(r.ok).toBe(false)
  })
})
