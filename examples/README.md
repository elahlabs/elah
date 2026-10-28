# Examples

Standalone example apps that consume **`@elah/editor` from the npm registry** — not the
local monorepo `packages/`. They live outside the root `workspaces` globs (`packages/*`,
`apps/*`) on purpose, so each installs its own copy of the published package and proves the
SDK works for a real external consumer.

| App | Framework | Dev URL | Start here if… |
| --- | --- | --- | --- |
| [`minimal/`](minimal) | Vite + React 19 | http://localhost:4003 | **You are building a custom UI.** ~130 lines, all of it integration contract. |
| [`react/`](react) | Vite + React 19 | http://localhost:4002 | You want a finished production editor to crib from. |
| [`next/`](next) | Next.js 16 (App Router) | http://localhost:4001 | Same, on Next.js — also shows the client-only mount and `transpilePackages`. |

```bash
# each app is self-contained — install + run independently
cd examples/minimal && npm install && npm run dev
cd examples/react   && npm install && npm run dev
cd examples/next    && npm install && npm run dev
```

They target the **1.0.0** line of the SDK (`@elah/core`, `@elah/react`, `@elah/timeline` and
`@elah/editor` 1.0.0, released 2026-10-28). The `@elah/editor` range in each app's
`package.json` is currently **`^0.6.0`** in all three (`minimal/`, `react/`, `next/`). A caret
range on a `0.x` version only matches `0.6.x`, so an install resolves 0.6.0, not 1.0.0. Widen
the range to `^1.0.0` (`npm install @elah/editor@^1.0.0` in each app) to consume the 1.0 line.

> **Verification status.** The last full verification was on **`@elah/editor@0.6.0`, 2026-10-02**:
> a clean `npm install` from the registry (resolving `@elah/core`, `@elah/react` and
> `@elah/timeline` 0.6.0), then `typecheck`, `dev` and `build` for all three, plus a full MP4
> export in `react/` and `next/` under both the dev server and the production build
> (`vite preview` / `next start`). **It has not been repeated on 1.0.0 yet and is owed:** the
> same install, typecheck, dev, build and MP4 export (dev and production) in `react/` and
> `next/`, run against 1.0.0 from the registry once the dependency ranges are widened to the
> 1.0 line. Until that is done, treat these apps as verified on 0.6.0 only.
>
> Re-check after any change with `npm run verify:examples` from the repo root. It runs
> `npm run build` in `minimal/`, `react/` and `next/`, so it exercises the packages installed
> in each app's `node_modules` (the published tarballs, not the monorepo `packages/`). It does
> not run `dev` or an MP4 export; do those by hand.

`react/` and `next/` render the same **production editor** composition (`ProductionEditor`):
preview, timeline, asset/element panels, a text-properties inspector, and MP4 export.
`minimal/` is deliberately tiny — the smallest thing that still imports media, scrubs, and
plays.

## What 1.0 adds

The 1.0 SDK includes the motion layer: keyframes with the full ease set, springs, stagger,
motion paths, text animators, expressions, 3D tilt, 23 GPU effects, 8 generators, 9
transitions, compound and sequence clips, and Lottie / SVG import. These live in
`@elah/core` and `@elah/editor`, so they are available to any app on 1.0. The example UIs
are small compositions and do not expose a control for each of them.

The `@elah/core` subpaths `/spec`, `/html`, `/ops` and `/icons` are live in 1.0 and follow
semver like the root export. They are off the root entry only to keep it small; import from
them directly when you need them.

## Pointing an AI at these

Start with [`AGENTS.md`](AGENTS.md) — the integration contract in one page. Each app then has
its own `AGENTS.md` scoping what to change and what not to touch. For a tool with no repo
access — Lovable, Google AI Studio, Emergent, v0 — give it
[`docs/ai/ELAH_FOR_AI_AGENTS.md`](../docs/ai/ELAH_FOR_AI_AGENTS.md) instead: one
self-contained file with the full API, 12 copy-paste recipes, and the mistakes to avoid.

## Two things every consumer must get right

> **Import all three stylesheets**, at the app root, in this order:
>
> ```ts
> import '@elah/timeline/styles.css'      // ruler, tracks, clips, playhead
> import '@elah/editor/styles.css'        // Preview, AssetPanel, ElementsPanel
> import '@elah/editor/styles/tokens.css' // the 130+ --elah-* design tokens
> ```
>
> Each package compiles its own stylesheet from its own source, so they do not contain each
> other's classes. Importing only `@elah/editor/styles.css` leaves the timeline half-styled
> with unset colours. Skip `tokens.css` only if your app already defines `--elah-*` inside
> `.elah-root`. The Next app does this in [`next/app/layout.tsx`](next/app/layout.tsx); the
> Vite apps in their `src/main.tsx`.

> **Install `lucide-react` explicitly.** It is a peer dependency of `@elah/editor` (the
> timeline uses it for clip icons). npm auto-installs peers, so it can appear to work without
> being declared — pnpm and yarn do not, and neither do several AI hosting sandboxes.
