---
name: brand
description: Save a brand kit (colours, fonts, base look, optional logo) from a hex colour, a logo file or a website URL, so every later /elah:video, /elah:promo, /elah:social and /elah:revise in this folder uses it automatically. Use when the user gives a brand colour, logo or website and wants their videos to match it.
argument-hint: "[a hex colour, a logo file path, or a website URL; optionally the brand name]"
allowed-tools: WebFetch
---

# Make a brand kit with Elah

The user gave: $ARGUMENTS

If that is empty and `.elah/brand.json` exists, show the current kit (see "Show it") and say how to change it. If it is empty and
there is no kit, ask once for a hex colour, a logo file or a website URL. Otherwise do not ask anything.

Read `${CLAUDE_PLUGIN_ROOT}/reference/brand.md` (the file shape and precedence), `${CLAUDE_PLUGIN_ROOT}/reference/themes.md` ("A brand
colour from the brief" and the font pairs) and section 1 of `${CLAUDE_PLUGIN_ROOT}/reference/director.md` (how a look is chosen).

## Rules

- Only brands the person supplies and owns or represents. If they ask for a third party's logo, colours or design that they do not
  represent, say you cannot copy another company's brand and offer a neutral kit from a colour of their own choosing. Do not build it.
- A logo is only ever a file the person supplies. Never draw, trace, recreate, search for or download a logo, and never download or
  copy any image from a website.
- Fonts come only from the twelve bundled ones: `inter`, `space-grotesk`, `montserrat`, `poppins`, `archivo-black`, `anton`,
  `roboto-mono`, `playfair-display`, `dm-serif-display`, `bebas-neue`, `oswald`, `caveat`. Never add another.
- Never name the medium or the technical route to the user. Look names are Midnight Glass, Gallery Serif, Poster Shout, Clean Sheet.

## 1. Read the input

- **A hex** (`#1e90ff`, `1e90ff`, three or six digits): that is the accent. The name is the one in the arguments, else "Brand".
- **A path** to an image (png, jpg, jpeg, webp, svg): it is the logo. Check that the file exists and copy it to `.elah/logo.<ext>`
  (letters, digits, `.`, `_`, `-` only in the name). Do not guess colours from it: ask once for the brand hex, unless the
  arguments also hold one. If this session can view images you may read the logo to take its dominant colour, and say you did.
- **A URL**: fetch the page with the web fetch tool. If this session has no fetch tool, say so and ask for a hex instead. From the
  visible CSS and text read the theme colour, the main button or link colour, the background and text colours, the font families,
  and the site's own name and one-line description. Map each font family to the closest bundled font (a geometric or grotesque
  sans: `inter` or `space-grotesk`; a rounded friendly sans: `poppins`; a wide sans: `montserrat`; a high-contrast serif:
  `playfair-display`; a soft serif: `dm-serif-display`; a condensed caps face: `anton`, `bebas-neue` or `oswald`; a monospace:
  `roboto-mono`). If a site's type has no reasonable match among the twelve, say so and use the nearest sans; do not add fonts.
  If the page cannot be read (blocked, empty, script-only), say so and ask for a hex.

Several inputs can come together (`#1e90ff ./logo.svg Acme`). Use all of them.

## 2. Build the kit

1. **Accent**: the brand hex; with several colours the primary one. A second brand colour is recorded as `accent2` and used only
   in the logo beat.
2. **Look**: from director section 1's signals, applied to what you know of the brand (its description, a stated field, the
   person's words). With no signal use Midnight Glass for a dark brand and Clean Sheet for a light one.
3. **Palette**: pick the ready palette in `themes.md` whose background suits the look, keep its other five tokens and apply the
   brand-colour recipe (accent as given, `accentSoft` recomputed, contrast checked and the accent lightened or darkened until it
   reaches 3:1 on `bg`). Record all six tokens as final hex values.
4. **Fonts**: two of the twelve, as `sans` plus `display` (or `serif`, `mono`), from a URL's type or the look's pair in `themes.md`.
5. **Tone**: one line of at most twelve words in the brand's own register, from what the person or the site said ("Calm, precise,
   no hype."). Invent no claims, numbers or slogans.
6. Write `.elah/brand.json` in the current directory, in the shape in `reference/brand.md`, UTF-8, no comments. Create the folder
   if needed. If a kit exists, replace it and say what changed. Touch no other file.

## 3. Show it

One line, then a small table, then how to change it:

"Saved your brand kit: Acme, Midnight Glass, accent #1e90ff, Inter + Space Grotesk."

| Token | Value |
| --- | --- |
| bg / ink / muted | ... |
| accent / accentSoft / surface | ... |
| Fonts | sans: inter, display: space-grotesk |
| Look | Midnight Glass |
| Logo | .elah/logo.svg (or "none") |

"Every `/elah:video`, `/elah:promo`, `/elah:social` and `/elah:revise` in this folder now uses it unless your brief says
otherwise. Run `/elah:brand` again with a new hex, logo or URL to replace it, or edit `.elah/brand.json`."

If a logo was recorded, add: "Your logo file is placed in the closing beat of each video."

## 4. Preview (optional)

If the Artifact tool exists, offer once: "Want a 4-second logo sting in your brand to see it?" Only on a yes, follow the `video`
skill with the brief "4s logo sting for <name>" (the kit then applies by itself). Do not publish unasked.
