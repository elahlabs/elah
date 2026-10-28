import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { filterResults, looksLikeMp3, mergeCredits, parseArgs, rank, slugify, uniqueSlug } from './sfx-search.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const fixture = JSON.parse(readFileSync(join(here, 'fixtures', 'openverse-audio.json'), 'utf8'))

test('filterResults keeps only CC0 https mp3 results within the duration', () => {
  assert.deepEqual(filterResults(fixture.results, 3).map((r) => r.id), ['b2', 'c3', 'g7'])
  assert.deepEqual(filterResults(fixture.results, 15).map((r) => r.id), ['a1', 'b2', 'c3', 'g7'])
  assert.deepEqual(filterResults(undefined), [])
})

test('rank prefers 0.3 to 1.5 s, then the closest to it, then API order', () => {
  // c3 (0.7 s) is inside the range; g7 (0.12 s) is 0.18 s below it; b2 (2.4 s) is 0.9 s above it.
  assert.deepEqual(rank(filterResults(fixture.results, 3)).map((r) => r.id), ['c3', 'g7', 'b2'])
})

test('slugify and uniqueSlug', () => {
  assert.equal(slugify('Camera Shutter!.wav'), 'camera-shutter')
  assert.equal(slugify('  Ünïcode -- click  '), 'unicode-click')
  assert.equal(slugify('///'), 'sound')
  assert.ok(slugify('x'.repeat(100)).length <= 40)
  assert.equal(uniqueSlug('click', new Set()), 'click')
  assert.equal(uniqueSlug('click', new Set(['click', 'click-2'])), 'click-3')
})

test('mergeCredits appends and replaces by file', () => {
  const a = { file: 'a.mp3', sha256: '1' }
  const b = { file: 'b.mp3', sha256: '2' }
  assert.deepEqual(mergeCredits(undefined, a), { sounds: [a] })
  assert.deepEqual(mergeCredits({ sounds: [a] }, b), { sounds: [a, b] })
  assert.deepEqual(mergeCredits({ sounds: [a, b] }, { file: 'a.mp3', sha256: '3' }), { sounds: [b, { file: 'a.mp3', sha256: '3' }] })
})

test('looksLikeMp3 accepts ID3 and frame sync only', () => {
  assert.ok(looksLikeMp3(Buffer.from('ID3\u0004\u0000', 'latin1')))
  assert.ok(looksLikeMp3(Buffer.from([0xff, 0xfb, 0x90])))
  assert.ok(!looksLikeMp3(Buffer.from('RIFF....WAVE')))
  assert.ok(!looksLikeMp3(Buffer.alloc(0)))
})

test('parseArgs', () => {
  assert.equal(parseArgs(['camera', 'shutter', '--out', 'w']).args.query, 'camera shutter')
  assert.equal(parseArgs(['x', '--out', 'w', '--pick', '2']).args.pick, 2)
  assert.ok(parseArgs(['x']).error)
  assert.ok(parseArgs(['--out', 'w']).error)
  assert.ok(parseArgs(['x', '--out', 'w', '--pick', '9']).error)
  assert.ok(parseArgs(['x', '--out', 'w', '--bogus']).error)
})
