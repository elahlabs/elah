# Playground

Standalone example apps that consume **`@elah/editor` from the npm registry** — not the
local monorepo `packages/`. They live outside the root `workspaces` globs (`packages/*`,
`apps/*`) on purpose, so each installs its own copy of the published package and proves the
SDK works for a real external consumer.

| App | Framework | Dev URL |
| --- | --- | --- |
| [`next/`](next) | Next.js 16 (App Router) | http://localhost:4001 |
| [`react/`](react) | Vite + React 19 | http://localhost:4002 |

Both render the same **production editor** composition (`ProductionEditor`): preview,
timeline, asset/element panels, a text-properties inspector, and MP4 export. They track
the latest published SDK — currently **`@elah/editor@^0.3.0`** (multi-track audio,
shape & freehand clips, programmatic asset insertion).

```bash
# each app is self-contained — install + run independently
cd playground/next  && npm install && npm run dev
cd playground/react && npm install && npm run dev
```

> **Consuming the SDK styles.** Every consumer must import the package stylesheet
> once at the app root — `import '@elah/editor/styles.css'` — or the SDK components
> (Timeline, Preview, Asset/Elements panels) render unstyled. The Next app does this in
> [`next/app/layout.tsx`](next/app/layout.tsx); the React app in
> [`react/src/main.tsx`](react/src/main.tsx).

> **Export-worker patch (temporary).** The published `@elah/core` dist (0.3.0)
> spawns its MP4 export worker via `new URL('./ExportWorker.ts', …)`, but only ships
> the compiled `./ExportWorker.js` — so the `.ts` specifier is unresolvable and the
> bundler fails on the editor barrel (even on first page load). Each app runs a
> `postinstall` script (`scripts/patch-elah-worker.mjs`) that rewrites that one string
> in the installed dist to `./ExportWorker.js`. It's idempotent and self-removes as a
> no-op once the SDK ships a fixed dist; delete the script + `postinstall` hook then.
