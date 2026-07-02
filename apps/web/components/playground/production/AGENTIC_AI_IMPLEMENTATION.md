# Agentic AI Panel — Implementation Spec

> **Audience:** an AI coding agent (or developer) implementing this feature from scratch.
> **Scope:** everything lives in `apps/web` of the Elah monorepo. No other packages are touched.
> **Rule #1:** API keys must NEVER reach the browser. All LLM and stock-media calls go through
> Next.js API routes that read keys from `process.env` (server-side only).

---

## 1. What we're building

A new **"Agentic AI"** tab in the production playground's left icon rail. The user types what
video they want to create; the server asks OpenAI for **three creative directions** (each shaped
exactly like the existing curated `PEXELS_TOPICS` entries); the user picks one; the existing
Pexels/Freesound → timeline composition pipeline runs unchanged.

```
User prompt ("cozy rainy night in Tokyo")
      │
      ▼  POST /api/ai/topics          ← server-side, uses OPENAI_API_KEY
OpenAI (structured outputs, JSON schema)
      │
      ▼  { options: [ {name, topic}, {name, topic}, {name, topic} ] }
Panel shows 3 option buttons + dismiss (input disabled meanwhile)
      │  user clicks one
      ▼
loadPexelsTopic({ engine, timelineRef, topicName, topic })
      │  (extracted from existing loadRandomPexels — same code path)
      ▼
/api/pexels/videos, /api/pexels/photos, /api/freesound   ← existing server proxies
      │
      ▼
Timeline composed: video lane + fades + 4 text lanes + 2 audio lanes
```

### UX reference (from user mockups)

- **Mockup 1:** A panel titled "Agentic AI". Bottom: a prompt input ("What do you want to
  create?") with a send button. After the AI responds, a row/group of **3 options with an ×
  (dismiss) button** appears, and the **input is disabled** until the user picks an option or
  dismisses. The 3 options are "basically an array of 3 objects".
- **Mockup 2:** The tab goes in the **left icon rail below "Elements"** (the rail with
  Videos / Photos / Audio / Elements). The Agentic AI rail item uses the **red color from the
  design system** (see §8) instead of the cyan accent used by the other items.

---

## 2. Existing code you must understand first

All paths relative to `apps/web/`.

| File | Role |
|---|---|
| `components/playground/production/loadRandomPexels.ts` | The pipeline to reuse. Contains `PEXELS_TOPICS` (curated topics), `interface PexelsTopic`, and `loadRandomPexels()` which picks a random topic then fetches media + composes the timeline. **You will refactor this** (§5). |
| `components/playground/production/ProductionEditor.tsx` | Owns the editor layout: `AppHeader`, `LeftRail` (the icon rail — `RAIL_ITEMS` const), `activePanel` state, panel mounting, `timelineRef`, and the shared `loadingPexels` / `setLoadingPexels` busy state (shows a spinner overlay over the timeline). **You will wire the new tab + panel here** (§7). |
| `components/playground/production/MediaPanel.tsx` | Reference for panel look & feel: header bar (`border-b border-ed-border px-3.5 py-2.5`, 13px semibold title), inputs (`rounded-md border border-ed-border bg-ed-bg-2 … text-[12px]`), etc. Copy its styling vocabulary. |
| `app/api/pexels/photos/route.ts` | Reference for the API route pattern: parse params → call lib client → `NextResponse.json(data)`; on error return `{ error: message }` with status `502`. |
| `lib/pexels/client.ts` | Reference for the server client pattern: `getApiKey()` reads `process.env.X` and throws `'X is not configured on the server.'` if missing; a private `fetch` helper; exported typed functions. |
| `.env.example` | Has `PEXELS_API_KEY` and `FREESOUND_API_KEY` blocks with comments. **Add `OPENAI_API_KEY` here** (§9). |

### The `PexelsTopic` shape (the contract everything hinges on)

From `loadRandomPexels.ts` — the LLM must produce objects of exactly this shape:

```ts
interface PexelsTopic {
  videotags: string[]   // Pexels VIDEO search phrases, e.g. ['ocean waves', 'underwater']
  imagetags: string[]   // Pexels PHOTO search phrases, e.g. ['coral reef', 'beach sunset']
  audiotags: string[]   // Freesound phrases; index 0 = main music bed (full volume),
                        // index 1 = secondary ambience (half volume), index 2+ = unused pool
  captions: string[]    // Text overlays; index 0 = hero line (rendered at 76px),
                        // rest are small kickers/tags (44–60px), ~6 total
}
```

Curated example (the LLM output should imitate this style):

```ts
ocean: {
  videotags: ['ocean waves', 'underwater', 'scuba diving', 'surfing'],
  imagetags: ['ocean', 'coral reef', 'beach sunset', 'sea turtle'],
  audiotags: ['cinematic ambient calm', 'ocean waves ambience', 'seagulls beach'],
  captions: ['Dive into the deep.', 'WAVES OF WONDER', 'OCEAN',
             'Explore below the surface.', '— BLUE PLANET —', 'SALT AIR'],
}
```

### Constraints discovered during planning

- **No OpenAI SDK, no zod** in `apps/web/package.json`. Do **not** add dependencies — use plain
  `fetch` against `https://api.openai.com/v1/chat/completions` with structured outputs.
- The pipeline already tolerates sparse search results (skips missing items; throws only when
  **zero** visuals load), so LLM-invented tags that miss on Pexels degrade gracefully.
- `engine.batch()` is synchronous — all network fetches happen **before** it (the existing code
  already does this; don't restructure it).

---

## 3. New file: `lib/ai/types.ts`

Shared types between server route and client panel.

```ts
/**
 * Shared shapes for the Agentic AI topic generator (app/api/ai/*).
 *
 * `GeneratedTopic` mirrors the curated `PEXELS_TOPICS` entries in the
 * production playground: search tags for the Pexels/Freesound proxies plus
 * caption copy for the text lanes. The LLM produces these; the existing
 * `loadPexelsTopic` pipeline consumes them unchanged.
 */

export interface GeneratedTopic {
  videotags: string[]
  imagetags: string[]
  audiotags: string[]
  captions: string[]
}

/** One creative direction offered to the user. */
export interface TopicOption {
  /** Short 2–4 word title, e.g. "Neon Nights". */
  name: string
  topic: GeneratedTopic
}

/** Response body of POST /api/ai/topics. */
export interface TopicOptionsResponse {
  options: TopicOption[]
}
```

---

## 4. New file: `lib/ai/client.ts`

Server-side OpenAI client. Mirror the structure of `lib/pexels/client.ts`.

**Requirements:**

1. `getApiKey()` reads `process.env.OPENAI_API_KEY`; throws
   `'OPENAI_API_KEY is not configured on the server.'` if missing/empty.
2. Model: `process.env.OPENAI_MODEL || 'gpt-4o-mini'` (cheap default, env-overridable).
3. One exported function:

   ```ts
   export async function generateTopicOptions(
     prompt: string,
     signal?: AbortSignal,
   ): Promise<TopicOption[]>
   ```

4. POST `https://api.openai.com/v1/chat/completions` with headers
   `Content-Type: application/json` and `Authorization: Bearer <key>`, body:

   ```jsonc
   {
     "model": "<model>",
     "temperature": 0.8,
     "messages": [
       { "role": "system", "content": SYSTEM_PROMPT },
       { "role": "user", "content": prompt }
     ],
     "response_format": {
       "type": "json_schema",
       "json_schema": {
         "name": "topic_options",
         "strict": true,
         "schema": {
           "type": "object",
           "additionalProperties": false,
           "required": ["options"],
           "properties": {
             "options": {
               "type": "array",
               "items": {
                 "type": "object",
                 "additionalProperties": false,
                 "required": ["name", "videotags", "imagetags", "audiotags", "captions"],
                 "properties": {
                   "name":      { "type": "string" },
                   "videotags": { "type": "array", "items": { "type": "string" } },
                   "imagetags": { "type": "array", "items": { "type": "string" } },
                   "audiotags": { "type": "array", "items": { "type": "string" } },
                   "captions":  { "type": "array", "items": { "type": "string" } }
                 }
               }
             }
           }
         }
       }
     }
   }
   ```

   > Note the flat option shape in the schema (`name` alongside the tag arrays). You nest it
   > into `{ name, topic: {...} }` during sanitization. Do NOT use `minItems`/`maxItems` in the
   > schema — enforce counts in the prompt + sanitizer instead (strict-mode compatibility).

5. **SYSTEM_PROMPT** (use this text, tweak only if needed):

   ```
   You turn a user's video idea into stock-media search plans for a browser video editor.

   Return exactly 3 distinct options — three different creative angles on the user's idea.
   Each option contains:
   - name: a short 2-4 word title for the angle (e.g. "Neon Nights").
   - videotags: 3-4 short Pexels video search phrases, 1-3 common words each
     (e.g. "ocean waves", "city timelapse"). Use generic, search-friendly wording —
     poetic or obscure phrases return zero stock results.
   - imagetags: 3-4 short Pexels photo search phrases, same rules.
   - audiotags: 2-3 Freesound search phrases. The first is the main music bed
     (e.g. "cinematic ambient calm"), the second is background ambience
     (e.g. "ocean waves ambience"), the optional third is an accent texture.
   - captions: exactly 6 short text overlays. The first is the hero line (a short
     sentence, max ~5 words, sentence case). Mix sentence-case lines with ALL-CAPS
     kicker words. Example set: "Dive into the deep.", "WAVES OF WONDER", "OCEAN",
     "Explore below the surface.", "— BLUE PLANET —", "SALT AIR".
   ```

6. Response handling:
   - `!res.ok` → throw `` `OpenAI request failed with status ${res.status}` ``.
   - Read `data.choices?.[0]?.message`. If `message.refusal` is a non-empty string, throw it.
   - `JSON.parse(message.content)`, then run the sanitizer below and return the result.
   - If the sanitizer yields zero valid options, throw `'The model returned no usable options.'`.

7. **Sanitizer** (defensive — never trust LLM output blindly):

   ```ts
   function cleanList(values: unknown, max: number, maxLen = 60): string[] {
     if (!Array.isArray(values)) return []
     return values
       .filter((v): v is string => typeof v === 'string')
       .map((v) => v.trim().slice(0, maxLen))
       .filter(Boolean)
       .slice(0, max)
   }

   function sanitizeOptions(raw: unknown): TopicOption[] {
     if (!Array.isArray(raw)) return []
     const out: TopicOption[] = []
     for (const item of raw) {
       if (typeof item !== 'object' || item === null) continue
       const o = item as Record<string, unknown>
       const name = typeof o.name === 'string' ? o.name.trim().slice(0, 40) : ''
       const topic = {
         videotags: cleanList(o.videotags, 4),
         imagetags: cleanList(o.imagetags, 4),
         audiotags: cleanList(o.audiotags, 3),
         captions: cleanList(o.captions, 6, 80),
       }
       // audiotags may legitimately be sparse — the pipeline tolerates missing audio.
       if (!name || !topic.videotags.length || !topic.imagetags.length || !topic.captions.length) continue
       out.push({ name, topic })
     }
     return out.slice(0, 3)
   }
   ```

---

## 5. New file: `app/api/ai/topics/route.ts`

Mirror `app/api/pexels/photos/route.ts` exactly in style.

```ts
import { NextResponse, type NextRequest } from 'next/server'
import { generateTopicOptions } from '@/lib/ai/client'

export async function POST(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  const prompt =
    typeof (body as { prompt?: unknown })?.prompt === 'string'
      ? ((body as { prompt: string }).prompt).trim()
      : ''
  if (!prompt) {
    return NextResponse.json({ error: 'Missing "prompt".' }, { status: 400 })
  }

  try {
    const options = await generateTopicOptions(prompt.slice(0, 500), req.signal)
    return NextResponse.json({ options })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Topic generation failed.'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
```

Notes: clamp prompt to 500 chars; pass `req.signal` through so client aborts cancel the
upstream call; never echo the API key or raw OpenAI payloads in errors.

---

## 6. Refactor: `components/playground/production/loadRandomPexels.ts`

Goal: expose the composition pipeline for a **caller-supplied topic** with **zero behavior
change** for the existing "Random Load from Pexels" button.

1. Export the topic type (keep its doc comment):
   - `interface PexelsTopic { ... }` → `export interface PexelsTopic { ... }`.
   - (Type is structurally identical to `GeneratedTopic` from `lib/ai/types.ts`; TypeScript's
     structural typing makes them assignable — no import needed, but you MAY alias one to the
     other if you prefer a single source of truth.)

2. Add a deps interface and split the function. The existing `loadRandomPexels` body from
   `const [topicName, topic] = pickTopic()` onward becomes `loadPexelsTopic`; nothing inside
   the body changes except that `topicName`/`topic` arrive as parameters:

   ```ts
   export interface LoadRandomPexelsDeps {
     engine: TimelineEngine
     timelineRef: RefObject<TimelineRef | null>
   }

   export interface LoadPexelsTopicDeps extends LoadRandomPexelsDeps {
     topicName: string
     topic: PexelsTopic
   }

   /** Picks one of the curated PEXELS_TOPICS at random and composes it. */
   export async function loadRandomPexels(deps: LoadRandomPexelsDeps): Promise<string> {
     const [topicName, topic] = pickTopic()
     return loadPexelsTopic({ ...deps, topicName, topic })
   }

   /**
    * Build a Pexels project from a given topic (curated or AI-generated):
    * fetches alternating video/image clips, fades, captions across the 4
    * elements lanes, and looped Freesound audio on all audio lanes.
    */
   export async function loadPexelsTopic(
     { engine, timelineRef, topicName, topic }: LoadPexelsTopicDeps,
   ): Promise<string> {
     // ← existing body of loadRandomPexels, verbatim, minus the pickTopic() line
   }
   ```

3. Do not touch `PEXELS_TOPICS`, `pickTopic`, fetch helpers, or the `engine.batch()` contents.

---

## 7. New file: `components/playground/production/AgenticPanel.tsx` + wiring

### 7a. The panel component

`'use client'` component. Props:

```ts
{
  style?: React.CSSProperties
  timelineRef: RefObject<TimelineRef | null>   // from ProductionEditor
  busy: boolean                                 // the shared loadingPexels state
  setBusy: (b: boolean) => void                 // setLoadingPexels
}
```

Get the engine via `useTimelineEngine()` from `@elah/editor` (the panel renders inside
`<EditorProvider>`, same as `AppHeader` does).

**State machine** (single-shot chat, per mockup 1):

| State | Input | Conversation area |
|---|---|---|
| `idle` (nothing asked) | enabled | Hint text: "Describe the video you want to create. I'll plan stock footage, audio and captions — then compose it on the timeline." |
| `thinking` (request in flight) | **disabled** | User's prompt as a right-aligned bubble + spinner row "Planning directions…" |
| `choosing` (options arrived) | **disabled**, placeholder "Pick a direction above…" | Prompt bubble + options card: header row ("PICK A DIRECTION" + × dismiss button) above **3 stacked option buttons**. Each button: option `name` (12px, medium) on line 1, `topic.videotags.join(' · ')` truncated (11px, muted) on line 2. |
| `composing` (`busy === true` after pick) | disabled | "Composing your project on the timeline…" (the existing full-timeline spinner overlay in ProductionEditor also shows, since we reuse `loadingPexels`) |
| error (any step failed) | enabled again | Error text in `text-ed-error` (11px); state returns to `idle` |

**Behavior:**

- Submit (Enter key or send button; ignore empty/whitespace prompt):
  `POST /api/ai/topics` with `{ prompt }` → on OK + non-empty `options`, enter `choosing`;
  otherwise show `data.error ?? 'Request failed (<status>)'` and return to `idle`. Clear the
  input on submit; remember the asked prompt for the bubble.
- **×** dismiss → drop options, back to `idle` (input re-enabled).
- Option click → drop options, `setBusy(true)`, then:

  ```ts
  await loadPexelsTopic({ engine, timelineRef, topicName: option.name, topic: option.topic })
  ```

  Wrap in try/catch → error path shows the message in the panel (also `console.error` with a
  `[playground]` prefix, matching `handleRandomPexels`); `finally { setBusy(false) }`.
- Guard: ignore submits/picks while `busy` is true (the header's Pexels button shares this flag,
  so the two entry points can't run concurrently).

**Layout & styling** — copy MediaPanel's vocabulary:

- Root: `flex h-full flex-col bg-ed-panel text-ed-text`, apply `style` prop.
- Header: `flex items-center gap-2 border-b border-ed-border px-3.5 py-2.5`, with
  `<Sparkles size={14} className="text-ed-error" />` + `<span className="text-[13px] font-semibold">Agentic AI</span>`.
- Middle: `flex-1 overflow-y-auto p-3.5 flex flex-col gap-3` (scrolls).
- User bubble: `self-end max-w-[90%] rounded-lg border border-ed-border bg-ed-elevated px-2.5 py-1.5 text-[12px]`.
- Options card: `rounded-lg border border-ed-border bg-ed-bg-2 p-2.5`; option buttons
  `rounded-md border border-ed-border bg-ed-elevated px-2.5 py-2 text-left transition-colors hover:border-[var(--elah-color-error)]`.
- Bottom bar: `border-t border-ed-border p-3` containing a flex row:
  - input: `min-w-0 flex-1 rounded-md border border-ed-border bg-ed-bg-2 px-2.5 py-1.5 text-[12px] placeholder:text-ed-text-muted focus:border-[var(--elah-color-error)] focus:outline-none disabled:opacity-50`,
    placeholder "What do you want to create?".
  - send button: square `~30px`, `bg-ed-error text-white rounded-md disabled:opacity-40`,
    `<Send size={13} />` icon (lucide-react).
- Spinner: reuse the pattern from ProductionEditor's overlay
  (`h-3 w-3 rounded-full border-2 border-white/20 animate-spin` with
  `style={{ borderTopColor: 'var(--elah-danger-text)' }}`).

### 7b. Wiring in `ProductionEditor.tsx`

1. Import `Sparkles` from `lucide-react` and `AgenticPanel` from `./AgenticPanel`.
2. `RAIL_ITEMS` is currently `as const` with 4 items. Retype it and add the new item:

   ```ts
   const RAIL_ITEMS: {
     id: string
     label: string
     Icon: typeof Film
     /** Render in the design-system danger red instead of the cyan accent. */
     danger?: boolean
   }[] = [
     { id: 'stock', label: 'Videos', Icon: Film },
     { id: 'photos', label: 'Photos', Icon: ImageIcon },
     { id: 'audio', label: 'Audio', Icon: Music },
     { id: 'elements', label: 'Elements', Icon: TypeIcon },
     { id: 'agentic', label: 'Agentic AI', Icon: Sparkles, danger: true },
   ]
   ```

3. In `LeftRail`'s render, honor `danger` (mirrors the existing cyan pattern):

   ```tsx
   style={
     on
       ? {
           background: danger
             ? 'linear-gradient(160deg, rgba(255,107,107,0.5), rgba(255,107,107,0.1))'
             : 'linear-gradient(160deg, rgba(0,194,255,0.5), rgba(0,194,255,0.1))',
         }
       : danger
         ? { color: 'var(--elah-danger-text)' }
         : undefined
   }
   ```

   (Keep the existing `className` logic; when inactive + danger, the inline color overrides the
   muted class — that's intended so the AI tab reads red in the rail, per mockup 2.)

4. Mount the panel where `activePanel` is switched (~line 546):

   ```tsx
   {activePanel === 'elements' ? (
     <ElementsPanel style={{ flex: 1, minHeight: 0 }} />
   ) : activePanel === 'agentic' ? (
     <AgenticPanel
       style={{ flex: 1, minHeight: 0 }}
       timelineRef={timelineRef}
       busy={loadingPexels}
       setBusy={setLoadingPexels}
     />
   ) : (
     <MediaPanel mode={activePanel as PanelMode} style={{ flex: 1, minHeight: 0 }} />
   )}
   ```

5. The timeline loading overlay text currently reads "Loading random Pexels project…". It now
   also shows for agentic loads — change to "Composing stock media project…".

---

## 8. Design tokens (the "red from the design system")

Defined in `apps/web/styles/globals.css` and mapped in `tailwind.preset.ts`:

| Token | Value | Tailwind class | Use for |
|---|---|---|---|
| `--elah-color-error` | `#f87171` | `text-ed-error` / `bg-ed-error` | Panel header icon, send button bg, error text, focus/hover borders (via `[var(--elah-color-error)]` arbitrary values) |
| `--elah-danger-text` | `#ff6b6b` | — | Inactive rail icon color, spinner top border |
| Red active gradient | `linear-gradient(160deg, rgba(255,107,107,0.5), rgba(255,107,107,0.1))` | — | Active rail item (mirrors the cyan `rgba(0,194,255,…)` gradient) |

Everything else uses the existing `ed-*` classes (`bg-ed-panel`, `border-ed-border`,
`text-ed-text`, `text-ed-text-muted`, `bg-ed-bg-2`, `bg-ed-elevated`). **No hex literals** except
inside the two gradient strings (matching how the cyan gradient is already inlined).

---

## 9. Env: `.env.example`

Append, matching the existing comment style:

```
## OpenAI API key — used server-side only (app/api/ai/*).
## Powers the Agentic AI panel in the production playground.
## Get a key at https://platform.openai.com/api-keys
OPENAI_API_KEY=

## Optional: override the model used for topic generation (default: gpt-4o-mini).
# OPENAI_MODEL=
```

The developer must also add a real `OPENAI_API_KEY` to their local `.env` to test.

---

## 10. Out of scope — do NOT do these

- No multi-turn chat history, streaming, or conversation persistence (single-shot only).
- No new npm dependencies (no `openai`, no `ai`, no `zod`).
- No changes to `@elah/editor`, `@elah/core`, or any `packages/*` — app-side only.
- No changes to the existing "Random Load from Pexels" button behavior or `PEXELS_TOPICS` data.
- No client-side OpenAI calls; no `NEXT_PUBLIC_*` key vars, ever.

---

## 11. Verification checklist

1. `pnpm --filter web typecheck` (script: `tsc --noEmit`) passes; `pnpm --filter web lint` passes.
2. Dev server up, open the production playground:
   - Rail shows a 5th item "Agentic AI" below Elements, tinted red; clicking it swaps the
     240px panel; the other 4 tabs still work.
   - With `OPENAI_API_KEY` unset: submitting a prompt shows the error
     "OPENAI_API_KEY is not configured on the server." in the panel — the app must not crash.
   - With a key: type "cozy rainy night in Tokyo" → spinner → 3 named options appear, input
     disabled; × re-enables the input; re-submitting works.
   - Clicking an option: busy overlay appears over the timeline; after it clears, the timeline
     has video/image clips with fade transitions, captions on the elements lanes, audio on the
     audio lanes; undo (Ctrl+Z) removes the whole composition as a single entry.
   - "✦ Random Load from Pexels" button in the header still works exactly as before.
3. Network tab: the browser only ever calls `/api/ai/topics`, `/api/pexels/*`, `/api/freesound`
   — no `api.openai.com`, no key material in any request or response.
