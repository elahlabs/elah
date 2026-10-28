/**
 * The three starter scenes of the motion playground (brief 6.3): title card,
 * lower third, stat counter. Each is an HTML + CSS scene in the whitelisted
 * subset, motion written with the `data-motion` grammar. `starters.test.ts`
 * runs every one through `validateScene`, so a starter cannot drift into the
 * refused subset.
 */

export interface Starter {
  id: string
  label: string
  durationSeconds: number
  stage: { width: number; height: number }
  fps: number
  html: string
  css: string
}

const STAGE = { width: 1920, height: 1080 }

export const STARTERS: Starter[] = [
  {
    id: 'title-card',
    label: 'Title card',
    durationSeconds: 4,
    stage: STAGE,
    fps: 30,
    html: `<section id="tc" data-scene="title-card" data-at="0" data-duration="4">
  <div id="bar" data-motion="in: slide-in-left 0.5s @0.1"></div>
  <h1 id="title" data-motion="split: word 3f; each: y: 0.5 -> 0 0.5s quad-out; each: opacity: 0 -> 1 0.5s quad-out">Quarterly results</h1>
  <p id="sub" data-motion="in: fade-in 0.6s @0.9">Revenue up 24 percent on the year</p>
</section>`,
    css: `#tc { position: relative; width: 1920px; height: 1080px; background-color: #0d1117; }
#bar { position: absolute; left: 160px; top: 380px; width: 24px; height: 300px; background-color: #00c2ff; border-radius: 12px; }
#title { position: absolute; left: 230px; top: 360px; width: 1500px; margin: 0; font-family: bebas-neue; font-size: 200px; line-height: 1; color: #ffffff; }
#sub { position: absolute; left: 234px; top: 590px; width: 1400px; margin: 0; font-family: inter; font-size: 52px; color: #9ca3af; }`,
  },
  {
    id: 'lower-third',
    label: 'Lower third',
    durationSeconds: 4,
    stage: STAGE,
    fps: 30,
    html: `<section id="lt" data-scene="lower-third" data-at="0" data-duration="4">
  <div id="panel" data-motion="in: slide-in-left 0.5s @0.2; out: fade-out 0.3s @-0.3"></div>
  <h2 id="name" data-motion="in: slide-in-up 0.4s @0.5; out: fade-out 0.3s @-0.3">Ada Lovelace</h2>
  <p id="role" data-motion="in: fade-in 0.4s @0.8; out: fade-out 0.3s @-0.3">Mathematician</p>
</section>`,
    css: `#lt { position: relative; width: 1920px; height: 1080px; background-color: #111827; }
#panel { position: absolute; left: 120px; top: 780px; width: 760px; height: 170px; background-color: #1f2937; border-radius: 16px; }
#name { position: absolute; left: 160px; top: 800px; width: 680px; margin: 0; font-family: oswald; font-size: 72px; line-height: 1; color: #ffffff; }
#role { position: absolute; left: 160px; top: 884px; width: 680px; margin: 0; font-family: inter; font-size: 36px; color: #fbbf24; }`,
  },
  {
    id: 'stat-counter',
    label: 'Stat counter',
    durationSeconds: 4,
    stage: STAGE,
    fps: 30,
    html: `<section id="sc" data-scene="stat-counter" data-at="0" data-duration="4">
  <h1 id="num" data-motion="in: pop-in 0.5s @0.2; scramble: 0 -> 1 1.2s quad-out @0.2">72%</h1>
  <p id="cap" data-motion="in: fade-in 0.5s @1.0">of teams ship motion graphics from code</p>
</section>`,
    css: `#sc { position: relative; width: 1920px; height: 1080px; background-color: #0b1020; }
#num { position: absolute; left: 160px; top: 300px; width: 1600px; margin: 0; font-family: archivo-black; font-size: 360px; line-height: 1; color: #ffffff; text-align: center; }
#cap { position: absolute; left: 160px; top: 700px; width: 1600px; margin: 0; font-family: inter; font-size: 56px; color: #9ca3af; text-align: center; }`,
  },
]
