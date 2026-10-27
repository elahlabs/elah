# Brand kit: `.elah/brand.json`

`/elah:brand` writes one JSON file in the current directory, `.elah/brand.json`, plus (when a logo was supplied) a copy of the
logo beside it. Every video skill reads it at the start (`director.md`, section 1, "Brand kit" row).

## Shape

```json
{
  "name": "Acme",
  "look": "dark-glass",
  "palette": {
    "bg": "#0b0f14",
    "ink": "#f4f6f8",
    "muted": "#8a94a3",
    "accent": "#1e90ff",
    "accentSoft": "#10304f",
    "surface": "#151b24"
  },
  "accent2": "#f5a623",
  "fonts": { "sans": "inter", "display": "space-grotesk" },
  "logo": ".elah/logo.svg",
  "tone": "Calm, precise, no hype.",
  "source": "https://acme.example"
}
```

| Field | Required | Meaning |
| --- | --- | --- |
| `name` | yes | the brand's name as the person gave it |
| `look` | yes | one look id: `dark-glass` (Midnight Glass), `editorial` (Gallery Serif), `brutalist` (Poster Shout), `minimal` (Clean Sheet) |
| `palette` | yes | all six tokens as `#rrggbb`: `bg`, `ink`, `muted`, `accent`, `accentSoft`, `surface` |
| `accent2` | no | a second brand colour; only in the logo beat |
| `fonts` | yes | two roles from `sans`, `serif`, `display`, `mono`, each one of the twelve bundled font ids |
| `logo` | no | path (from the folder that holds `.elah/`) to a file the person supplied: png, jpg, jpeg, webp or svg |
| `tone` | no | one line, at most twelve words; steers wording only |
| `source` | no | the URL the kit was read from |

The twelve fonts: `inter`, `space-grotesk`, `montserrat`, `poppins`, `archivo-black`, `anton`, `roboto-mono`, `playfair-display`,
`dm-serif-display`, `bebas-neue`, `oswald`, `caveat`. A kit with anything else, a missing token or a bad hex is damaged: say so,
ignore it for this video, and suggest `/elah:brand` again.

## How the director applies it

1. At the start, look for `.elah/brand.json` in the current directory. None: nothing changes.
2. If present, section 1's defaults for **palette**, **fonts** and **look** are replaced by the kit's (the kit's look overrides the
   signal table; energy follows the look as usual). Length, shape and format are not part of the kit.
3. **Precedence:** the brief beats the brand kit, and the brand kit beats the director's defaults. A hex, a palette word, a font
   or `look:` in the brief replaces that part only; the rest of the kit still applies. A different brand in the brief (another
   name or website) means the kit is not used for that video.
4. A brief colour replaces `accent` and `accentSoft` only (recipe in `themes.md`).
5. `tone` guides the wording of text you write, never facts. `accent2` is used only in the logo beat.
6. **Logo:** if `logo` is set and the file exists, copy it into `<work folder>/assets/` (letters, digits, `.`, `_`, `-`) and show
   it in the logo or closing beat as `<img src="assets/<name>">`, as in `programmatic.md` ("Supplied images"). Never draw or
   redraw it. A video built from Elah components (sound, supplied media) cannot show the file: use the brand name as a wordmark
   in the brand fonts and say so. With no logo file, the brand name is a wordmark.
7. Say it in the one-line choice: "20 s landscape launch, Acme brand kit (Midnight Glass, #1e90ff, Inter + Space Grotesk), calm,
   6 beats." When the brief overrides part, say which: "..., your look Gallery Serif instead of the kit's."

## Limits

Only brands the person supplies and owns or represents. Never a logo the person did not supply; never fonts outside the twelve.
