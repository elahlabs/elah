# Third-party notices

The craft files under `reference/` (`director.md`, `page.md`, `page/`, `components.md`, `themes.md`, `craft/`, `formats/`, `taste/`) are Elah's own
guidance. They were written for the Elah VideoSpec vocabulary and engine lint thresholds, drawing on the open-source motion-design
guidance below and on Elah's own premium creator playbooks (published here by the Elah project). Each external source was
**adapted and rewritten** in our own words; short numeric rules (durations, ratios, stagger steps) are facts and appear with our own
framing. No code, tables or prose were copied verbatim. Licences were read on 2026-10-24.

| Source | Licence | What we drew on | Where it shows |
| --- | --- | --- | --- |
| HeyGen HyperFrames, https://github.com/heygen-com/hyperframes (licence: https://raw.githubusercontent.com/heygen-com/hyperframes/main/LICENSE, "Copyright 2026 HeyGen, Inc.") | Apache-2.0 | motion, story, review and launch / explainer / data / vertical guidance: exit-shorter-than-entrance, overlap and stagger ranges, reading hold (0.5 s + 0.3 s per word), launch beat proportions, one-idea explainers, direct chart labels, vertical safe zones, review ranking; for the HTML page route (`skills/hyperframes/references/motion.md`, `story.md`, `types/launch.md`, read 2026-10-24): easing by role, spring damping bands, entrance variety, hold before a payoff, transition causes, end-card hold, generated-film tells, restated as CSS `cubic-bezier()` values, delays and scene rules | `craft/motion.md`, `craft/review.md`, `formats/*.md`, `page.md`, `page/motion.md` |
| LottieFiles motion-design-skill, https://github.com/lottiefiles/motion-design-skill (licence: https://raw.githubusercontent.com/lottiefiles/motion-design-skill/main/LICENSE, "Copyright (c) 2025 LottieFiles") | MIT | duration and easing by role, stagger budgets, quality checklist structure | `craft/motion.md`, `craft/review.md` |
| iart-ai motion-design-skills, https://github.com/iart-ai/motion-design-skills (licence: https://raw.githubusercontent.com/iart-ai/motion-design-skills/main/LICENSE, "Copyright (c) 2026 iart.ai") | MIT | motion personalities and hierarchy, restraint rules, one-wow-moment, shot-composition (thirds, negative space, travel limit, 9:16 safe areas) | `craft/motion.md`, `craft/type-and-layout.md`, `taste/*.md` |
| Anthropic skills, theme-factory, https://github.com/anthropics/skills/tree/main/skills/theme-factory (licence: https://raw.githubusercontent.com/anthropics/skills/main/skills/theme-factory/LICENSE.txt) | Apache-2.0 | the idea of named mood palettes (ocean, sunset, forest, golden hour, arctic, rose, midnight, minimalist, tech); the colour values and font choices are our own and use only Elah's twelve bundled fonts | `themes.md` |
| Leonxlnx taste-skill, https://github.com/Leonxlnx/taste-skill (licence: https://raw.githubusercontent.com/Leonxlnx/taste-skill/main/LICENSE, "Copyright (c) 2026 Leonxlnx") | MIT | the "no cheap defaults" floor and four taste packs (dark glass, editorial, brutalist, minimal), through Elah's premium editor playbooks which were already adapted from it for video | `taste/*.md` |

MIT notice (applies to LottieFiles, iart.ai and Leonxlnx material): permission is granted, free of charge, to use, copy, modify and
distribute the software and associated documentation, subject to the copyright notice and this permission notice being included in
all copies or substantial portions; the software is provided "as is", without warranty of any kind. The full licence text is at each
source's URL above.

Apache-2.0 notice (applies to HeyGen HyperFrames and Anthropic theme-factory): licensed under the Apache License, Version 2.0
(https://www.apache.org/licenses/LICENSE-2.0). The material was changed: it was rewritten for Elah. Unless required by applicable law
or agreed to in writing, the licensed material is distributed "as is", without warranties or conditions of any kind.

## Not used

Skill sets for other video frameworks that carry no licence were deliberately not used, and nothing from them appears in these files
(the plugin names no framework API and copies none of their text).
The Elah plugin is an unofficial plugin and is not endorsed by any of the projects above or by Anthropic.

## Bundled in `assets/artifact/`

The twelve bundled fonts ship with their SIL Open Font Licence texts in `assets/artifact/fonts/<family>/OFL.txt`.
