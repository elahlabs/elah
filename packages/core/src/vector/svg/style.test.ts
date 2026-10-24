import { describe, it, expect } from 'vitest'
import { parseDeclarations, parseStyleSheet, declaredFor, computeStyle, INITIAL_STYLE } from './style'
import type { SvgNode } from './types'

function node(tag: string, attrs: Record<string, string> = {}): SvgNode {
  return { tag, attrs, children: [] }
}

describe('parseDeclarations', () => {
  it('splits on ; and trims a trailing !important', () => {
    expect(parseDeclarations('fill: red; stroke-width:2 !important;;')).toEqual({
      fill: 'red',
      'stroke-width': '2',
    })
  })

  it('expands a shorthand marker into start/mid/end', () => {
    expect(parseDeclarations('marker: url(#m)')).toEqual({
      'marker-start': 'url(#m)',
      'marker-mid': 'url(#m)',
      'marker-end': 'url(#m)',
    })
  })
})

describe('parseStyleSheet', () => {
  it('keeps class/tag rules in order and skips bad selectors and @-rules', () => {
    const skipped: string[] = []
    const rules = parseStyleSheet(
      '.a{fill:red} rect{stroke:blue} #x{fill:green} .b, g.c{opacity:.5} @media print{.a{fill:black}}',
      (f) => skipped.push(f),
    )
    expect(rules.map((r) => `${r.kind} ${r.name}`)).toEqual(['class a', 'tag rect', 'class b'])
    expect(skipped).toEqual(['css-selector', 'css-selector', 'css-at-rule'])
  })

  it('strips comments before scanning', () => {
    const rules = parseStyleSheet('/* comment { } */ .a { fill: red }', () => {})
    expect(rules).toEqual([{ kind: 'class', name: 'a', decls: { fill: 'red' } }])
  })
})

describe('declaredFor precedence', () => {
  const rules = parseStyleSheet('.a{fill:red}', () => {})

  it('the style attribute wins over everything', () => {
    const n = node('rect', { class: 'a', fill: 'black', style: 'fill:blue' })
    expect(declaredFor(n, rules).fill).toBe('blue')
  })

  it('a class rule wins over a presentation attribute when there is no style attribute', () => {
    const n = node('rect', { class: 'a', fill: 'black' })
    expect(declaredFor(n, rules).fill).toBe('red')
  })

  it('the presentation attribute applies alone, with no class or style', () => {
    const n = node('rect', { fill: 'black' })
    expect(declaredFor(n, rules).fill).toBe('black')
  })
})

describe('computeStyle inheritance', () => {
  it('a child with no fill declared inherits the parent fill', () => {
    const parent = { ...INITIAL_STYLE, fill: '#123456' }
    const style = computeStyle(parent, {})
    expect(style.fill).toBe('#123456')
  })

  it('fill: inherit takes the parent value explicitly', () => {
    const parent = { ...INITIAL_STYLE, fill: '#123456' }
    const style = computeStyle(parent, { fill: 'inherit' })
    expect(style.fill).toBe('#123456')
  })

  it('fill-opacity accepts a percentage', () => {
    const style = computeStyle(INITIAL_STYLE, { 'fill-opacity': '50%' })
    expect(style.fillOpacity).toBe(0.5)
  })

  it('an invalid fill-rule falls back to the parent', () => {
    const parent = { ...INITIAL_STYLE, fillRule: 'evenodd' as const }
    const style = computeStyle(parent, { 'fill-rule': 'bogus' })
    expect(style.fillRule).toBe('evenodd')
  })
})
