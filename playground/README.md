# Playground

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
cd playground/minimal && npm install && npm run dev
cd playground/react   && npm install && npm run dev
cd playground/next    && npm install && npm run dev
```

They track the latest published SDK — currently **`@elah/editor@^0.4.1`**.

`react/` and `next/` render the same **production editor** composition (`ProductionEditor`):
preview, timeline, asset/element panels, a text-properties inspector, and MP4 export.
`minimal/` is deliberately tiny — the smallest thing that still imports media, scrubs, and
plays.

## Pointing an AI at these

Each app has an `AGENTS.md` scoping what to change and what not to touch. For a tool with no
repo access — Lovable, Google AI Studio, Emergent, v0 — give it
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
