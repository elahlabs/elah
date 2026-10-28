# AGENTS.md

Brief for coding agents working **inside this repository**.

> Building an app that *consumes* Elah, rather than working on Elah itself?
> Read [`docs/ai/ELAH_FOR_AI_AGENTS.md`](docs/ai/ELAH_FOR_AI_AGENTS.md) instead — it is a
> single self-contained integration guide and needs no repo checkout.

---

## What this is

Elah is a browser-native, frame-accurate video editing engine. A framework-agnostic core
(timeline engine, pure resolver, WebGL2 renderer, WebCodecs decode, MP4 export) with React
bindings layered on top, plus a headless CLI that renders the same projects server-side.

Three invariants hold everywhere. Do not violate them:

1. **Time is integer frames.** Never store or compute positions in float seconds. Convert at
   the edges with `secondsToFrames` / `framesToSeconds`.
2. **One mutation funnel.** Every project edit goes through `TimelineEngine`. The Zustand
   stores are read-only mirrors — writing to them desyncs the UI and breaks undo.
3. **The resolver is pure.** `resolveTimeline(frame, project) → Scene` has no side effects
   and no I/O. Renderers consume `Scene` and nothing else; they never read the engine or the
   project directly.

## Layout

| Path | What lives there |
| --- | --- |
| `packages/core` | Engine, resolver, WebGL2 renderer, demux/decode, stores, export. **Zero React** — enforced by `src/no-react-imports.test.ts`. |
| `packages/react` | React bindings only: editor context, store hooks, audio hooks. |
| `packages/timeline` | The `<Timeline>` UI — tracks, clips, ruler, playhead, drag/trim/snap. |
| `packages/editor` | Batteries-included composition: `EditorProvider`, `Preview`, panels. Re-exports the public API of the three above. |
| `packages/cli` | `elah build / export / serve` — headless rendering via Playwright + system Chrome. Versioned independently. |
| `apps/web` | The marketing + docs site (elah.dev). Docs pages are hand-written TSX, not MDX. |
| `apps/server` | Render-server example built on `@elah/cli`. |
| `examples/` | Standalone example apps that install from **npm**. Outside the root workspace on purpose — see [`examples/AGENTS.md`](examples/AGENTS.md). |
| `packages/react-native` | `@elah/react-native` 0.1.0, pre-release, not published. Today: the platform-free timeline model (`src/timeline/model/`, Node tests, no React Native import allowed there). Versions independently, like the CLI. |
| `apps/mobile` | Expo dev harness for `@elah/react-native`. **Not a root workspace member**: own `node_modules` and lockfile (Expo pins React 19.2; the root hoists React 18). Metro loads `@elah/*` from `packages/*/src` and refuses the root `@elah/core` (its `import.meta`). See its `README.md`. |
| `docs/react-native/` | Hand-off docs for the React Native binding (audit, architecture, workstreams, and the contributor issue drafts in `issues/`). Start at its `README.md`. |

## Commands

```bash
npm run build:packages   # build all packages (apps consume dist/ — see below)
npm run test             # vitest across core, react, timeline, editor, cli, apps/web
npm run typecheck        # tsc --noEmit across all workspaces
npm run dev              # apps/web on :3001 (`next dev --port 3001`)
npm run lint:tokens      # check --elah-* design token usage (raw colour literals in package components)
npm run verify:examples  # build all three examples/ apps against the published npm packages
```

`verify:examples` is the only check that exercises the *published* tarballs — everything else
runs against local source. Run it after a release, and after changing anything in `examples/`.

## The src/dist asymmetry — read this before debugging a stale build

`packages/*` compile to `dist/`, and their `package.json` `main`/`exports` point at `dist/`.
So **anything importing `@elah/*` gets the built output**, and editing a package's `src/`
has no effect until you run `npm run build:packages`.

**`apps/web` is the exception.** Its `next.config.mjs` aliases `@elah/*` straight to
`packages/*/src/index.ts` (for both Turbopack in dev and webpack in prod builds), so the
website picks up source edits with normal Fast Refresh and never needs a rebuild.

If a change "isn't taking effect," this asymmetry is almost always why.

### The export worker

`packages/core/src/export/exportVideo.ts` spawns its worker with
`new URL('./ExportWorker.ts', import.meta.url)`. **The `.ts` is deliberate** — that is the
file that exists next to it in source, which is what `apps/web` resolves. The published
package ships only `ExportWorker.js`, so `packages/core/scripts/fix-worker-specifier.mjs`
rewrites the extension in `dist/` as the last step of the core build. It fails the build if
it can't find the specifier. Do not "fix" the literal in source; you would break `apps/web`.

## Releases

`@elah/core`, `@elah/react`, `@elah/timeline`, and `@elah/editor` are released **together
and share one version**. `@elah/cli` versions independently (it depends on `@elah/core`
only, and has its own tag).

To cut a release:

1. Bump `version` in the `package.json` of every package being released **and** the internal
   `@elah/*` dependency ranges (react→core, timeline→core+react, editor→all three, cli→core).
2. `npm install --package-lock-only` — **before tagging**, so the lockfile that gets tagged
   already carries the new versions.
3. `npm run build:packages`.
4. Add an entry to `CHANGELOG.md` (Keep a Changelog format).
5. Mirror it into `apps/web/config/changelog.ts` — the **single source of truth** for the
   site's version badge and `/changelog` page. `releases[0]` must be the current version;
   `currentVersion` derives from it.

Release gate: `npm run build:packages` + `npm run test` + `npm run build --workspace=apps/web`
must all exit 0. After publishing, run `npm run verify:examples` (the only check that
exercises the published tarballs).

### Publishing (maintainer only)

**Agents do not run `npm publish`.** Publishing is done manually by the maintainer, in
this order, one package at a time:

```
@elah/core  →  @elah/react  →  @elah/timeline  →  @elah/editor  →  @elah/cli
```

Each package depends on the ones before it, so a later package published first would
resolve a version that is not on the registry yet. Publish each with an explicit workspace
and `--access public`:

```bash
npm publish --workspace=packages/core --access public
# …then react, timeline, editor, cli, in that order
```

**Never use `npm publish --workspaces`**: it gives no control over order and no pause to
check each package, and `@elah/cli` is released on its own version and schedule.

Tag the release commit after the lockfile is committed: `v<version>` for the four
lockstep packages (for 1.0.0, `v1.0.0`) and `cli-v<version>` for the CLI (for CLI 1.0.0,
`cli-v1.0.0`).

## Conventions

- **License is Apache-2.0** (`LICENSE`, `NOTICE`). Not MIT, not ECL.
- Tests are `vitest`, colocated as `*.test.ts(x)` next to the code, `jsdom` for UI packages.
- Styling is Tailwind compiled **per package** into that package's own `dist/styles.css`,
  driven by the shared `tailwind.preset.ts`. Colours come from `--elah-*` tokens
  (`packages/editor/src/styles/tokens.css`, documented in `docs/design-tokens.md`) — never
  hardcode a hex value in a component.
- Each package's `tailwind.config.ts` only scans its **own** `src/`, which is why consumers
  must import both `@elah/timeline/styles.css` and `@elah/editor/styles.css`.
- Architecture notes live next to the code they describe (`packages/core/src/renderer/architecture.md`,
  `packages/core/src/export/Architecture.md`, …) plus repo-root `ARCHITECTURE.md`.

## When you change the public API

Adding or renaming an export means updating, in the same change:

1. `packages/editor/src/index.ts` — the barrel most consumers import from (and the barrel of
   the package that owns the export: `packages/{core,react,timeline,cli}/src/index.ts`).
2. The README of every package the export touches: `packages/core/README.md`,
   `packages/react/README.md`, `packages/timeline/README.md`, `packages/editor/README.md`,
   `packages/cli/README.md` (and the root `README.md` if it lists the feature).
3. `apps/web/app/docs/api/page.tsx` (`/docs/api`) and any docs page showing it.
4. `CHANGELOG.md` + `apps/web/config/changelog.ts`.
5. `docs/ai/ELAH_FOR_AI_AGENTS.md` — the standalone agent guide duplicates the API surface
   by design, so it goes stale silently if you skip it.
