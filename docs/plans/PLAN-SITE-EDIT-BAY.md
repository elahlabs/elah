# Plan: the whole site in the "edit bay" look

Extend the homepage redesign (PR #91, `components/landing/home/DESIGN.md` §0) to every other
page on elah.dev, with one site-wide light/dark toggle. Executed in phases by Sonnet subagents;
the orchestrating session reviews each phase before the next starts.

## Scope

**In:** `/docs/*` (24 pages + layout), `/claude`, `/motion`, `/changelog`, `/blog`, `/blog/[slug]`,
`/examples`, `/showcase`, `/pricing`, `/playgrounds` (the index page only), `not-found`, `/offline`,
and the shared chrome they use (`SiteNav`, `SiteFooter`, `PageHeader`, `Logo`, docs sidebar/TOC/
mobile nav/code blocks).

**Out (user decision, 2026-10-27):** `/playground/*`, `/editor`, and the embedded `@elah/editor`
UI. Do not touch `app/playground/**`, `app/editor/**`, `components/playground/**`, or the
`.elah-root` / `--elah-*` block in `styles/globals.css`. They keep today's look for now.

**Branch:** `site-edit-bay`, cut from `landing-edit-bay`. A stacked PR that depends on #91.

## What makes this tractable

Every in-scope page already reads colour from one token set, `--color-*` in
`styles/globals.css` (`:root` = light, `.dark` = dark), through Tailwind names (`bg-surface`,
`text-on-surface`, `border-outline-variant`, `text-primary`, ...). They share one nav
(`components/site/SiteNav.tsx`; `components/marketing/Navbar.tsx` is a 9-line wrapper), one
footer (`SiteFooter`; `marketing/Footer` wraps it) and one header (`PageHeader`, 28 users).
So most of the look changes at the token and shared-component level, and the page sweeps are
mechanical clean-up: about 330 `rounded-*` uses and ~20 raw hex values.

## Architecture (the modular part)

One design-system module that the homepage and every other page import from:

```
apps/web/components/eb/            "edit bay" design system (new)
  tokens.ts        class vocabulary: sans, mono, display, label, h1/h2, lead, card, chip,
                   outline, container; buttons (primary, secondary, onStage*). Reads only
                   --color-* tokens (no raw hex except cyber red and on-stage literals).
  Sel.tsx          selected-word emphasis          (moved from landing/home)
  CropMarks.tsx    viewfinder crop marks            (split out of Sel.tsx)
  Slate.tsx        "SC 03 · BIND" strip + kicker    (extracted from landing Section)
  Button.tsx       <ButtonLink>/<Button> wrappers over the button classes
  Card.tsx         hairline card with optional header strip
  ThemeToggle.tsx  site-wide toggle                 (moved, rewritten for <html>)
  bottomBar.ts     consent/install bar styles       (moved from components/)
  index.ts         barrel
```

Rules: `components/eb` imports nothing from `landing/` or `site/`; `landing/home/*` and
`site/*` import from `components/eb`. `landing/home/ui.ts` becomes a thin re-export (or is
deleted once nothing imports it).

### Tokens: one palette, two themes

Today there are two palettes: the site's `--color-*` (cool blue/cyan) and the homepage's
`--lp-*` (paper/ink/red). Make `--color-*` *the* palette and alias `--lp-*` to it.

| `--color-*` | Light | Dark |
| --- | --- | --- |
| `surface` | `#F0EFEA` | `#0C0C0E` |
| `surface-low` / `surface-container` | `#F7F6F2` / `#E8E6E0` | `#121215` / `#18181B` |
| `surface-high` / `surface-highest` | `#E8E6E0` / `#DEDCD5` | `#1E1E22` / `#26262B` |
| `on-surface` | `#0E0E10` | `#EDECE7` |
| `on-surface-variant` | `#5E5D58` | `#9C9B95` |
| `outline` / `outline-variant` / `outline-subtle` | `#9A9993` / `#D9D7D0` / `#E4E2DC` | `#3A3A40` / `#2A2A2F` / `#1E1E22` |
| `primary` / `primary-hover` | `#FF003C` / `#D10030` | `#FF003C` / `#FF335F` |
| `on-primary` | `#0E0E10` | `#0E0E10` |

`primary` is cyber red. **It must not be used as body-text colour** (3.4:1 on light paper). The
docs use `text-primary` for links: Phase 3 moves link text to `on-surface` with a red underline.

### Theme: one switch for the site

- `<html class="dark">` stays the mechanism (Tailwind `darkMode: 'class'` already uses it).
- `app/layout.tsx`'s `themeInitScript` reads `localStorage['elah-theme']`, falls back to
  `prefers-color-scheme`, and sets or removes `dark` before first paint. Migrate the
  homepage's `elah-lp-theme` key once.
- `components/ThemeProvider.tsx` becomes real (state, toggle, follow the system until the user picks).
  `useTheme()` consumers (`MermaidDiagram`) keep working.
- The homepage drops `.lp[data-theme]` and its own init script; `.lp` keeps only fonts.
- `/playground/*` and `/editor` render inside `.elah-root`, whose `--elah-*` tokens are
  fixed, so they are unaffected by the toggle.

### Type and shape

- Big Shoulders moves from `landing/home/fonts.ts` into `app/layout.tsx` as
  `--font-display` (replacing Bricolage), so the global `:is(h1,h2,h3,h4)` rule picks it up.
  Display headings are uppercase only where the eb `display` class is applied (PageHeader,
  section titles), not every docs `h3`.
- Square corners: `apps/web/tailwind.config.ts` sets `borderRadius` `none`..`3xl` to `0`
  (keeps `full` for true circles: status dots, avatars). Packages compile their own CSS, so the
  editor is unaffected. Arbitrary `rounded-[Npx]` is removed in the page sweeps.

## Phases

Each phase is one or more Sonnet subagents with disjoint file ownership. Agents run
`npx tsc --noEmit` (apps/web) and `npx vitest run` for their files. **Only the orchestrator runs
`next build` or the dev server** (they share `.next`). The orchestrator reviews the diff and
screenshots before starting the next phase.

### Phase 1: foundation (1 agent, sequential)

Owns `styles/globals.css` (`:root` and `.dark` `--color-*` blocks only), `styles/landing.css`,
`tailwind.config.ts`, `app/layout.tsx`, `components/ThemeProvider.tsx`, `components/eb/**`,
`components/landing/home/{ui.ts,Sel.tsx,ThemeToggle.tsx,fonts.ts}`, `components/bottomBar.ts`,
and import updates in `landing/home/*`, `ConsentBanner.tsx`, `InstallBanner.tsx`, `app/page.tsx`.

1. Create `components/eb/` as above; move code in, then update every import.
2. Retheme the `--color-*` tokens; alias `--lp-*` to them.
3. Site-wide theme: init script, ThemeProvider, ThemeToggle, key migration.
4. Fonts and radius config.

**Done when:** the homepage looks identical to PR #91 in both themes (screenshot diff by eye),
the toggle switches every page, and typecheck and tests pass.

### Phase 2: shared chrome (2 agents, parallel)

- **2a nav and footer:** rewrite `site/SiteNav.tsx` (both `pill` and `bar` variants) as the
  hairline-cell nav, sharing one implementation with `landing/home/HomeNav.tsx` (HomeNav
  becomes `SiteNav variant="cells"` or vice versa). The version pill, Discord, mobile menu and
  ThemeToggle stay. Rewrite `site/SiteFooter.tsx` to share `HomeFooter`'s structure (the
  homepage keeps the giant wordmark through a prop). Make `site/Logo.tsx` red (`#FF003C` mask
  on ink tile). Owns `components/site/{SiteNav,SiteFooter,Logo}.tsx`,
  `components/marketing/{Navbar,Footer,VersionBadge}.tsx`, `landing/home/{HomeNav,HomeFooter}.tsx`.
- **2b page header and docs chrome:** `site/PageHeader.tsx` gets a slate strip (eyebrow becomes
  `SC`-style label), display headline, optional `<Sel>` word, and hairline rule. `docs` variant
  is smaller. Restyle `components/docs/{DocsSidebar,DocsToc,DocsMobileNav,CodeBlock,MermaidDiagram}.tsx`
  and `app/docs/layout.tsx`: mono uppercase section labels, active item marked with a red
  left bar, code blocks as hairline panels with a header strip, Mermaid colours from tokens.

**Done when:** `/docs/getting-started`, `/claude`, `/changelog` look right in both themes at
1440 and 390 px; nothing else changed.

### Phase 3: page sweeps (3 agents, parallel)

The mechanical pass. For each owned file: remove `rounded-*` and arbitrary radii; replace raw
hex with tokens; `text-primary` used as link text becomes `text-on-surface underline
decoration-primary`; card containers use eb `Card`; buttons use eb `Button`; eyebrow/labels use
eb `label`. Do not change copy.

- **3a docs A–M:** `app/docs/{page,agents,analytics,api,architecture,cli,clips,editor,export,frame-sequences,getting-started,installation,motion}/page.tsx`
- **3b docs N–Z:** `app/docs/{plugins,project-documents,react,scenes,text-templates-and-motion,theming,timeline}/page.tsx` plus `components/docs/*` content helpers not owned by 2b
- **3c marketing:** `app/{claude,motion,changelog,blog,blog/[slug],examples,showcase,pricing,playgrounds,offline}/page.tsx`, `app/not-found.tsx`, `components/marketing/PlaygroundCard.tsx`, `components/landing/{ShowcaseCard,CopyButton,DiscordIcon}.tsx`. `/claude` and `/motion` should reuse homepage section patterns (Slate, Sel, hairline cards) where they fit.

**Done when:** no `rounded-` (except `rounded-full` on dots/avatars) and no raw hex remain in
owned files, and every page reads correctly in both themes.

### Phase 4: dead code (1 agent)

Remove `components/landing/{LandingNav,LandingFooter,ShowcaseTeaser,CardHeader}.tsx`, unused
`components/landing/motion/*`, and `landing/home/ui.ts` if nothing imports them. Verify with a
grep and typecheck before deleting each one.

### Phase 5: QA and docs (orchestrator)

- `npm run typecheck`, `npm run test`, `npm run lint:tokens`, `next build`.
- A headless-Chrome script screenshots every in-scope route at 1440 and 390 in light and dark
  (about 80 shots), fails on page errors, and checks text contrast of `on-surface-variant` on
  `surface` in both themes.
- Rewrite `DESIGN.md` §0 as the site-wide system (homepage specifics move to a subsection) and
  update `docs/design-tokens.md` for the new `--color-*` values.
- Push `site-edit-bay`, open the stacked PR.

## Agent brief template

Every subagent gets: this plan's path, its phase and **exact file list (may edit nothing
else)**, `components/landing/home/DESIGN.md` §0, the rules below, and the done-when check.

Rules:
1. Colours only via `--color-*` Tailwind names or eb tokens. Literal hex only for cyber red
   `#FF003C`, ink on red `#0E0E10`, and on-stage literals, and only inside `components/eb`.
2. Square corners; hairlines over shadows; mono uppercase for UI labels; display face for headlines.
3. Never change copy, routes, links, analytics calls or behaviour unless the brief says so.
4. Do not run `next build` or `next dev`, commit, or push.
5. Report: files changed, anything skipped and why, typecheck and test result.

## Risks

- **Token retheme leaks into the playground.** Its chrome reads `--color-*`. That's acceptable
  per scope (it only recolours); verify `/playground/production` still renders.
- **Docs `h3` in condensed uppercase reads poorly.** Mitigation: the global heading rule uses
  `--font-display` but uppercase applies only via the eb `display` class.
- **`text-primary` links.** Red text fails contrast on light paper, so Phase 3 must convert
  every link.
- **Stacked PR mechanics.** `landing-edit-bay` lives on the fork, and an elahlabs PR can't use a
  fork branch as its base. Open against `dev` with "depends on #91" until #91 merges.
