# @elah/cli — Architecture

Headless command-line runtime for the Elah video engine. This document explains
how the package is put together and why; for usage and the build-spec schema,
see [README.md](./README.md).

## Design principles

1. **Thin consumer of `@elah/core`.** No rendering or timeline logic lives
   here. Edits go through a real `TimelineEngine`; exports run core's real
   `exportVideo` — in an actual browser, because it depends on WebCodecs.
   CLI output is identical to Editor output *by construction*, not by
   reimplementation.
2. **AI-first error contract.** Every user-facing failure is a `CliError`
   whose message is path-addressed (`clips[2].duration must be …`) so a
   generating model (or human) can self-correct without reading source.
3. **Pay only for what you use.** `split`/`trim`/`build` run in plain Node;
   `playwright-core` and the browser stack are lazy-imported only on the
   export path ([bin.ts](./src/bin.ts) dynamic imports,
   [browser.ts](./src/lib/browser.ts) lazy `import('playwright-core')`).
4. **Library first, CLI second.** Everything in `src/lib/` is importable from
   `@elah/cli` ([index.ts](./src/index.ts)) with no stdout/stderr coupling;
   `src/commands/` adds the flag parsing and terminal UX on top.

## Layer map

```
bin.ts                       argv dispatch, usage, exit codes, lazy command imports
└── commands/                CLI wrappers: flag validation + stderr UX
    ├── split.ts  trim.ts    plain-Node edits via TimelineEngine
    ├── build.ts             spec file → project (and optional export)
    ├── export.ts            project file → MP4 (progress line on stderr)
    └── serve.ts             long-lived render server + signal handling
└── lib/                     the actual library (all exported via index.ts)
    ├── errors.ts            CliError { exitCode: 1 | 2 }
    ├── flags.ts timecode.ts small parsers (positive ints, SS:FF timecodes)
    ├── project-io.ts        read/validate/write Project JSON, media src resolution
    ├── spec.ts              build-spec validation + spec → Project via engine
    ├── probe.ts             media duration/dimensions via mediabunny (pure Node)
    ├── build-project.ts     orchestrates: validate spec → probe assets → build
    ├── browser.ts           Chromium discovery + launch (playwright-core)
    ├── harness.ts           the in-page export harness (HTML/JS as strings)
    ├── server.ts            per-render harness HTTP server (modules, media, callbacks)
    ├── render-session.ts    warm-browser session: one browser, N renders
    ├── export-project.ts    one-shot render: session → render → write file
    └── serve.ts             HTTP render service: routes, semaphore, 4xx/5xx mapping
```

Dependency direction is strictly downward: commands → lib → `@elah/core`.
Nothing in `lib/` writes to stdout; `stderr` writes exist only in
`project-io.ts` (a version-mismatch warning) and as injectable `log`
callbacks that default to stderr in serve mode.

## The two execution worlds

### Plain Node (`split`, `trim`, `build`)

`split`/`trim` load a project ([project-io.ts](./src/lib/project-io.ts)
`readProject` — structural validation with duplicate-clip-id and
unknown-track checks), locate the clip (`findClipTrack`), and apply the edit
through `TimelineEngine`. Two engine quirks are papered over at this layer:

- The engine **silently ignores** edits on locked tracks —
  `requireUnlockedTrack` ([split.ts](./src/commands/split.ts)) fails loudly
  first.
- `trimClip` commits nothing on overlap/clamp conflicts —
  [trim.ts](./src/commands/trim.ts) diffs before/after state and raises a
  descriptive error when a requested change didn't apply, and prints a
  `clamped by source bounds` note when it partially applied.

`build` is the AI-generation entry point
([build-project.ts](./src/lib/build-project.ts)):

1. `validateSpec` ([spec.ts](./src/lib/spec.ts)) — structural validation.
   Unknown/typo'd fields are rejected **by name** (an LLM can self-correct
   from `clips[3]: unknown field 'colour' — allowed: …`).
2. Every referenced asset is resolved against the spec's directory
   (`resolveMediaSource`), existence-checked, and probed **once** in
   parallel. Video/audio get real durations via
   [probe.ts](./src/lib/probe.ts) (mediabunny demuxing in Node — no browser,
   ranged reads for URLs); assets used as images get a magic-byte signature
   check with a "this looks like a still image; use track: 'image'" hint on
   probe failure.
3. `specToProject` constructs the project through a real `TimelineEngine`, so
   overlap and track rules are core-enforced. Design points:
   - **All source-bounds arithmetic happens once, in frame space** (mixing
     rounded seconds-domain quantities can violate the core invariant
     `sourceStartFrame + durationFrames <= sourceDurationFrames`). Durations
     exceeding the media get a one-frame rounding tolerance, then clamp.
   - Overlapping text/image/audio clips are **first-fit packed** onto
     additional engine tracks (`placeOnPool`); video is a single
     engine-enforced track.
   - Engine errors mention internal clip ids the spec author never wrote —
     a `specIndexByClipId` map translates them back to `clips[j]`.
   - After `addClip`, source bounds are widened to the real media length
     (`updateClip`) so later `trim`/`split` on the built project know the
     true source window.

### Browser render (`export`, `build --export`, `serve`)

Core's `exportVideo` needs WebCodecs, so the render happens in a real
Chromium page. The CLI ships no bundled browser; discovery order is
`--browser` flag → `ELAH_BROWSER` env → system Chrome → Chrome Beta → Edge
([browser.ts](./src/lib/browser.ts)) — branded Chrome is preferred because
Playwright's bundled Chromium lacks the proprietary codecs (H.264/AAC) the
default export uses.

Per render, the flow is ([render-session.ts](./src/lib/render-session.ts)):

```
prepareMedia(project)             clip srcs → /media/<token>/<n> routes; missing
                                  local files fail here, before any browser work
startHarnessServer(...)           ephemeral 127.0.0.1 HTTP server   (server.ts)
browser.newPage()
addInitScript(project, options)   inject data before any page script runs
page.goto(origin)                 loads HARNESS_HTML → /harness.js  (harness.ts)
   └─ page: import /core/export/exportVideo.js → exportVideo(project)
      progress  → POST /cb/<token>/progress
      MP4 bytes → POST /cb/<token>/result   (resolves server.result)
      errors    → POST /cb/<token>/error    (rejects  server.result)
await result                      with timeout; then close page + server
```

Key mechanisms, all in [server.ts](./src/lib/server.ts):

- **Module serving instead of bundling.** The page deep-imports core's real
  dist (`/core/export/exportVideo.js`), bypassing core's `index.js` and
  everything page-irrelevant. `resolveDistFile` tolerates tsc
  bundler-resolution output (extensionless imports, directory `index.js`,
  and the literal `./ExportWorker.ts` worker URL that ships in dist), and
  blocks path traversal.
- **Vendor rewriting.** Bare specifiers in core's dist (today only
  `mediabunny`; `immer`/`zustand` mapped defensively) are rewritten to
  `/vendor/<pkg>/…` URLs (`rewriteSpecifiers`). Vendor entry resolution
  re-reads the package's export map preferring `browser` → `import` →
  `default` (Node's own resolution would apply the `node` condition — wrong
  for code served to Chrome), and modules the package's `browser` field maps
  to `false` are served as empty modules, exactly as a bundler would.
- **Media routes.** Local files stream with HTTP Range support (mediabunny
  probes via range reads); remote URLs are proxied through the local origin
  to avoid CORS in the page.
- **Token security.** Every callback and media route carries a per-run random
  UUID token, so no other local process can post a forged `/result` into the
  output file or read the media. The server binds `127.0.0.1` on an ephemeral
  port.
- **Data-only injection.** The project is injected via
  double-stringify → `JSON.parse` in `addInitScript`, keeping the page side a
  pure data channel (an object literal would e.g. honour a `"__proto__"`
  key).

Failure paths all converge on rejecting `server.result`: in-page errors POST
`/cb/<token>/error`; tab crashes and browser disconnects call `server.fail()`
from Playwright event handlers; a configurable timeout (default 10 min) wraps
the promise. The timeout wrapper is attached (with a no-op `catch`)
*before* `page.goto` — the page can report an error before `goto` resolves,
and an unhandled rejection there would crash the process past cleanup.

### RenderSession: one browser, N renders

`createRenderSession()` is the unit of browser reuse. It memoizes a browser
promise (`ensureBrowser` relaunches if disconnected), and each `render()`
call gets a **fresh page + fresh harness server + fresh token**, torn down in
a `finally`. `exportProject` ([export-project.ts](./src/lib/export-project.ts))
is the one-shot wrapper: create session → render → optionally write the file
→ close. `elah serve` holds one session open for its whole lifetime — that is
the entire performance story of serve mode: a request pays for a tab, not a
Chrome process.

## Serve mode

[serve.ts](./src/lib/serve.ts) is a dependency-injected HTTP handler
(`createServeHandler(deps)`) plus a wiring function (`startServe`). The deps
interface (`buildSpec`, `renderProject`, `browserConnected`, `semaphore`,
`maxBodyBytes`, `log`) exists so the handler is testable with fakes — no
browser in the unit tests.

Contract (synchronous, no job queue — retry on 503):

| Route | Behavior |
|---|---|
| `GET /healthz` | `{ status, browser: "connected" \| "disconnected" }` |
| `POST /render` | build spec in, MP4 bytes out |

Status mapping in `handleRender`, in order:

- `503` + `Retry-After: 5` — non-blocking `Semaphore.tryAcquire()` fails
  (capacity = `--concurrency`). Checked **before** reading the body.
- `413` — body over `maxBodyBytes` (default 5 MiB). The reader keeps
  draining the request so `end` still fires and the socket isn't torn down
  mid-response.
- `400` — body isn't JSON.
- `422` — `buildSpec` threw a `CliError` (spec/asset validation); the
  path-addressed message goes in the response so callers can self-correct.
- `500` — render failure (`CliError` message passed through; anything else
  becomes `internal render failure`) or unexpected handler error.

The semaphore is released in a `finally`; relative spec asset paths resolve
against `--media-root`. The command wrapper
([commands/serve.ts](./src/commands/serve.ts)) warms the session before
listening, warns when bound to a non-loopback host (there is no
authentication), and shuts down gracefully on SIGINT/SIGTERM (second signal
force-exits 130).

## Error and exit-code contract

One `CliError` class ([errors.ts](./src/lib/errors.ts)) with
`exitCode: 1 | 2`; `usageError()` makes the exit-2 variant. All thrown
`CliError`s surface at exactly one catch in [bin.ts](./src/bin.ts):
`error: <message>` on stderr + `process.exit(exitCode)`. Anything else prints
`unexpected error:` with a stack and exits 1 — by contract, that's a bug.
Diagnostics go to stderr; stdout is reserved for machine-readable output
(`split`/`trim` project JSON when `--out` is omitted).

## Packaging

`type: module`, Node ≥ 18.17. The build (`npm run build`) typechecks, emits
declarations, then esbuild-bundles `dist/bin.js` (CLI, version inlined via
`__ELAH_CLI_VERSION__` define) and `dist/index.js` (library).
`@elah/core`, `mediabunny` and `playwright-core` are runtime dependencies —
core's *dist files* and mediabunny's *package root* are resolved at runtime
(`resolveModuleFile`, `import.meta.resolve` with a `createRequire` fallback
for vitest) because the harness server serves them to the browser as files;
they cannot be bundled away.

## Testing strategy

- **Unit, plain Node** — parsers, spec validation, project IO, dist-file
  resolution, specifier rewriting (`src/lib/__tests__/`).
- **HTTP-level with fakes** — `serve.test.ts` runs the real handler on a real
  socket with injected `buildSpec`/`renderProject`; `server.test.ts` runs the
  real harness server (needs `@elah/core` built) and exercises range
  requests, token forgery, vendor stubs.
- **Module-graph crawl** — `graph-crawl.test.ts` walks every transitive
  import of core's `ExportWorker` through the harness server, catching
  dist-serving misses without launching a browser.
- **End-to-end** — `e2e.test.ts` (gated behind `ELAH_E2E=1`) exports a
  fixture through real headless Chrome and probes the MP4.
- **Parity** — `scripts/parity-compare.mjs` compares an Editor export
  against a CLI export of the same project (decoded-video hashes expected
  bit-identical; audio null-test residual).
