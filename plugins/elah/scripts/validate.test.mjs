// node --test plugins/elah/scripts/
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const run = (...args) => spawnSync(process.execPath, [join(HERE, 'validate.mjs'), ...args], { encoding: 'utf8' })
const fx = (name) => join(HERE, 'fixtures', name)

test('valid spec: exit 0 with a one-line summary', () => {
  const r = run(fx('valid-spec.json'))
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.match(r.stdout, /^OK: spec "Launch card", 1080x1920 @ 30 fps/)
})

test('invalid spec: exit 1 and every compiler error is listed', () => {
  const r = run(fx('invalid-spec.json'))
  assert.equal(r.status, 1)
  assert.match(r.stdout, /^FAILED: 2 errors/)
  assert.match(r.stdout, /elements\[1\]\.font: unknown font role "\$nope"/)
  assert.match(r.stdout, /elements\[1\]\.enter: unknown motion preset "teleport-in"/)
})

test('html scene: valid passes, refused CSS lists each property with its substitute', () => {
  assert.equal(run(fx('valid-html.json')).status, 0)
  const r = run(fx('invalid-html.json'))
  assert.equal(r.status, 1)
  assert.match(r.stdout, /animation: spin 1s/)
  assert.match(r.stdout, /use instead: data-motion on the element/)
  assert.match(r.stdout, /text-transform/)
})

test('project input: valid passes, unreadable fails', () => {
  const ok = run(fx('valid-project.json'))
  assert.equal(ok.status, 0, ok.stdout)
  assert.match(ok.stdout, /^OK: project/)
  const bad = run(fx('invalid-project.json'))
  assert.equal(bad.status, 1)
  assert.match(bad.stdout, /no list of tracks/)
})

test('bad envelope and unreadable files exit 1', () => {
  assert.match(run(fx('invalid-kind.json')).stdout, /source\.kind: must be/)
  assert.equal(run(fx('invalid-kind.json')).status, 1)
  const r = run(fx('not-json.json'))
  assert.equal(r.status, 1)
  assert.match(r.stdout, /cannot read .* as JSON/)
  assert.equal(run(fx('does-not-exist.json')).status, 1)
})

test('--json prints a machine-readable result', () => {
  const r = run('--json', fx('invalid-spec.json'))
  assert.equal(r.status, 1)
  const out = JSON.parse(r.stdout)
  assert.equal(out.ok, false)
  assert.ok(out.issues.some((i) => i.severity === 'error' && /unknown-token/.test(i.message)))
})

test('--vocabulary prints the spec vocabulary; no arguments is a usage error', () => {
  const v = run('--vocabulary')
  assert.equal(v.status, 0)
  assert.match(v.stdout, /FONTS/)
  assert.equal(run().status, 2)
})
