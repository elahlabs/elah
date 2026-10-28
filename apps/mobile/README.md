# apps/mobile: the `@elah/react-native` dev harness

An Expo SDK 57 app (React Native 0.86, Hermes, New Architecture) that runs the real Elah engine,
the real `EditorProvider` from `@elah/react`, and the timeline model from `@elah/react-native`
on a phone. It is the place every React Native timeline issue (RN-T4 to RN-T9 in
[`docs/react-native/issues/`](../../docs/react-native/issues/README.md)) shows its work.

It is **not published** and **not a root workspace member**: it has its own `node_modules` and
`package-lock.json`, because Expo pins React 19.2 while the repo root hoists React 18 for the web
packages. Metro loads `@elah/core/engine`, `@elah/react` and `@elah/react-native` straight from
`packages/*/src`, so edits there hot-reload.

## What the screen shows

- **Transport:** Play / Pause and the timecode, driven by the engine's `PlaybackEngine` on Hermes.
- **Debug view:** the fixture's three lanes drawn with the model's `computeLaneSlots` and
  `clipRect`. Read-only, fit to width. The real `<Timeline>` replaces it in RN-T4.
- **Gesture model → engine:** each button runs the same `begin / update / end` reducers a
  gesture will run, with the finger travel a gesture would report, and applies the command to
  the engine. The JSON of the last command is shown under the buttons.
- **tracksStore:** what the store mirror holds, so you can see each command land.

The fixture is the same project the Node tests use
(`packages/react-native/src/timeline/model/__fixtures__/project.ts`), so the numbers on screen can
be checked against `commands.test.ts`:

| Button | Expected clip A afterwards |
|---|---|
| Reset | V1, frames 30 to 90 |
| Grow A end (max) | V1, 30 to 120 (stops at clip B, not at its 120-frame source) |
| Trim A end −15f | 15 frames shorter |
| Move A → V2 | on V2, same frames |
| Move A +1s | 30 frames later, or settled beside B if it would overlap |
| Undo / Redo | one gesture back / forward |

## Run it

From the repo root, once:

```bash
npm install
npm run build:packages
cd apps/mobile
npm install
```

Then start Metro:

```bash
npx expo start
```

and pick a target:

| Target | How | Needs |
|---|---|---|
| Your phone (fastest) | Install **Expo Go** from the App Store / Play Store, scan the QR code | Phone and computer on the same Wi-Fi |
| Android emulator | Press `a` in the Metro terminal | An Android Virtual Device (below) |
| iOS simulator | Press `i` | macOS with Xcode |
| Browser | Press `w` | Nothing; a quick check, not a phone |

Expo Go works today because the harness has no custom native code yet. When the native media
module lands (RN-P3+), switch to a dev build: `npx expo run:android` / `npx expo run:ios`.

### Setting up an Android emulator (Windows, macOS, Linux)

1. Install [Android Studio](https://developer.android.com/studio).
2. Open it, then **More Actions → Virtual Device Manager → Create Virtual Device** (the `+`).
3. Pick a phone (for example *Pixel 8*), then a system image: the newest **API level with a
   Google Play icon**, `x86_64` on Intel/AMD or `arm64-v8a` on Apple Silicon. Click the download
   arrow next to it, wait, then **Next → Finish**.
4. Press the ▶ button next to the new device and wait for it to boot.
5. In the Metro terminal, press `a`. Expo installs Expo Go on the emulator and opens the app.

If the emulator is very slow on Windows, turn on **Windows Hypervisor Platform** (Windows
Features), reboot, and try again. `adb devices` should list `emulator-5554` once it is running.

## Checks

```bash
npm run typecheck        # needs `npm run build:packages` at the root first (types come from dist)
npm run bundle:android   # Metro + Hermes bundle, no device needed; writes dist-check/ (gitignored)
npm run bundle:ios
```

`bundle:android` is the proof that Metro can load the engine: it fails if anything reaches the
root `@elah/core` entry or `import.meta`.

## How the wiring works (read before changing `metro.config.js`)

- `@elah/core/engine`, `@elah/react`, `@elah/react-native` resolve to `packages/*/src/index.ts`.
- Importing the root `@elah/core` by value is a **build error** with an explanation. Use
  `@elah/core/engine` for values and `import type` for types.
- npm packages imported from `packages/*/src` (react, zustand, immer) resolve from this app's
  `node_modules`, so there is exactly one React in the bundle.
- `app.json` turns off Expo's `tsconfigPaths`: the `paths` in `tsconfig.json` point TypeScript at
  the built `.d.ts` files and must not change what Metro bundles.
- On iOS and Android, `@elah/react` uses `useMediaLibrary.native.ts` (Metro's platform
  extension). The web preview is redirected to the same file in `metro.config.js`.
