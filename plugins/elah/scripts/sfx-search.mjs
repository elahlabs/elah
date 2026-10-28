// Search Openverse for a short CC0 sound and put it in a work folder. Plain Node 18+, no dependencies, no API key.
//
//   node sfx-search.mjs "<query>" --out <work folder> [--max-seconds 3] [--pick <n>]
//
// Search mode prints the top 5 candidates as JSON (index, title, author, seconds, source page).
// --pick <n> downloads candidate n into <work>/assets/sfx/<slug>.mp3 and appends its provenance to
// <work>/assets/sfx/credits.json. Reference the file as data-sfx="assets/sfx/<slug>.mp3" (programmatic video) or an
// sfx cue "assets/sfx/<slug>.mp3" (VideoSpec). Only CC0 mp3 files are kept: nothing else may be used, even with credit.
//
// Exit codes: 0 ok, 1 no result or network error (one-line message on stderr), 2 usage.
// The script contacts api.openverse.org and the https host a result names (normally cdn.freesound.org). The artifact
// page never does; it only plays the published file.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const API = 'https://api.openverse.org/v1/audio/'
export const MAX_BYTES = 2 * 1048576
export const DEFAULT_MAX_SECONDS = 3
export const TOP = 5

/** Keep CC0 mp3 results with an https url and a duration of at most `maxSeconds`. */
export function filterResults(results, maxSeconds = DEFAULT_MAX_SECONDS) {
  const out = []
  for (const r of Array.isArray(results) ? results : []) {
    if (!r || typeof r !== 'object') continue
    if (String(r.license ?? '').toLowerCase() !== 'cc0') continue
    if (String(r.filetype ?? '').toLowerCase() !== 'mp3') continue
    const ms = Number(r.duration)
    if (!Number.isFinite(ms) || ms <= 0 || ms > maxSeconds * 1000) continue
    let url
    try {
      url = new URL(String(r.url ?? ''))
    } catch {
      continue
    }
    if (url.protocol !== 'https:') continue
    out.push({ ...r, _order: out.length })
  }
  return out
}

/** Sort by how close the duration is to the 0.3 to 1.5 s sweet spot (0 inside it), then by API order. */
export function rank(candidates) {
  const dist = (r) => {
    const s = Number(r.duration) / 1000
    return s < 0.3 ? 0.3 - s : s > 1.5 ? s - 1.5 : 0
  }
  return [...candidates].sort((a, b) => dist(a) - dist(b) || a._order - b._order)
}

/** The public shape of one candidate. */
export function describe(r, index) {
  return {
    index,
    title: String(r.title ?? ''),
    author: String(r.creator ?? ''),
    seconds: Math.round(Number(r.duration)) / 1000,
    sourcePage: String(r.foreign_landing_url ?? r.url ?? ''),
  }
}

/** A file-name stem from a title: lowercase a-z0-9 and single hyphens, at most 40 characters, never empty. */
export function slugify(title) {
  const s = String(title ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\.(mp3|wav|aif|aiff|ogg|flac)$/i, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '')
  return s || 'sound'
}

/** `slug`, or `slug-2`, `slug-3` ... when taken. `taken` is a Set (or anything with `has`) of existing stems. */
export function uniqueSlug(slug, taken) {
  if (!taken.has(slug)) return slug
  for (let n = 2; ; n++) if (!taken.has(`${slug}-${n}`)) return `${slug}-${n}`
}

/** Append an entry to a credits document (`{ sounds: [...] }`); an entry with the same file is replaced. Pure. */
export function mergeCredits(existing, entry) {
  const sounds = Array.isArray(existing?.sounds) ? existing.sounds.filter((s) => s && s.file !== entry.file) : []
  return { sounds: [...sounds, entry] }
}

/** An MP3 file starts with an ID3 tag or an MPEG frame sync (11 set bits). */
export function looksLikeMp3(buf) {
  if (!buf || buf.length < 3) return false
  if (buf.toString('latin1', 0, 3) === 'ID3') return true
  return buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0
}

export function parseArgs(argv) {
  const args = { query: '', out: '', maxSeconds: DEFAULT_MAX_SECONDS, pick: undefined }
  const rest = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--out') args.out = argv[++i] ?? ''
    else if (a === '--max-seconds') args.maxSeconds = Number(argv[++i])
    else if (a === '--pick') args.pick = Number(argv[++i])
    else if (a.startsWith('--')) return { error: `unknown option ${a}` }
    else rest.push(a)
  }
  args.query = rest.join(' ').trim()
  if (!args.query) return { error: 'a search query is required' }
  if (!args.out) return { error: '--out <work folder> is required' }
  if (!Number.isFinite(args.maxSeconds) || args.maxSeconds <= 0 || args.maxSeconds > 10) return { error: '--max-seconds must be a number from 0 to 10' }
  if (args.pick !== undefined && (!Number.isInteger(args.pick) || args.pick < 0 || args.pick >= TOP)) return { error: `--pick must be a whole number from 0 to ${TOP - 1}` }
  return { args }
}

async function search(query, maxSeconds) {
  const url = new URL(API)
  url.searchParams.set('q', query)
  url.searchParams.set('license', 'cc0')
  url.searchParams.set('extension', 'mp3')
  url.searchParams.set('page_size', '20')
  const res = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'elah-plugin-sfx-search' } })
  if (!res.ok) throw new Error(`Openverse answered HTTP ${res.status}`)
  const body = await res.json()
  return rank(filterResults(body.results, maxSeconds)).slice(0, TOP)
}

async function main(argv) {
  const parsed = parseArgs(argv)
  if (parsed.error) {
    process.stderr.write(`${parsed.error}\nusage: node sfx-search.mjs "<query>" --out <work folder> [--max-seconds 3] [--pick <n>]\n`)
    return 2
  }
  const { args } = parsed
  let top
  try {
    top = await search(args.query, args.maxSeconds)
  } catch (e) {
    process.stderr.write(`Openverse search failed: ${e instanceof Error ? e.message : String(e)}\n`)
    return 1
  }
  if (!top.length) {
    process.stderr.write(`No CC0 mp3 of at most ${args.maxSeconds} s found for "${args.query}"; try another word or a longer --max-seconds.\n`)
    return 1
  }
  if (args.pick === undefined) {
    process.stdout.write(JSON.stringify(top.map(describe), null, 2) + '\n')
    return 0
  }
  const r = top[args.pick]
  if (!r) {
    process.stderr.write(`There is no candidate ${args.pick}; the search found ${top.length}.\n`)
    return 1
  }
  let buf
  try {
    const res = await fetch(r.url, { headers: { 'user-agent': 'elah-plugin-sfx-search' } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    buf = Buffer.from(await res.arrayBuffer())
  } catch (e) {
    process.stderr.write(`Download failed: ${e instanceof Error ? e.message : String(e)}\n`)
    return 1
  }
  if (buf.length > MAX_BYTES || buf.length === 0) {
    process.stderr.write(`The file is ${buf.length} bytes; a sound may be at most ${MAX_BYTES} bytes. Pick another candidate.\n`)
    return 1
  }
  if (!looksLikeMp3(buf)) {
    process.stderr.write('The download is not an MP3 file. Pick another candidate.\n')
    return 1
  }
  const dir = join(resolve(args.out), 'assets', 'sfx')
  mkdirSync(dir, { recursive: true })
  const creditsPath = join(dir, 'credits.json')
  let credits = { sounds: [] }
  if (existsSync(creditsPath)) {
    try {
      credits = JSON.parse(readFileSync(creditsPath, 'utf8').replace(/^﻿/, ''))
    } catch {
      process.stderr.write(`${creditsPath} is not valid JSON; fix or remove it first.\n`)
      return 1
    }
  }
  const taken = new Set((credits.sounds ?? []).map((s) => String(s.file ?? '').replace(/\.mp3$/, '')))
  const slug = uniqueSlug(slugify(r.title), taken)
  const file = `${slug}.mp3`
  writeFileSync(join(dir, file), buf)
  const entry = {
    file,
    path: `assets/sfx/${file}`,
    query: args.query,
    title: String(r.title ?? ''),
    author: String(r.creator ?? ''),
    sourcePage: String(r.foreign_landing_url ?? r.url ?? ''),
    licence: 'CC0 1.0',
    licenceUrl: String(r.license_url ?? 'https://creativecommons.org/publicdomain/zero/1.0/'),
    seconds: Math.round(Number(r.duration)) / 1000,
    bytes: buf.length,
    sha256: createHash('sha256').update(buf).digest('hex'),
  }
  writeFileSync(creditsPath, JSON.stringify(mergeCredits(credits, entry), null, 2) + '\n')
  process.stdout.write(JSON.stringify({ picked: describe(r, args.pick), ...entry }, null, 2) + '\n')
  return 0
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code
  })
}
