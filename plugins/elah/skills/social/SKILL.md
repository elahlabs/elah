---
name: social
description: Make a vertical 9:16 video for Reels, Shorts, TikTok, Instagram or a story (square 1:1 for a feed post) that Claude drafts, you preview, edit frame by frame and export as an MP4, all in your browser, with Elah. Use when the user asks for a reel, story, Short, TikTok, Instagram clip, vertical or phone-shaped video.
argument-hint: "[what the clip is about, length, look; say feed for square]"
allowed-tools: Bash(node *validate.mjs *) Bash(node *stage.mjs *) Bash(node *sfx-search.mjs *)
---

# Make a vertical social video with Elah

The user wants: $ARGUMENTS

This is the `video` skill's flow with the shape fixed. Elah renders in the viewer's browser; this plugin never renders an MP4
itself, and you must never say it did. The MP4 is exported from the artifact.

## Shape

- Stage **1080x1920** (9:16). If the brief says feed, post or square, use **1080x1080** instead. Never landscape.
- Length: the brief's own, otherwise 15 s (9-30 s).
- Read `${CLAUDE_PLUGIN_ROOT}/reference/formats/social-vertical.md` (safe zones, type floor, pace) and, besides it, the brief's own
  format file from `reference/director.md` (a launch brief also reads `formats/launch.md`, a quote reads `formats/kinetic-type.md`,
  and so on). A brief with no other format signal uses the social format alone.

## Flow

Follow the `video` skill from its step 1, with `format: social` on top of the brief's format and the shape above. Do not ask
anything beyond what `video` allows; if the brief is empty, ask once what the clip is about. Look, palette and energy come from
`reference/director.md`. Sound is as in `video` ("Sound": with sound unless the brief says silent; offer the other in one line; cues only where something lands, at most one per beat; A sound beyond the pack follows the `video` skill's rule (`sfx-search.mjs`, CC0 only, at most 4 per video, each named with its author in the closing note).); many viewers watch muted, so the video must read without it. Validation, the self-review round (at most 3 rounds), publishing, the closing line and the no-Artifact
fallback are exactly as in `video`. Offer a reply that starts "Options first" only when the brief asks for options (see
`reference/director.md`, "Options first").

Publish with `capabilities: {downloads: true, comments: {customAnchors: true}, artifact: {}}` (as in the `video` skill step 3). Before revising it later, read its live `elah-input.json` first, as the `video` skill says. For a follow-up comment from the artifact, or one pinned to a moment (`t=` anchor), follow `video`'s "When a follow-up comment arrives" section (a vertical or square request keeps the social frame sizes above).
