# Ready palettes and font pairs

Every palette declares all six tokens, because components colour themselves from them: `bg` (background), `ink` (main text), `muted`
(secondary text, rules), `accent` (the ~10%), `accentSoft` (glows, markers, highlight discs, ambient orbs: a quiet tint of the accent
that sits well on `bg`), `surface` (cards, icon discs, glass panels). Paste the six rows into `design.colors` with the names shown.
Contrast was checked: ink on bg at least 12:1, muted on bg at least 4.1:1, accent on bg at least 3.9:1 (use accent for large text only).
The Taste column lists the taste files that name the palette; the taste itself is chosen only in `director.md`.

| Palette | bg | ink | muted | accent | accentSoft | surface | Fonts (role: font) | Look |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| midnight-teal | #0b0f14 | #f4f6f8 | #8a94a3 | #5eead4 | #134e4a | #151b24 | sans: inter, display: space-grotesk | Midnight Glass |
| graphite-violet | #0e0b16 | #f5f3ff | #9b95b5 | #a78bfa | #3b2a6b | #181326 | sans: inter, display: space-grotesk | Midnight Glass |
| ocean-depths | #0a1f33 | #eaf4fb | #8fb0c7 | #38bdf8 | #0f4c75 | #11304d | sans: inter, display: montserrat | Midnight Glass, Clean Sheet |
| sunset-pop | #1d0f2e | #fff5ec | #c9a9b8 | #ff7a59 | #6b2a4a | #2b1744 | sans: poppins, display: archivo-black | Midnight Glass for a consumer or social brief (these fonts replace its pair) |
| neon-lime | #0a0a0a | #f2f2ee | #8c8c85 | #c6f432 | #3a4a0c | #161616 | display: anton, mono: roboto-mono | Poster Shout |
| paper-crimson | #f4efe6 | #1b1a17 | #6f6a60 | #b3261e | #ecd0cb | #fffaf0 | serif: playfair-display, sans: inter | Gallery Serif |
| golden-hour | #f7ecd8 | #2a1d10 | #7d6747 | #b85c12 | #f3d3a4 | #fff6e6 | serif: dm-serif-display, sans: poppins | Gallery Serif, warm brands |
| clean-green | #f7f7f5 | #111111 | #6b6b6b | #15803d | #bbf7d0 | #ffffff | sans: inter, serif: playfair-display | Clean Sheet |
| forest-sage | #eef2e6 | #1d2a1c | #5d6f55 | #2f7d4f | #cfe3c0 | #f9fbf4 | serif: dm-serif-display, sans: inter | Gallery Serif, wellness, Clean Sheet |
| arctic-steel | #f3f7fa | #0f1b26 | #5f7487 | #2563eb | #cfe0fb | #ffffff | sans: inter, display: montserrat | Clean Sheet, B2B, finance |
| rose-dust | #f6ebe8 | #3a2325 | #7e6164 | #b4415a | #f0cfd4 | #fff7f5 | serif: playfair-display, sans: poppins | Gallery Serif, beauty |

Palette moods follow the family of themes in the Anthropic theme-factory set (ocean, sunset, forest, golden hour, arctic, rose,
midnight, minimalist, tech); the colour values here are our own and only the font ids are Elah's twelve bundled fonts.

## Font pairs that work (only the bundled twelve exist)

- Wide and quiet tech: `inter` 400 headline, wide `letterSpacing`, with `space-grotesk` for numbers and labels.
- Magazine: `playfair-display` 400 headline, one word in its italic, `inter` support; or `dm-serif-display` for a softer serif.
- Loud and condensed: `anton` or `bebas-neue` caps headline, `roboto-mono` or `inter` support; `oswald` 700 when a heavier body is needed.
- Friendly consumer: `poppins` 800 headline and 400 support; `archivo-black` for a stamped hero word.
- Human touch: `caveat` for one handwritten note per piece, never a headline.
- Declare roles once: `"fonts": [{ "role": "sans", "font": "inter" }, { "role": "display", "font": "space-grotesk" }]`, then use `"$sans"`.
  Components read the `sans`, `serif` and `display` roles; declare `serif` if you want a component's emphasis word in a serif italic.

## A brand colour from the brief

1. Use the brand hex as `accent`, and pick the palette whose background suits the tone (dark for tech, paper for editorial).
2. Keep that palette's other five tokens. Recompute `accentSoft`: on a dark `bg` mix 25% accent into `bg` (dark, desaturated);
   on a light `bg` mix 20% accent into white.
3. Contrast: accent on `bg` at least 3:1, else lighten the accent on dark or darken it on light. Never use a brand colour as text on
   a surface it cannot reach 3:1 against.
4. Several brand colours: the primary is the accent; a second one appears only in the logo beat, nowhere else.
