# 06 — Contributing to the React Native binding

> Status: proposed. Last verified: 2026-10-06.
> Everything in the repo-wide [`CONTRIBUTING.md`](../../CONTRIBUTING.md) applies: branches
> `feat/`, `fix/`, `docs/`; one-line commits `<area>: <verb> <object>`; the PR template; strict
> TypeScript; no new dependency without justification. This page adds what is specific to mobile.

## Commit areas

Add these to the `<area>` list in commit messages: `rn` (anything under
`packages/react-native` or `apps/mobile`), `native` (Swift / Kotlin / C++), `engine` for the
`@elah/core/engine` entry. Examples:

```
engine: add browser-free engine entry point
rn: record scene into SkPicture per frame
native: decode ring over MediaCodec with keyframe seek
docs: record iOS floor for react-native-skia 3.0.5
```

## Tooling

| Need | Version | Notes |
|---|---|---|
| Node / npm | 22+ / 10+ | CI uses Node 22. |
| Xcode | current stable | iOS simulator is enough for everything except codec performance. |
| Android Studio + SDK | API 26+ emulator **and** one physical mid-range device | Codec behaviour on emulators is not representative. Name the device model in every PR. |
| Expo CLI | bundled with `apps/mobile` | `npx expo run:ios` / `run:android`; Expo Go cannot load the native module. |
| Watchman | optional | Speeds up Metro on macOS. |

Install from the repo root with `npm install` as always; `apps/mobile` is a workspace member and
resolves `@elah/*` through symlinks. Build the packages once (`npm run build:packages`) before the
first run: `apps/mobile` aliases `@elah/*` to `packages/*/src` in `metro.config.js` for Fast
Refresh (mirroring `apps/web`), but the alias is only wired once RN-P3 lands.

## Commands

```bash
npm run typecheck                                       # every root workspace (apps/mobile is NOT one)
npm run test --workspace=packages/react-native          # vitest, node env
npm run build:packages                                  # apps/mobile typechecks against these .d.ts
cd apps/mobile && npm install                           # its own node_modules + lockfile
cd apps/mobile && npx expo start                        # then a / i / w, or scan with Expo Go
cd apps/mobile && npm run typecheck                     # after build:packages
cd apps/mobile && npm run bundle:android                # Metro + Hermes bundle, no device needed
cd apps/mobile && npx expo start -c                     # clear Metro cache after resolver changes
```

`apps/mobile` has its own install on purpose: Expo pins React 19.2, the root hoists React 18 for
the web packages. Its [`README.md`](../../apps/mobile/README.md) explains the Metro wiring and how
to set up an Android emulator.

## Metro traps (read before the first "cannot find module")

1. **`import.meta`.** `import ... from '@elah/core'` fails to bundle; `@elah/core/engine` does
   not. If you see `'import.meta' is currently unsupported`, you imported the wrong entry. Do
   not add `unstable_transformImportMeta` to the library's docs as a fix; it belongs only to the
   RN-P0 spike.
2. **Export conditions.** Metro asserts `import` or `require`, `react-native`, `browser`,
   `default`. Core ships ESM only, under `import` and `default`. Do not add `require` builds to
   work around a Metro problem; fix the import.
3. **Symlinked workspaces.** Metro follows symlinks by default on current versions; if a package
   resolves to a stale `dist/`, you are hitting the src/dist asymmetry described in
   [`AGENTS.md`](../../AGENTS.md). Rebuild or check the alias.
4. **Cache.** Metro caches aggressively. After touching `metro.config.js`, `package.json`
   `exports`, or Babel config: `npx expo start -c`.
5. **`zustand/middleware`.** Its ESM build contains `import.meta`. Nothing in these packages
   imports it; keep it that way (the core guard test enforces entry points).

## Tests: what runs where

| Layer | Runner | Environment | What it proves |
|---|---|---|---|
| Engine, resolver, placement math | vitest in `packages/core` | node | Unchanged; already exists. |
| `@elah/core/engine` purity | `engine.no-browser.test.ts` | node | No browser module or `import.meta` is reachable. |
| Renderer geometry, draw order, resource lifecycle | vitest in `packages/react-native` | node + `test/skiaMock.ts` | The Skia calls receive the rects `resolveDrawRect` computes; equal scenes are no-ops; leaving clips release. |
| Text wrapping parity | vitest with CanvasKit headless | node | Same line breaks as recorded web output for the bundled font. |
| Gesture reducers | vitest in `packages/react-native` (`src/timeline/model/*.test.ts`) | node | Pure `(gesture, state) → EngineCommand`, applied to the real `TimelineEngine`. Exists since RN-T0. |
| Model stays platform-free | `src/dependencyRules.test.ts` | node | No React / RN / gesture-handler / Reanimated / Skia import under `src/timeline/model`. |
| Decode accuracy, A/V sync, export determinism, fps | manual on device | real hardware | Recorded in the PR as screenshots / recordings / hashes; CI cannot run these. |

CI runs the first five. **Device evidence is mandatory for any PR that touches the renderer,
decode, audio or export**, and it is the reviewer's job to refuse a PR without it.

## Invariants checklist for review

Tick each in the PR description for changes under `packages/react-native/src/renderer`,
`src/media`, `src/audio`, `src/export`:

- [ ] `render(scene)` has no `await`, no Promise creation, no `setTimeout` inside it.
- [ ] The renderer imports nothing from `@elah/core` except types and the pure helpers
      (`resolveDrawRect`, `normalizeCrop`, `computeTextLayout`, `computeContainViewport`,
      `objectFit`). Never `TimelineEngine`, never a store.
- [ ] Equal `Scene` reference → zero Skia calls (test exists).
- [ ] A decode miss returns `null` synchronously and the layer draws the last frame.
- [ ] Only the provider's cache releases a frame image; layers borrow.
- [ ] No React state is set from the RAF loop. The only per-frame side effect is the shared
      value assignment.
- [ ] Every edit from a gesture goes through `engine.previewClip` / `commitInteraction` or a
      discrete `engine.*` method. No `store.setState` with project data.
- [ ] Time crosses the native boundary as integer frames or as `frame / fps` seconds computed
      with `framesToSeconds`; the native side never stores a float frame.
- [ ] Native methods called per frame are synchronous and allocation-free on the JS side.

## Documentation duties

- A workstream that lands flips its status in [`04-workstreams.md`](./04-workstreams.md) and
  records the surprise (what the ticket did not predict) in one paragraph under it.
- A decision confirmed or overturned updates [`05-decisions.md`](./05-decisions.md) in the same
  PR, with the evidence.
- Any number in [`02-platform-audit.md`](./02-platform-audit.md) that a core change moves (file
  counts, the `import.meta` list, the dependency table) is re-measured with the commands in its
  last section, and the header date is bumped.
- Public API changes follow [`AGENTS.md`](../../AGENTS.md) § "When you change the public API":
  barrels, READMEs, `/docs/api`, both changelogs, the AI guide.
- `packages/react-native/README.md` keeps a status table (feature → works / partial / not yet)
  that matches reality on the day of the PR. Optimism in that table is a bug.

## Review bar

A mobile PR is mergeable when: CI is green; the ticket's acceptance list is pasted with real
output; device evidence is attached; the diff stays inside the ticket's allowed files; the docs
above are updated; and the reviewer could, from the PR alone, reproduce the device check on
their own phone. "Works on my device" without the model name and OS version does not meet the
bar.
