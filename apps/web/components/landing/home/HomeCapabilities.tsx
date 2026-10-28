import type { DemoName } from '@/lib/demos/load'
import { LazyDemo } from '@/components/home/LazyDemo'
import { Section } from './Section'
import { Sel, cardBody, cardTitle, cardWhite, mono, outline } from '@/components/eb'

interface Tile {
  demo: DemoName
  title: string
  text: string
  /** One line of code: the line the tile's own spec uses. */
  code: string
}

const tiles: Tile[] = [
  { demo: 'easing', title: 'Easing and springs', text: 'Named eases including back, elastic and bounce, any cubic-bezier, and springs.', code: `{ channel: 'x', at: 1.4, value: 0.85, curve: 'back-out' }` },
  { demo: 'stagger', title: 'Stagger', text: 'From the start, centre, end or edges, at random, or across a grid.', code: `stagger: children 4f` },
  { demo: 'text', title: 'Text animators', text: 'Animate by character, word or line, or scramble text into place.', code: `reveal: { preset: 'char-rise', stagger: 0.04 }` },
  { demo: 'path', title: 'Motion paths and draw-on', text: 'A clip travels an SVG path, and strokes draw on. Path morph is keyable too.', code: `motionPath: { d: 'M 80 270 C 200 40, 440 40, 560 270' }` },
  { demo: 'expressions', title: 'Expressions', text: 'Drive a channel with wiggle, loop, sin and more.', code: `{ channel: 'y', source: 'wiggle(3, 0.06)' }` },
  { demo: 'tilt', title: '3D tilt for media and groups', text: 'rotateX and rotateY with perspective, on video, image, sequence and compound clips.', code: `channels: { rotateY: { keys: [{ frame: 45, value: 0.6 }] } }` },
  { demo: 'effects', title: 'Effects and transitions', text: 'GPU effects and nine transitions, between clips of one track.', code: `effects: [{ kind: 'glow' }]  // + a zoom transition` },
]

/** Motion capabilities grid (brief section 5, item 5). Each tile is a 3 s loop rendered by the engine. */
export function HomeCapabilities() {
  return (
    <Section n={3} scene="Keys" kicker="Seven loops, rendered live" id="capabilities" title={<>Everything is a <Sel>key</Sel> you can read.</>} intro="Each loop below is rendered by the engine, not recorded. New in 1.0.">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {tiles.map((t) => (
          <article key={t.demo} className={`${cardWhite} min-w-0 !p-5`}>
            <div className="overflow-hidden ">
              <LazyDemo name={t.demo} timeline={false} showKeys={false} label={`${t.title} demo`} minHeight={160} />
            </div>
            <div className="flex flex-col gap-[10px]">
              <h3 className={cardTitle}>{t.title}</h3>
              <p className={cardBody}>{t.text}</p>
            </div>
            <code className={`mt-auto block overflow-x-auto whitespace-nowrap bg-[var(--lp-paper)] px-3 py-2 text-[12px] text-[var(--lp-ink)] ${mono} ${outline}`}>{t.code}</code>
          </article>
        ))}
      </div>
    </Section>
  )
}
