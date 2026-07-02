/**
 * loadRandomPexels — "Random Load from Pexels" one-click demo project.
 *
 * Picks a random topic from `PEXELS_TOPICS`, pulls a handful of images/videos
 * from our `/api/pexels/*` proxy for that topic's tags, and composes a
 * portrait (9:16) timeline: alternating video/image clips with fade
 * transitions on the video lane, plus topic-relevant captions spread across
 * all 4 elements (text) lanes.
 *
 * Extensibility: each topic also carries `audiotags`, unused today because we
 * don't have a Pexels audio source wired up yet. The project already has a
 * dedicated audio track (see INITIAL_TRACKS in ProductionEditor); once an
 * audio-search API exists, add a `fetchPexelsAudio(tag)` call alongside the
 * video/image fetches below and place the result on `audioTrack` the same way
 * `loadElahDemo` does for its music bed.
 */
import {
  type TimelineEngine,
  type TimelineRef,
  type Transform,
  type MediaAsset,
  usePlaybackStore,
  secondsToFrames,
} from '@elah/editor'
import type { RefObject } from 'react'
import { importPexelsPhoto, importPexelsVideo } from '@/lib/pexels/importPexelsAsset'
import type { PexelsPhoto, PexelsVideo } from '@/lib/pexels/types'

/** Portrait 9:16 stage, matching the cinematic demo. */
const STAGE = { width: 1080, height: 1920 }

/** 400ms transition / fade at the project fps. */
const FADE_MS = 400

/** How many visual clips to place on the video lane, alternating video/image. */
const VISUAL_COUNT = 6

/** Default on-screen length per visual (frames = fps * this), trimmed to source. */
const CLIP_SECONDS = 4

/**
 * A topic pairs Pexels search tags for video/image lookups with caption copy
 * for the 4 text lanes. `audiotags` is reserved — see file header.
 */
interface PexelsTopic {
  videotags: string[]
  imagetags: string[]
  audiotags: string[]
  captions: string[]
}

const PEXELS_TOPICS: Record<string, PexelsTopic> = {
  ocean: {
    videotags: ['ocean waves', 'underwater', 'scuba diving', 'surfing'],
    imagetags: ['ocean', 'coral reef', 'beach sunset', 'sea turtle'],
    audiotags: [],
    captions: ['Dive into the deep.', 'WAVES OF WONDER', 'OCEAN', 'Explore below the surface.', '— BLUE PLANET —', 'SALT AIR'],
  },
  mountains: {
    videotags: ['mountain hiking', 'alps drone', 'snow peak', 'rock climbing'],
    imagetags: ['mountain range', 'summit', 'alpine lake', 'hiking trail'],
    audiotags: [],
    captions: ['Chase the summit.', 'HIGH ALTITUDE', 'PEAKS', 'Where the air runs thin.', '— ABOVE THE CLOUDS —', 'TRAILHEAD'],
  },
  'city-life': {
    videotags: ['city timelapse', 'street traffic', 'downtown night', 'subway'],
    imagetags: ['city skyline', 'urban street', 'neon lights', 'crosswalk'],
    audiotags: [],
    captions: ['The city never sleeps.', 'URBAN PULSE', 'DOWNTOWN', 'Every street has a story.', '— METROPOLIS —', 'RUSH HOUR'],
  },
  forest: {
    videotags: ['forest walk', 'rainforest', 'misty woods', 'waterfall'],
    imagetags: ['forest path', 'sunlight through trees', 'moss', 'redwood'],
    audiotags: [],
    captions: ['Lose yourself in green.', 'DEEP WOODS', 'CANOPY', 'Quiet lives here.', '— OLD GROWTH —', 'UNDERGROWTH'],
  },
  space: {
    videotags: ['galaxy timelapse', 'rocket launch', 'nebula', 'stars night sky'],
    imagetags: ['starry sky', 'milky way', 'planet', 'astronaut'],
    audiotags: [],
    captions: ['Look up.', 'DEEP SPACE', 'COSMOS', 'We are made of stardust.', '— BEYOND EARTH —', 'ORBIT'],
  },
  desert: {
    videotags: ['desert dunes', 'sandstorm', 'desert road', 'camel caravan'],
    imagetags: ['sand dunes', 'desert sunset', 'cactus', 'oasis'],
    audiotags: [],
    captions: ['Silence, for miles.', 'DUNE FIELDS', 'DESERT', 'The heat writes its own rules.', '— OPEN HORIZON —', 'MIRAGE'],
  },
  wildlife: {
    videotags: ['wild animals', 'lion pride', 'birds flying', 'safari'],
    imagetags: ['wildlife portrait', 'elephant herd', 'eagle', 'zebra'],
    audiotags: [],
    captions: ['Nature, unscripted.', 'WILD AT HEART', 'SAFARI', 'Every species has a role.', '— THE WILD —', 'INSTINCT'],
  },
  food: {
    videotags: ['cooking food', 'chef kitchen', 'street food', 'coffee pour'],
    imagetags: ['gourmet dish', 'fresh ingredients', 'bakery', 'coffee cup'],
    audiotags: [],
    captions: ['Made from scratch.', 'FARM TO TABLE', 'FLAVOR', 'Good food, slow down.', '— THE KITCHEN —', 'FRESH DAILY'],
  },
  fitness: {
    videotags: ['gym workout', 'running training', 'yoga flow', 'boxing'],
    imagetags: ['weightlifting', 'yoga pose', 'running shoes', 'stretching'],
    audiotags: [],
    captions: ['Show up anyway.', 'TRAIN HARD', 'DISCIPLINE', 'Strength is built, not born.', '— NO SHORTCUTS —', 'REPS'],
  },
  technology: {
    videotags: ['coding programmer', 'data center', 'robotics', 'circuit board'],
    imagetags: ['laptop code', 'server room', 'microchip', 'workspace desk'],
    audiotags: [],
    captions: ['Built for what\'s next.', 'THE FUTURE, NOW', 'TECH', 'Every line of code counts.', '— SYSTEM ONLINE —', 'v1.0'],
  },
  travel: {
    videotags: ['travel vlog', 'airport departure', 'road trip', 'backpacking'],
    imagetags: ['passport map', 'suitcase', 'airplane window', 'scenic overlook'],
    audiotags: [],
    captions: ['Somewhere, else.', 'WANDERLUST', 'TRAVEL', 'Collect moments, not things.', '— NEXT STOP —', 'ONE WAY'],
  },
  business: {
    videotags: ['office meeting', 'startup team', 'handshake deal', 'presentation'],
    imagetags: ['office workspace', 'business meeting', 'skyscraper', 'whiteboard'],
    audiotags: [],
    captions: ['Ideas into motion.', 'GROWTH MINDSET', 'BUSINESS', 'Built by the team, for the team.', '— NEXT QUARTER —', 'LAUNCH'],
  },
  music: {
    videotags: ['concert crowd', 'musician playing', 'dj set', 'vinyl record'],
    imagetags: ['guitar closeup', 'concert lights', 'headphones', 'studio mixer'],
    audiotags: [],
    captions: ['Feel the drop.', 'LIVE SOUND', 'MUSIC', 'Every beat tells a story.', '— ON STAGE —', 'ENCORE'],
  },
  fashion: {
    videotags: ['fashion runway', 'street style', 'fashion shoot', 'designer studio'],
    imagetags: ['fashion model', 'clothing rack', 'sneakers', 'runway show'],
    audiotags: [],
    captions: ['Wear it your way.', 'NEW COLLECTION', 'STYLE', 'Fashion is a language.', '— RUNWAY —', 'SS26'],
  },
  autumn: {
    videotags: ['autumn leaves', 'fall forest', 'windy trees', 'harvest field'],
    imagetags: ['fall foliage', 'pumpkin patch', 'autumn park', 'maple leaf'],
    audiotags: [],
    captions: ['Everything changes color.', 'FALL SEASON', 'AUTUMN', 'The quiet turn of the year.', '— HARVEST —', 'COZY'],
  },
  'winter-sports': {
    videotags: ['snowboarding', 'ski slope', 'ice skating', 'snowfall'],
    imagetags: ['ski resort', 'snowy mountain', 'ice rink', 'snowboard'],
    audiotags: [],
    captions: ['Chase the powder.', 'WINTER SEASON', 'SNOW', 'Cold air, clear mind.', '— FRESH TRACKS —', 'SUB-ZERO'],
  },
  'coffee-culture': {
    videotags: ['coffee shop', 'barista pour', 'espresso machine', 'roasting beans'],
    imagetags: ['latte art', 'coffee beans', 'cafe interior', 'coffee cup steam'],
    audiotags: [],
    captions: ['One cup at a time.', 'THIRD WAVE', 'COFFEE', 'Slow mornings, strong brew.', '— ROASTED FRESH —', 'ESPRESSO'],
  },
  'startup-hustle': {
    videotags: ['startup office', 'coding team', 'brainstorm session', 'pitch meeting'],
    imagetags: ['whiteboard sketch', 'open workspace', 'laptop coffee', 'sticky notes'],
    audiotags: [],
    captions: ['Ship it anyway.', 'MOVE FAST', 'STARTUP', 'Built at 2am, shipped at 9.', '— DAY ONE —', 'ITERATE'],
  },
}

type Place =
  | 'center'
  | 'top-center'
  | 'top-left'
  | 'top-right'
  | 'bottom-center'
  | 'bottom-left'
  | 'bottom-right'

const PLACEMENT: Record<Place, { x: number; y: number; align: 'left' | 'center' | 'right' }> = {
  center: { x: 0.5, y: 0.5, align: 'center' },
  'top-center': { x: 0.5, y: 0.16, align: 'center' },
  'top-left': { x: 0.24, y: 0.16, align: 'left' },
  'top-right': { x: 0.76, y: 0.16, align: 'right' },
  'bottom-center': { x: 0.5, y: 0.84, align: 'center' },
  'bottom-left': { x: 0.24, y: 0.82, align: 'left' },
  'bottom-right': { x: 0.76, y: 0.82, align: 'right' },
}

const PLACE_CYCLE: Place[] = [
  'bottom-center',
  'top-center',
  'center',
  'bottom-left',
  'top-right',
  'bottom-right',
]

function makeTransform(x: number, y: number): Transform {
  return { x, y, scale: 1, rotation: 0, anchor: { x: 0.5, y: 0.5 } }
}

function pickRandom<T>(items: T[]): T | undefined {
  if (items.length === 0) return undefined
  return items[Math.floor(Math.random() * items.length)]
}

function pickTopic(): [string, PexelsTopic] {
  const keys = Object.keys(PEXELS_TOPICS)
  const key = keys[Math.floor(Math.random() * keys.length)]
  return [key, PEXELS_TOPICS[key]]
}

async function fetchPexels<T extends 'photos' | 'videos'>(
  kind: T,
  query: string,
  page: number,
): Promise<T extends 'photos' ? PexelsPhoto[] : PexelsVideo[]> {
  const url = `/api/pexels/${kind}?query=${encodeURIComponent(query)}&page=${page}&per_page=15`
  const res = await fetch(url)
  if (!res.ok) return [] as never
  const data = await res.json()
  return (kind === 'photos' ? data.photos : data.videos) ?? []
}

async function fetchRandomVideo(topic: PexelsTopic): Promise<PexelsVideo | undefined> {
  const tag = pickRandom(topic.videotags)
  if (!tag) return undefined
  const page = 1 + Math.floor(Math.random() * 3)
  const results = await fetchPexels('videos', tag, page)
  return pickRandom(results)
}

async function fetchRandomImage(topic: PexelsTopic): Promise<PexelsPhoto | undefined> {
  const tag = pickRandom(topic.imagetags)
  if (!tag) return undefined
  const page = 1 + Math.floor(Math.random() * 3)
  const results = await fetchPexels('photos', tag, page)
  return pickRandom(results)
}

export interface LoadRandomPexelsDeps {
  engine: TimelineEngine
  timelineRef: RefObject<TimelineRef | null>
}

/**
 * Build a random-topic Pexels project: fetches alternating video/image clips
 * for a random topic, lays them on the video lane with fade transitions, and
 * spreads that topic's captions across all 4 elements (text) lanes.
 */
export async function loadRandomPexels({ engine, timelineRef }: LoadRandomPexelsDeps): Promise<string> {
  const [topicName, topic] = pickTopic()

  // Alternate video/image so the edit doesn't clump by kind.
  const fetched: { kind: 'video' | 'image'; asset: MediaAsset }[] = []
  for (let i = 0; i < VISUAL_COUNT; i++) {
    const wantVideo = i % 2 === 0
    const item = wantVideo ? await fetchRandomVideo(topic) : await fetchRandomImage(topic)
    if (!item) continue
    const asset = wantVideo ? importPexelsVideo(item as PexelsVideo) : importPexelsPhoto(item as PexelsPhoto)
    fetched.push({ kind: wantVideo ? 'video' : 'image', asset })
  }

  if (fetched.length === 0) {
    throw new Error(`No Pexels results for topic "${topicName}" — try again.`)
  }

  const fps = engine.getProject().fps
  const fadeFrames = Math.max(2, secondsToFrames(FADE_MS / 1000, fps))
  const desiredFrames = Math.round(fps * CLIP_SECONDS)

  const project = engine.getProject()
  const videoTrack = project.tracks.find((t) => t.kind === 'video')
  const elementsTracks = project.tracks.filter((t) => t.kind === 'elements')
  // Reserved for future audio support (see file header) — resolved but unused today.
  const audioTrack = project.tracks.find((t) => t.kind === 'audio')
  void audioTrack
  if (!videoTrack || elementsTracks.length === 0) {
    throw new Error('Expected a video track and at least one elements track on the project')
  }

  engine.batch(() => {
    engine.setStage(STAGE.width, STAGE.height)

    // --- VIDEO LANE: alternating video/image clips --------------------------
    let cursor = 0
    const videoClipIds: string[] = []
    const placedClips: [number, number][] = []
    for (const item of fetched) {
      const sourceFrames =
        item.asset.durationSec > 0 ? Math.max(1, secondsToFrames(item.asset.durationSec, fps)) : desiredFrames
      const duration = Math.min(desiredFrames, sourceFrames)
      const clip = engine.addClip({
        trackId: videoTrack.id,
        type: item.kind,
        name: item.asset.name,
        startFrame: cursor,
        durationFrames: duration,
        src: item.asset.src,
        assetId: item.asset.id,
      })
      videoClipIds.push(clip.id)
      placedClips.push([cursor, duration])
      cursor += duration
    }

    // --- Fade transitions between every adjacent visual ----------------------
    for (let i = 0; i < videoClipIds.length - 1; i++) {
      engine.addTransition({
        fromClipId: videoClipIds[i],
        toClipId: videoClipIds[i + 1],
        trackId: videoTrack.id,
        kind: 'fade',
        durationFrames: fadeFrames,
        easing: 'ease-out',
      })
    }

    // --- TEXT LANES: topic captions spread across all elements tracks -------
    const addText = (content: string, clip: [number, number], place: Place, trackId: string, fontSize: number) => {
      const [clipStart, clipDuration] = clip
      const pad = Math.round(fps * 0.3)
      const start = clipStart + pad
      const duration = Math.max(fadeFrames * 2 + 1, clipDuration - pad * 2)
      const { x, y, align } = PLACEMENT[place]
      const created = engine.addClip({
        trackId,
        type: 'text',
        name: content,
        startFrame: start,
        durationFrames: duration,
        opacity: 0.88,
        transform: makeTransform(x, y),
        text: {
          content,
          fontSize,
          color: '#ffffff',
          fontFamily: 'sans-serif',
          fontWeight: 'bold',
          textAlign: align,
        },
      })
      engine.updateClip(created.id, trackId, {
        textAnimation: { in: 'fade', out: 'fade', durationFrames: fadeFrames },
      })
    }

    topic.captions.forEach((caption, i) => {
      const clip = placedClips[i % placedClips.length]
      const track = elementsTracks[i % elementsTracks.length]
      const place = PLACE_CYCLE[i % PLACE_CYCLE.length]
      const fontSize = i === 0 ? 76 : 44 + (i % 3) * 8
      addText(caption, clip, place, track.id, fontSize)
    })
  }, `Random load from Pexels — ${topicName}`)

  // --- Post-load: clean playback state -------------------------------------
  const playback = usePlaybackStore.getState()
  playback.pause()
  playback.setCurrentFrame(0)
  requestAnimationFrame(() => timelineRef.current?.fitToWindow())

  return topicName
}

export const PEXELS_TOPIC_NAMES = Object.keys(PEXELS_TOPICS)
