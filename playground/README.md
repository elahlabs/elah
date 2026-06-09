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
timeline, asset/element panels, a text-properties inspector, and MP4 export.

```bash
# each app is self-contained — install + run independently
cd playground/next  && npm install && npm run dev
cd playground/react && npm install && npm run dev
```

> **Heads-up — publish the export fix first.** The export pipeline (`lazyExportVideo`)
> spawns a Web Worker that `@elah/core` references via `new URL('./ExportWorker.js', ...)`.
> The fix that makes this resolve correctly is in the local `packages/core` source but must
> be released as a new version on npm before these apps can export. Bump and publish
> `@elah/core` / `@elah/editor`, then update the `^0.1.x` ranges here.
