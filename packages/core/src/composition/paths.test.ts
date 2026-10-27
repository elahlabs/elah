import { describe, it, expect } from 'vitest'
import { getAtPath, interpolateTemplate, parseClipPath, parseFieldPath, setAtPath } from './paths'

describe('parseFieldPath', () => {
  it.each([
    ['text', ['content']],
    ['content', ['content']],
    ['src', ['src']],
    ['fontId', ['fontId']],
    ['transform.x', ['transform', 'x']],
    ['keyframes.opacity[0].value', ['keyframes', 'channels', 'opacity', 'keys', 0, 'value']],
    ['keyframes.fx.ab12cd34.radius[2].value', ['keyframes', 'channels', 'fx.ab12cd34.radius', 'keys', 2, 'value']],
    ['effects[0].params.radius', ['effects', 0, 'params', 'radius']],
    ['words[3].text', ['words', 3, 'text']],
  ])('%s -> %j', (input, expected) => {
    expect(parseFieldPath(input)).toEqual(expected)
  })

  it.each([
    [''],
    ['a..b'],
    ['transform.'],
    ['.x'],
    ['__proto__'],
    ['transform.__proto__'],
    ['constructor'],
    ['startFrame'],
    ['id'],
    ['compound.project'],
    ['a[x]'],
    ['a[-1]'],
    ['1abc'],
    ['a.b.c.d.e.f.g.h.i'],
  ])('%s -> null', (input) => {
    expect(parseFieldPath(input)).toBeNull()
  })
})

describe('parseClipPath', () => {
  it.each([
    ['a', ['a']],
    ['a/b', ['a', 'b']],
  ])('%s -> %j', (input, expected) => {
    expect(parseClipPath(input)).toEqual(expected)
  })

  it.each([
    [''],
    ['a//b'],
    ['/a'],
    ['a/'],
    ['a/b/c/d/e/f'],
  ])('%s -> null', (input) => {
    expect(parseClipPath(input)).toBeNull()
  })
})

describe('setAtPath', () => {
  const fresh = () => ({ content: 'a', transform: { x: 0.5 }, effects: [{ params: { r: 1 } }] })

  it('depth 1: sets a field, then reports unchanged on a repeat', () => {
    const target = fresh()
    expect(setAtPath(target, ['content'], 'b')).toBe('ok')
    expect(target.content).toBe('b')
    expect(setAtPath(target, ['content'], 'b')).toBe('unchanged')
  })

  it('depth 1: may create a new top-level field', () => {
    const target = fresh() as Record<string, unknown>
    expect(setAtPath(target, ['fontId'], 'inter')).toBe('ok')
    expect(target.fontId).toBe('inter')
  })

  it('sets a nested existing field', () => {
    const target = fresh()
    expect(setAtPath(target, ['transform', 'x'], 0.2)).toBe('ok')
    expect(target.transform.x).toBe(0.2)
  })

  it('refuses a missing container and leaves the object unchanged', () => {
    const target = fresh()
    const original = fresh()
    expect(setAtPath(target, ['crop', 'x'], 0.1)).toBe('missing-target')
    expect(target).toEqual(original)
  })

  it('sets an existing array element field', () => {
    const target = fresh()
    expect(setAtPath(target, ['effects', 0, 'params', 'r'], 3)).toBe('ok')
    expect(target.effects[0]!.params.r).toBe(3)
  })

  it('refuses an out-of-bounds array index', () => {
    const target = fresh()
    const original = fresh()
    expect(setAtPath(target, ['effects', 1, 'params', 'r'], 3)).toBe('missing-target')
    expect(target).toEqual(original)
  })

  it('refuses a path into a container that does not exist at all', () => {
    const target = fresh()
    const original = fresh()
    expect(setAtPath(target, ['keyframes', 'channels', 'opacity', 'keys', 0, 'value'], 1)).toBe('missing-target')
    expect(target).toEqual(original)
  })

  it('refuses an out-of-bounds index when the FINAL segment is the array index', () => {
    // Distinct from the intermediate-segment case above: here the array is
    // the last container, so nothing downstream can catch a missing bounds
    // check by falling through a later "is this an object" test.
    const target = fresh()
    const original = fresh()
    expect(setAtPath(target, ['effects', 5], { params: { r: 0 } })).toBe('missing-target')
    expect(target).toEqual(original)
  })

  it('does not confuse an out-of-bounds final index with an unchanged undefined value', () => {
    // If the bounds check were missing, writing `undefined` past the end of
    // the array would read back `undefined === undefined` and report
    // 'unchanged' instead of 'missing-target'.
    const target = fresh()
    expect(setAtPath(target, ['effects', 5], undefined)).toBe('missing-target')
  })
})

describe('getAtPath', () => {
  const target = { content: 'a', transform: { x: 0.5 }, effects: [{ params: { r: 1 } }] }

  it('reads an existing nested value', () => {
    expect(getAtPath(target, ['transform', 'x'])).toBe(0.5)
  })

  it('returns undefined for a missing container', () => {
    expect(getAtPath(target, ['crop', 'x'])).toBeUndefined()
  })
})

describe('interpolateTemplate', () => {
  it.each([
    ['Hello {name}!', { name: 'Ann' }, 'Hello Ann!'],
    ['{a}{b}', { a: 1, b: true }, '1true'],
    ['{missing} {name}', { name: 'Ann' }, '{missing} Ann'],
    ['{{name}}', { name: 'Ann' }, '{Ann}'],
    ['{ name }', { name: 'Ann' }, '{ name }'],
  ])('%s -> %s', (template, values, expected) => {
    expect(interpolateTemplate(template, values)).toBe(expected)
  })
})
