#!/usr/bin/env node
// Local stand-in for the Anthropic Software Directory validator.
// Replicates the rules that hold a plugin for review, so you can see them
// before you submit instead of after.
//
//   node tools/directory-preflight.mjs plugins/elah
//
// It is a heuristic re-implementation, not the real validator: treat a clean
// run as "nothing obvious left", not as a guarantee of listing.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, extname } from 'node:path';

const root = resolve(process.argv[2] ?? '.');

const TEXT_LIMIT = 256 * 1024;
const ASSET_LIMIT = 16 * 1024 * 1024;
const PLUGIN_ASSET_LIMIT = 64 * 1024 * 1024;

const ASSET_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
]);

// plugin.json keys released Claude Code builds actually read at load time.
const CC_KEYS = new Set([
  'name', 'displayName', 'version', 'description', 'author', 'homepage',
  'repository', 'license', 'keywords', 'commands', 'agents', 'skills',
  'hooks', 'mcpServers', 'lspServers', 'userConfig', 'dependencies',
]);
// Keys only the directory listing reads. Reported, but no action needed.
const DIRECTORY_KEYS = new Set([
  'icon', 'documentationUrl', 'supportUrl', 'privacyPolicyUrl',
]);

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '.git' || e.name === 'node_modules') continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.isFile()) out.push(p);
  }
  return out;
}

function magicKind(buf) {
  const h = buf.subarray(0, 12);
  const s = (n) => h.subarray(0, n).toString('latin1');
  if (s(8) === '\x89PNG\r\n\x1a\n') return 'png';
  if (h[0] === 0xff && h[1] === 0xd8 && h[2] === 0xff) return 'jpeg';
  if (s(6) === 'GIF87a' || s(6) === 'GIF89a') return 'gif';
  if (s(4) === 'RIFF' && h.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  if (s(4) === 'wOF2') return 'woff2';
  if (s(4) === 'wOFF') return 'woff';
  if (s(4) === 'OTTO' || s(4) === 'true') return 'sfnt';
  if (h[0] === 0 && h[1] === 1 && h[2] === 0 && h[3] === 0) return 'sfnt';
  return null;
}

function isText(buf) {
  const n = Math.min(buf.length, 8192);
  for (let i = 0; i < n; i++) {
    const b = buf[i];
    if (b === 0) return false;
    if (b < 9 || (b > 13 && b < 32)) return false;
  }
  return true;
}

const posix = (p) => relative(root, p).split('\\').join('/');

const files = walk(root).sort();
const findings = [];
const add = (code, path, msg) => findings.push({ code, path, msg });

// Every asset path the plugin ships, indexed by basename.
const assetBasenames = new Map();
for (const f of files) {
  if (!ASSET_EXT.has(extname(f).toLowerCase())) continue;
  const rel = posix(f);
  const base = rel.slice(rel.lastIndexOf('/') + 1);
  if (!assetBasenames.has(base)) assetBasenames.set(base, []);
  assetBasenames.get(base).push(rel);
}

// Deliberately loose, because the real validator is: it matches any identifier
// merely containing a credential word (AUTH inside MAX_AUTHORED_*, TOKEN inside
// TOKEN_RE), which is where most false positives on bundled code come from.
const CREDENTIAL = /\b(API_?KEY|ACCESS_?TOKEN|AUTH_?TOKEN|BEARER|SECRET|PASSWORD|CREDENTIAL|TOKEN[_A-Z]*|[A-Z][A-Z0-9]*_(KEY|TOKEN|SECRET))\b/;
// A bare scheme counts: a url-truncating helper that holds "https://…"
// reads to the validator as a remote host.
const REMOTE_URL = /https?:\/\/[^\s"'`)]*/;
// A runtime-assembled value beside that url is what it calls "given the installer's key".
const INTERPOLATION = /\$\{\s*(process\.env|env)\s*[.[]|\$\{\s*[A-Z][A-Z0-9_]{2,}\s*\}/;

const FETCH_EXEC = [
  [/\b(curl|wget)\b[^\n|]{0,200}\|\s*(ba)?sh\b/, 'curl/wget piped into a shell'],
  [/(Invoke-WebRequest|Invoke-RestMethod|\biwr\b|\birm\b)[^\n]{0,200}\|\s*(iex|Invoke-Expression)/i, 'PowerShell download piped into Invoke-Expression'],
  [/\bimportScripts\s*\(/, 'importScripts() loads and runs remote script text'],
  [/URL\.createObjectURL\s*\(/, 'object URL built from runtime bytes (worker/blob execution)'],
  [/\beval\s*\(\s*await\b/, 'eval() of an awaited value'],
  [/new\s+Function\s*\(\s*(await\b|[a-zA-Z_$][\w$]*\s*[,)])/, 'new Function() over a runtime value'],
];

let assetBytes = 0;
const oversize = [];
const uninspectable = [];
let letThrough = 0;

for (const f of files) {
  const rel = posix(f);
  const size = statSync(f).size;
  const buf = readFileSync(f);
  const ext = extname(f).toLowerCase();

  if (ASSET_EXT.has(ext)) {
    assetBytes += size;
    const kind = magicKind(buf);
    if (!kind) {
      uninspectable.push(rel + ' (extension says image/font, bytes match no known format)');
    } else if (size > ASSET_LIMIT) {
      uninspectable.push(rel + ' (over 16 MiB)');
    } else {
      letThrough++;
    }
    continue;
  }

  if (!isText(buf)) {
    uninspectable.push(rel + ' (binary)');
    continue;
  }

  if (size > TEXT_LIMIT) oversize.push(rel + ' (' + Math.round(size / 1024) + ' KiB)');

  const body = buf.toString('utf8').slice(0, TEXT_LIMIT);

  // UNREAD_ASSET_REFERENCED — this file names an asset the validator let through unread.
  const named = new Set();
  for (const [base, paths] of assetBasenames) {
    if (body.includes(base)) for (const p of paths) named.add(p);
  }
  if (named.size) {
    const list = [...named].sort();
    const shown = list.slice(0, 3).map((x) => JSON.stringify(x)).join(', ');
    add('UNREAD_ASSET_REFERENCED', rel,
      'names ' + list.length + ' image/font file(s): ' + shown + (list.length > 3 ? ', ...' : ''));
  }

  // RUNTIME_FETCH_EXEC
  for (const [re, why] of FETCH_EXEC) {
    if (re.test(body)) { add('RUNTIME_FETCH_EXEC', rel, why); break; }
  }

  // MCP_FORWARDS_CREDENTIAL_ENV — a remote url with either a credential-named
  // identifier or a runtime-assembled value within the same window.
  // The real validator correlates across the whole file, not by proximity:
  // a credential-named identifier anywhere plus a remote url anywhere is enough.
  const url = body.match(REMOTE_URL);
  if (url) {
    const cred = body.match(CREDENTIAL);
    const interp = body.match(INTERPOLATION);
    if (cred || interp) {
      add('MCP_FORWARDS_CREDENTIAL_ENV', rel,
        'remote url ' + JSON.stringify(url[0].slice(0, 40)) + ' and, elsewhere in the same file, ' +
        (cred ? 'credential-named ' + JSON.stringify(cred[0])
              : 'a value assembled at run time ' + JSON.stringify(interp[0].slice(0, 40))));
    }
  }
}

if (oversize.length) {
  add('BINARIES_NOT_INSPECTED', oversize[0].split(' (')[0],
    oversize.length + ' file(s) over 256 KiB, inspected only that far: ' + oversize.join(', '));
}
if (uninspectable.length) {
  add('BINARIES_NOT_INSPECTED', uninspectable[0].split(' (')[0],
    uninspectable.length + ' file(s) could not be inspected as text: ' +
    uninspectable.slice(0, 10).join(', ') + (uninspectable.length > 10 ? ', ...' : ''));
}
if (assetBytes > PLUGIN_ASSET_LIMIT) {
  add('BINARIES_NOT_INSPECTED', '.',
    'images/fonts total ' + Math.round(assetBytes / 1048576) + ' MiB, over the 64 MiB per-plugin limit');
}

// UNKNOWN_KEY on the manifest.
try {
  const manifest = JSON.parse(readFileSync(join(root, '.claude-plugin', 'plugin.json'), 'utf8'));
  for (const k of Object.keys(manifest)) {
    if (CC_KEYS.has(k)) continue;
    if (DIRECTORY_KEYS.has(k)) {
      add('UNKNOWN_KEY_CROSS_TOOL', '.claude-plugin/plugin.json',
        "the directory reads '" + k + "' for the listing; Claude Code ignores it at load time. No action needed.");
    } else {
      add('UNKNOWN_KEY', '.claude-plugin/plugin.json',
        "'" + k + "' is read by no released Claude Code build - check it against the plugins reference");
    }
  }
} catch (e) {
  add('MANIFEST', '.claude-plugin/plugin.json', 'could not read or parse: ' + e.message);
}

const order = [
  'UNREAD_ASSET_REFERENCED', 'MCP_FORWARDS_CREDENTIAL_ENV', 'BINARIES_NOT_INSPECTED',
  'RUNTIME_FETCH_EXEC', 'UNKNOWN_KEY', 'UNKNOWN_KEY_CROSS_TOOL', 'MANIFEST',
];
const byCode = new Map();
for (const f of findings) {
  if (!byCode.has(f.code)) byCode.set(f.code, []);
  byCode.get(f.code).push(f);
}

console.log('Directory preflight - ' + root);
console.log(files.length + ' files; ' + letThrough + ' images/fonts let through unread (' +
  Math.round(assetBytes / 1024) + ' KiB)\n');

if (!findings.length) {
  console.log('No findings. Nothing here would hold the plugin for review.');
} else {
  for (const code of order) {
    const group = byCode.get(code);
    if (!group) continue;
    console.log(code + '  (' + group.length + ')');
    for (const f of group) console.log('  ' + f.path + '\n      ' + f.msg);
    console.log('');
  }
}

const held = findings.filter((f) => f.code !== 'UNKNOWN_KEY_CROSS_TOOL').length;
console.log(held
  ? held + ' finding(s) would hold this version for review.'
  : 'Would list without a review hold.');
