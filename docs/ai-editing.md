# AI Editing — the `/edit` agent

> Natural-language editing for the Elah timeline. Type an instruction; the agent
> plans timeline edits, you confirm, it applies them as one undo step.

## What it does

The `/edit` command bar (bottom of the production editor) turns instructions into
timeline edits:

- **Frame/clip edits** — "split the selected clip", "trim the first clip to 2 seconds",
  "delete that clip". Planned directly from the timeline state; no video analysis.
- **Content-aware edits** — "cut where the person says Hi", "remove the part where they jump".
  The agent watches the video, locates the moment, and cuts it.

Every plan is previewed before it runs. Applying is a single undo entry (Ctrl+Z reverts the whole edit).

## Architecture (two stages)

```
/edit request
   │
   ├─ content cue? ──▶ Gemini 3 Flash (video understanding)
   │                     → events in SOURCE seconds
   │                     → mapVideoEventsToTimeline() → TIMELINE frames   [deterministic]
   │
   └─▶ Groq planner (llama-3.3-70b) : request + clips + frame-events → EditCommand[]  [JSON]
          │
          ▼
   interpretEditCommands(engine, commands)  →  TimelineEngine.batch()  (one undo entry)
```

- **No FFmpeg.** Edit commands (`trim`, `split`, `delete`, `move`, `cutRange`) are a thin JSON
  schema over the engine's existing mutation API — fully undoable.
- **Seconds→frames is deterministic**, never left to the LLM (`packages/core/src/commands/mapVideoEvents.ts`).
- Command validation rejects any clip/track id the model invents.

## Code map

| Concern | File |
|---------|------|
| Command schema + interpreter | `packages/core/src/commands/{editCommand,interpretEditCommands}.ts` |
| Event → frame mapping (pure, tested) | `packages/core/src/commands/mapVideoEvents.ts` |
| Video understanding (Gemini) | `apps/web/lib/ai/videoUnderstanding.ts` |
| Command planner (Groq) | `apps/web/lib/ai/editPlanner.ts` |
| 429/backoff retry | `apps/web/lib/ai/retry.ts` |
| Server route | `apps/web/app/api/ai/edit-agent/route.ts` |
| Command bar UI | `apps/web/components/playground/production/EditCommandBar.tsx` |

## Models & keys

Set in `.env.local` (server-side only):

- `GEMINI_API_KEY` — video understanding. Default model `gemini-3-flash-preview` (free tier: 10 RPM,
  1,500 req/day). Override with `GEMINI_MODEL`.
- `GROQ_API_KEY` — command planning. Default `llama-3.3-70b-versatile`. Override with `GROQ_MODEL`.

## Video transport

- Clips **≤15MB** are sent inline (base64) in a single request.
- Larger clips go through the **Gemini Files API** (up to 2GB, stored 48h) and the upload is **cached
  per source** (`assetId:lastModified`), so repeat requests on the same clip skip re-upload — which
  also eases the 10 RPM limit. Client cap: 100MB.
- Video analysis only runs when the request contains a content cue ("where", "says", "jump", "scene", …),
  so pure frame edits never spend a Gemini call.

## Limits / follow-ups

- Free-tier Gemini is 10 RPM — bursts are retried (backoff, Retry-After) but heavy use needs a paid key.
- Frame precision depends on project fps; the mapper snaps to the nearest frame and clamps to clip bounds.
- Large inline uploads pass through the app's own route — fine for short clips, Files-API path handles the rest.
