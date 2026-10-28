# elah.dev — site design system

The design language of the whole site (marketing, docs, playgrounds, blog). Use it when adding a
page, section, card, popup or button so new work looks like it was always there.

The site is styled with Tailwind **arbitrary values** (`text-[15px]`, `bg-[#FF003C]`) over the
site-wide `--color-*` CSS variables (`styles/globals.css`), not the `--elah-*` editor tokens.
The values below are the vocabulary; reuse them exactly rather than inventing near-misses.

---

## 0. Edit bay (current, supersedes the sections below)

The whole site is an edit bay: pages read like footage being cut. Where this section and the
older sections disagree, this one wins. Sections 1–10 describe the old blush/coral homepage look
and are kept for history; see the homepage subsection at the end of §0 for what actually carries
over.

### Palette

Neutral paper and ink, one site-wide palette. Cyber red is reserved for selection, record and the
playhead, never for body text (it is 3.4:1 on paper).

The colours are the `--color-*` tokens in `styles/globals.css`, defined on `:root` (light) and
`.dark` (dark). Dark mode is the `.dark` class on `<html>`, toggled by the shared
`components/eb/ThemeToggle.tsx` — it stores the choice in `localStorage` (`elah-theme`, migrating
the old homepage key `elah-lp-theme`) and follows the system until the user picks. An inline
script at the top of `app/layout.tsx` applies the theme before first paint, so there is no flash.

| Token | Light | Dark | Role |
| --- | --- | --- | --- |
| `--color-surface` | `#F0EFEA` | `#0C0C0E` | Paper (page background) |
| `--color-surface-container` | `#E8E6E0` | `#18181B` | Paper 2 (hover, banding) |
| `--color-surface-low` | `#F7F6F2` | `#121215` | Card |
| `--color-surface-highest` | `#DEDCD5` | `#26262B` | Pressed / deepest step |
| `--color-on-surface` | `#0E0E10` | `#EDECE7` | Ink: text, primary button fill, stage |
| `--color-on-surface-variant` | `#5E5D58` | `#9C9B95` | Muted text (5.7:1 on paper) |
| `--color-outline-variant` | `#D9D7D0` | `#2A2A2F` | Hairline |
| `--color-primary` | `#FF003C` | `#FF003C` | Cyber red: selection, record, playhead |
| `--color-on-primary` | `#0E0E10` | `#0E0E10` | Ink on red, both themes |
| `--color-focus-ring` | `#FF003C` | `#FF003C` | Focus ring (red, not the faint outline) |

Cyber red is the same in both themes; text on red stays literal ink `#0E0E10`. Write classes as
`text-[var(--color-on-surface)]` (or the `C` map from `components/eb/tokens.ts`), never the raw
hex. The homepage's `--lp-*` variables (`styles/landing.css`) are aliases of these tokens kept so
the homepage classes keep working.

### Shared components

`components/eb/` is the kit every page composes from: `Card`, `Button`, `Slate`, `Sel`,
`CropMarks`, `ThemeToggle`, plus `tokens.ts` — the shared class vocabulary (`C`, `sans`, `mono`,
`display`, `label`, `container`, `outline`, `btn*`, `card*`, `h2`, `lead`). `landingData.ts`
feeds the shared nav and footer, and `components/eb/`'s page header rules wrap docs, playground
and marketing pages. Prefer composing these before writing new chrome.

### Type

Three voices, everywhere:
- *Display*: Big Shoulders 800, uppercase, tight leading (`display` in `components/eb/tokens.ts`).
  Headlines and card titles. The `!` prefix beats the global `:is(h1, h2, h3, h4)` display-font
  rule where a page needs Geist instead.
- *Label*: Geist Mono 11px, uppercase, `tracking-[0.14em]` (`label`). Nav, buttons, slates, tags,
  table headers, file tabs.
- *Body*: Geist Sans, muted (`--color-on-surface-variant`).

### Shape

Square corners everywhere. Frames are 1px hairlines (`--color-outline-variant`), not shadows. The
hairline is drawn as an outline (`outline` in `tokens.ts`) so it takes no layout space.

### Buttons

Mono uppercase labels. Primary: ink fill, paper text, hover red fill with ink text. Secondary:
1px ink border, hover ink fill. On an ink panel, primary is red with ink text.

### Links

Body links are ink (or muted) with a red underline, never red text — red fails contrast on light
paper (3.4:1). Red appears in links only as the underline or a marker swatch.

### Homepage specifics

The homepage keeps its edit-bay scenography on top of the shared system:
- *Slates*: every section opens with an ink rule and `SC 03 · BIND` left, a short kicker right
  (`Section` takes `n`, `scene`, `kicker`).
- *Scrub bar* (`ScrubBar.tsx`): a transport bar fixed to the bottom. Every `[data-scene]` element
  is a clip sized by its height, the red playhead tracks the reading line, timecode counts the
  page as one minute at 30 fps, and clicking a clip jumps to it. New sections need `data-scene`.
- *Viewfinder*: crop marks (`CropMarks`) and a centre cross frame the hero; a REC timecode runs
  from page load (frozen under reduced motion).
- *Program monitor*: the engine stage is ink with a header strip (`Program · hero.json`) and a
  caption strip.
- *End card*: the footer closes on the wordmark, letters spread across the column.
- *Selected word* (`<Sel>` in `components/eb/Sel.tsx`): one word per headline wears a red
  selection box with four square handles. One per headline, never more.

---

## 1. Personality

- **Warm, light, editorial.** Blush and white surfaces, near-black warm text, one coral accent.
- **The product is the illustration.** Visuals are miniature, real-looking editor UI: timelines,
  clips, keyframe diamonds, playheads and ease curves. There is no stock art and no 3D.
- **One dark moment per section, at most.** Near-black panels (`#170F10`) are used to show
  footage, export or the hero stage, never as a whole-page theme.
- **Calm motion.** Things pop in once, with a little overshoot. Nothing loops except the hero
  video and the end-of-page timeline glow.

---

## 2. Colour

### Core palette

| Role | Hex | Used for |
| --- | --- | --- |
| **Coral** (accent) | `#FF003C` | Primary buttons, accent headline line, hero clips, curves, stars, final pipeline chip |
| Coral hover | `#D10030` | Hover on every coral fill |
| **Ink** (text) | `#1B1416` | Headings, body emphasis, dark pill buttons, playheads on light |
| Ink hover | `#2E2224` | Hover on dark pill buttons |
| **Muted** text | `#77696B` | Body copy, nav links, captions, ease labels |
| **Blush** (page) | `#FFF5F3` | Page background, light cards, plugin section, footer, ghost-button hover |
| **Outline** | `#F3E2DF` | 1px outlines on every white/blush surface |
| **Carousel** | `#FBEEEB` | "Made with elah" section, and the fill that hangs into the footer |
| White | `#FFFFFF` | Nav pill, inner panels, secondary buttons, popups |
| **Night** (dark surface) | `#170F10` | Hero stage, dark bento card, video panels |

### On dark surfaces

| Role | Hex |
| --- | --- |
| Heading on dark | `#FBF3F1` |
| Body on dark | `#A8999B` |
| Chip on dark | `#3D3032` |

### Supporting tints

| Hex | Used for |
| --- | --- |
| `#FFFBFA` | Sidebar of the Claude mock (plugin section) |
| `#FFE7E3` | Prompt bubble in the Claude mock |
| `#B59C97` | Dashed threads in the footer |
| `#FF003C59` | Coral at 35%: motion-path lines between keyframes |

### Track colours (timeline language)

Clips are always solid colour blocks with ink labels:

| Track | Hex |
| --- | --- |
| Video / motion (top lane) | `#FF003C` coral |
| Audio / voice / text | `#3DDC97` mint |
| Music / secondary | `#E0A33A` amber |

### MiniTimeline (the dark docked timeline)

| Part | Value |
| --- | --- |
| Body | `linear-gradient(180deg, #2F3349 0%, #14151D 100%)` |
| Ruler | `#262A3D`, ticks `#5B6184`, labels `#9AA3C7` |
| Lanes | `#15161F` |
| Playhead / selection | `#FFFFFF` |

### Carousel showcase cards

The example cards in "Made with elah" use their own palettes, because they depict customer work:
lime `#E4FF1A`, greys `#EEF0EC` / `#E6E8E3`, black `#111111`, slate `#4A4D52`, teal glass
`#0B4655B3`, and white glass (`#FFFFFF1A`, `#FFFFFF2E`, `#0000004D` with backdrop blur). Keep
these **inside the cards only**.

### Rules

- Coral is the only saturated colour on page chrome. Mint and amber appear only as clip colours.
- Never use pure black for text; use ink `#1B1416`.
- Every white or blush surface sitting on blush or white gets the `#F3E2DF` outline.
- Brand logos (Chrome, Google Play, App Store, GitHub) keep their official colours.

---

## 3. Typography

### Families

| Family | CSS variable | Loaded in | Role |
| --- | --- | --- | --- |
| **Geist** | `--font-geist-sans` | `app/layout.tsx` | Everything: headings, body, buttons, UI |
| **Geist Mono** (400/500/600) | `--font-geist-mono` | `app/layout.tsx` | Code-ish labels: `split: word`, `back.out`, pipeline chips |
| Instrument Serif (400) | `--font-lp-serif` | `home/fonts.ts` | Display text inside carousel showcase cards only |
| Fuzzy Bubbles (400) | `--font-lp-hand` | `home/fonts.ts` | MiniTimeline ruler time labels only |

Bricolage Grotesque (`--font-display`) and Inter are loaded globally for other pages. The landing
does **not** use them. Global `h1–h4` rules apply the display face, so landing headings override
it with an `!`-prefixed Geist class.

Each component declares the stacks as local constants:

```ts
const sans = 'font-[family-name:var(--font-geist-sans),system-ui,sans-serif]'
const mono = 'font-[family-name:var(--font-geist-mono),ui-monospace,monospace]'
// Beats the global `:is(h1, h2, h3, h4)` display-font rule.
const headingSans = '!font-[family-name:var(--font-geist-sans),system-ui,sans-serif]'
```

### Scale

| Style | Size / line-height | Weight | Tracking | Colour |
| --- | --- | --- | --- | --- |
| Hero H1 | `34px/38px` → sm `48px/52px` | 600 | `-1.4px` → sm `-2px` | Line 1 ink, line 2 coral |
| Section H2 | `30px/36px` → sm `40px/44px` | 600 | `-1.4px` | Ink, `text-balance` |
| Big stat | `44px` → sm `56px` | 600 | `-2px` | Coral ("0 servers") |
| Card title | `22px` | 600 | `-0.5px` | Ink (dark card: `#FBF3F1`) |
| Footer lead | `20px` | 600 | `-0.5px` | Ink ("Use it on") |
| Lead body | `17px/27px` | 400 | — | Muted, `text-pretty` |
| Wordmark | `17px` | 600 | `-0.6px` | Ink |
| Popup title | `16px/20px` | 600 | `-0.3px` | Ink |
| Card body | `15px/23px` | 400 | — | Muted (dark: `#A8999B`) |
| Button (large) | `15px` | 600 | — | — |
| Button / nav (small) | `14px` | 600 (buttons) / 400 (links) | — | — |
| Mono label | `11–12px` | 400 | — | Muted or `#A8999B` |
| Clip label | `9–11px` | 600 | — | Ink on the clip colour |

Headings use sentence case and short lines, with no trailing punctuation except a full stop on
statement-style H2s ("Everything you need to ship the edit.").

---

## 4. Layout

- **Page container:** `mx-auto w-full max-w-[1440px]`, gutters `px-4 sm:px-8 lg:px-[88px]`.
- **Nav container:** `max-w-[1264px]` (1440 − 2×88), so the pill lines up with section content.
- **Section rhythm:** `py-16` on mobile, `lg:py-[112px]` on desktop. The carousel uses `lg:pt-24`.
- **Heading → content gap:** `gap-12` (bento) / `gap-9` (carousel) / `gap-10–16` (plugin row).
- **Bento:** two rows, each `lg:h-[300px]`, `gap-[16px]`. Each row pairs a fixed `760px` card with
  a flexible `[flex:1_1_0]` card, alternating sides (wide-left, then wide-right). It stacks below `lg`.
- **Breakpoints:** Tailwind defaults. `sm` (640) gets larger type and padding; `lg` (1024) gives
  the multi-column layouts and the full nav.

### Section order and backgrounds

| # | Section | Component | Background |
| --- | --- | --- | --- |
| 1 | Nav pill | `HomeNav` | White pill on blush |
| 2 | Hero + stage | `HomeHero` / `HeroStage` | Blush; stage is night `#170F10` |
| 3 | Bento "Everything you need…" | `HomeBento` | White |
| 4 | Claude plugin | `HomePlugin` | Blush |
| 5 | "Made with elah" carousel | `HomeCarousel` | `#FBEEEB` |
| 6 | Footer | `HomeFooter` | Blush, with the carousel colour hanging into its top edge |

Adjacent sections always change background slightly (blush → white → blush → carousel → blush).
There are no divider lines between them.

---

## 5. Shape

> **Square corners (current).** All radii below are set to 0: buttons, nav, cards, panels, chips, clips,
> tiles and the footer mark are rectangles. Only the footer's curved edge and the engine-drawn
> timeline/video content keep their own shapes. The nesting rule now applies to outlines only.

### Radii

| Radius | Used for |
| --- | --- |
| `rounded-full` | All buttons, nav pill, chips, avatar pills, carousel arrows |
| `24px` | Footer logo mark |
| `20px` | Cards (bento, plugin mock), hero stage top corners (`rounded-t-[20px]`), popups |
| `16px` | MiniTimeline body |
| `14px` | Inner panels inside cards, platform tiles, footage panels |
| `12px` | Carousel cards, small inner panels |
| `10px` | Ease-curve tiles, nested phone/card mocks |
| `7–9px` | Timeline clips, logo in nav (`7px`), lanes (`8px`) |
| `6px` | Ruler, small chips, keyframe rows |
| `1–2px` | Keyframe diamonds, bars |

Nested radii step down: a 20px card holds a 14px panel, which holds 7–9px clips.

### Borders and outlines

Use **outlines, not borders**, so they take up no layout space:

```
[outline:1px_solid_#F3E2DF] [outline-offset:-0.5px]
```

The hero stage is the exception: it uses `border border-b-0 border-[#F3E2DF]`.

### Shadows

Shadows are rare and soft, tinted with ink (`rgba(27,20,22,…)`), and appear only on floating things:

| Shadow | Used for |
| --- | --- |
| `0 18px 50px -12px rgba(27,20,22,0.28)` | Popups (install card) |
| `0 14px 30px -10px rgba(27,20,22,0.45)` | Footer logo mark |
| `0 4px 14px rgba(0,0,0,0.55)` | A clip being dragged on the dark timeline |
| Coral glow (see §8) | MiniTimeline at page end |

Cards sitting in the page flow have **no shadow**, only the outline.

---

## 6. Components

### Buttons

| Variant | Classes (core) | Where |
| --- | --- | --- |
| **Primary** | `rounded-full bg-[#FF003C] text-white font-semibold hover:bg-[#D10030]` | "Start free", "Start building free", "Add elah to Claude", "Install app" |
| **Secondary** | `rounded-full bg-white text-[#1B1416] font-semibold hover:bg-[#FFF5F3]` + outline | "Book a demo", "Request a demo", left carousel arrow |
| **Dark** | `rounded-full bg-[#1B1416] text-white font-semibold hover:bg-[#2E2224]` | "Star us on GitHub", right carousel arrow (`hover:opacity-85`) |
| **Ghost** | `rounded-full bg-transparent text-[#77696B] hover:bg-[#FFF5F3] hover:text-[#1B1416]` | "Not now" |

Sizes:
- **Large:** `px-[26px] py-[14px] text-[15px]` (hero CTAs, with a 16px `ArrowRight` / `Plus` icon at `gap-2`).
- **Small:** `px-4 py-[7px] text-[14px]` (nav, footer).
- **Popup:** `px-4 py-[8px] text-[14px]`.
- **Icon:** `h-11 w-11 rounded-full` with an 18px lucide icon.

Icons come from `lucide-react` (`ArrowRight`, `ArrowLeft`, `Plus`) with `strokeWidth={2}` and
`aria-hidden`.

### Nav

- A white pill (`h-[46px] rounded-full`) with the outline, `pl-5 pr-[7px]`, so the CTA sits snug
  against the right edge.
- Left: a 26px mark plus the "elah" wordmark.
- Centre (`lg+`): links at `gap-[34px]`, muted → ink on hover.
- Right: "Sign in" link, secondary "Book a demo", primary "Start free".

### Cards

- **Light card:** `rounded-[20px] bg-[#FFF5F3] p-[24px] gap-[20px]` + outline.
- **Dark card:** same shape, `bg-[#170F10]`, no outline.
- **Head:** title (22px) over body (15/23) at `gap-[10px]`.
- **Visual:** pinned to the bottom (`flex-1 justify-end`), usually a white 14px inner panel with
  an outline.
- Cards do not carry tags or badges.

### Pipeline chips (mono)

`rounded-[8px] px-[10px] py-[6px] text-[12px] mono`. On dark they use `bg-[#3D3032] text-[#FBF3F1]`.
The final step is coral with white text. Steps are separated by a muted `→`.

### Timeline visuals (the house illustration)

- **Clip:** a solid track colour, 7–9px radius, ink label at 9–11px semibold, 4px gap between clips.
- **Keyframe:** a 7px ink square rotated 45° (`rotate-45 rounded-[1px]`).
- **Playhead:** a 2px line plus a 12×10 downward triangle (`M0 0 L12 0 L6 10 Z`). It is ink on
  light surfaces and white on dark.
- **Ease curves:** sampled from the real function on a 0–100 box, drawn as a 4px coral round-cap
  stroke on a white 10px tile with a mono label underneath.

### Popups / toasts (install card)

- Fixed bottom-right on desktop (`sm:bottom-6 sm:right-6 sm:w-[380px]`); full-width with a 12px
  inset on mobile (respects `safe-area-inset-bottom`). `z-[55]`.
- A white `rounded-[20px] p-5` card with the outline and the popup shadow.
- 40px mark tile (`rounded-[11px]`), title and body, then right-aligned buttons: ghost "Not now"
  and primary action.

### Footer

1. The carousel colour (`#FBEEEB`) hangs from the top edge, bounded by two mirrored cubic curves
   (`M0 1 C 45 1, 62 48, 100 48`) that meet a 116px-wide centre notch.
2. Dashed threads (`#B59C97`, 1.5px, `5 5` dash, non-scaling stroke) trace that edge.
3. The 92px elah mark (`rounded-[24px]`) pops out of the notch.
4. "Use it on" is followed by 52px white platform tiles (`rounded-[14px]`, outline): Chrome,
   Google Play, App Store.
5. The dark "Star us on GitHub" pill has a translucent chip (`bg-white/10`) holding a coral star
   and the live star count from `getSiteStats()`.

---

## 7. Imagery and assets

- Assets are listed in `home/assets.ts` (`IMG[]`).
- The mark is `/landing/elah-mark.png`. It is always rendered as a `background-image` on a
  rounded square (7px at 26px, 11px at 40px, 24px at 92px).
- Showcase photos (`car.jpg`, `coast.jpg`, `swim.jpg`, `editorial.jpg`) appear inside carousel
  cards only, with `object-cover`.
- The hero video (`/landing/hero.mp4`) is cut and exported by elah itself
  (`public/landing/hero/spec.json` → `project.json`). Keep that true if it's replaced.

---

## 8. Motion

| Pattern | Spec |
| --- | --- |
| Colour hovers | `transition-colors`, default duration |
| Entrance pop (footer) | `duration-500–700`, overshoot ease `cubic-bezier(0.2,0.8,0.2,1.2)` (tiles, button) / `cubic-bezier(0.3,1.5,0.5,1)` (logo) |
| Logo pop start state | `-translate-y-6 -rotate-6 scale-50 opacity-0` → rest |
| Tile/button start state | `translate-y-3 scale-90 opacity-0` → rest |
| Stagger | Logo 250ms → tiles `450 + i·90`ms → GitHub button 800ms |
| Line draw | `clip-path: inset(0 100% 0 0)` → `inset(0)` over 700ms |
| Trigger | One `IntersectionObserver` per section (`near` state), `rootMargin: 0px 0px -60px 0px` |
| Timeline glow | Only while scrolled to the very bottom (`html[data-footer-end]`). A coral ring plus an 18–26px glow pulsing over 2.6s. It switches off as soon as the page scrolls up. See `styles/landing.css`. |
| Hero video | Autoplays muted; pauses the moment the page scrolls, resumes at top. Space or click toggles it. |
| Clip drag | Others reflow with `transition-[left] duration-150`. |

When an entrance animation has a delay, put it on a **wrapper** so hover transitions on the
element itself stay instant. Every animation has a `motion-reduce:` fallback (`transition-none`,
`animation: none`).

---

## 9. Interaction and accessibility

- Decorative layers get `aria-hidden="true"` and `pointer-events-none`.
- Real controls are `<button type="button">` or links. External links use
  `target="_blank" rel="noopener noreferrer"`.
- Icon-only buttons and platform tiles carry `aria-label` / `title`.
- Space toggles hero playback only when the hero "owns" it (`heroOwnsSpace`). It never hijacks
  typing or page scrolling elsewhere.
- Text colours keep contrast on their surface: muted `#77696B` on blush or white, `#A8999B` on
  night.

---

## 10. Voice (copy)

- Short, plain, concrete. Say what the product does ("MP4 export runs on the visitor's own machine
  in Chrome or Edge"), not how great it is.
- Feature names are noun phrases: "Easing, springs and stagger", "Exports on your device".
- Don't invent numbers (bundle sizes, speed claims). Don't claim unreleased features, and don't
  say "3D text".
- CTAs are verbs: "Start free", "Start building free", "Add elah to Claude", "Install app",
  "Star us on GitHub".
- The brand name is always lowercase: **elah**.

---

## Checklist for a new section

- [ ] Inside `max-w-[1440px]` with `px-4 sm:px-8 lg:px-[88px]` gutters
- [ ] Background differs from its neighbours (white / blush / `#FBEEEB`)
- [ ] H2 is 30→40px Geist 600, `-1.4px`; body is 17/27 muted
- [ ] Coral is the only accent; surfaces have the `#F3E2DF` outline, no shadow
- [ ] Radii follow the 20 → 14 → 8 nesting
- [ ] Visual is real-looking editor UI, not a stock illustration
- [ ] Entrance motion has a `motion-reduce` fallback; decorative layers are `aria-hidden`
