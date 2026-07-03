/**
 * loadRandomPixabay — "Random Load from Pixabay" one-click demo project.
 *
 * Picks a random topic from `PIXABAY_TOPICS`, pulls a handful of images/videos
 * from our `/api/pixabay/*` proxy for that topic's tags, and composes a
 * timeline at the project's current stage aspect ratio: alternating
 * video/image clips with fade transitions on the video lane, and
 * topic-relevant captions spread across all 4 elements (text) lanes.
 */
import {
  type TimelineEngine,
  type TimelineRef,
  type Transform,
  type MediaAsset,
  usePlaybackStore,
  secondsToFrames,
  transformFromCoverRect,
} from '@elah/editor'
import type { RefObject } from 'react'
import { importPixabayPhoto, importPixabayVideo } from '@/lib/pixabay/importPixabayAsset'
import type { PixabayPhoto, PixabayVideo } from '@/lib/pixabay/types'

/** 400ms transition / fade at the project fps. */
const FADE_MS = 400

/** How many visual clips to place on the video lane, alternating video/image. */
const VISUAL_COUNT = 6

/** Default on-screen length per visual (frames = fps * this), trimmed to source. */
const CLIP_SECONDS = 4

/**
 * A topic pairs Pixabay search tags for video/image lookups with caption copy
 * for the 4 text lanes.
 */
export interface PixabayTopic {
  videotags: string[]
  imagetags: string[]
  captions: string[]
  /** Freesound search term for a topic-matched ambient/background track. */
  musicQuery: string
}

const PIXABAY_TOPICS: Record<string, PixabayTopic> = {
  ocean: {
    videotags: ['ocean waves', 'underwater', 'scuba diving', 'surfing'],
    imagetags: ['ocean', 'coral reef', 'beach sunset', 'sea turtle'],
    captions: ['Dive into the deep.', 'WAVES OF WONDER', 'OCEAN', 'Explore below the surface.', '— BLUE PLANET —', 'SALT AIR'],
    musicQuery: 'ocean ambient',
  },
  mountains: {
    videotags: ['mountain hiking', 'alps drone', 'snow peak', 'rock climbing'],
    imagetags: ['mountain range', 'summit', 'alpine lake', 'hiking trail'],
    captions: ['Chase the summit.', 'HIGH ALTITUDE', 'PEAKS', 'Where the air runs thin.', '— ABOVE THE CLOUDS —', 'TRAILHEAD'],
    musicQuery: 'cinematic ambient wind',
  },
  'city-life': {
    videotags: ['city timelapse', 'street traffic', 'downtown night', 'subway'],
    imagetags: ['city skyline', 'urban street', 'neon lights', 'crosswalk'],
    captions: ['The city never sleeps.', 'URBAN PULSE', 'DOWNTOWN', 'Every street has a story.', '— METROPOLIS —', 'RUSH HOUR'],
    musicQuery: 'urban lofi beat',
  },
  forest: {
    videotags: ['forest walk', 'rainforest', 'misty woods', 'waterfall'],
    imagetags: ['forest path', 'sunlight through trees', 'moss', 'redwood'],
    captions: ['Lose yourself in green.', 'DEEP WOODS', 'CANOPY', 'Quiet lives here.', '— OLD GROWTH —', 'UNDERGROWTH'],
    musicQuery: 'forest ambient birds',
  },
  space: {
    videotags: ['galaxy timelapse', 'rocket launch', 'nebula', 'stars night sky'],
    imagetags: ['starry sky', 'milky way', 'planet', 'astronaut'],
    captions: ['Look up.', 'DEEP SPACE', 'COSMOS', 'We are made of stardust.', '— BEYOND EARTH —', 'ORBIT'],
    musicQuery: 'space ambient drone',
  },
  desert: {
    videotags: ['desert dunes', 'sandstorm', 'desert road', 'camel caravan'],
    imagetags: ['sand dunes', 'desert sunset', 'cactus', 'oasis'],
    captions: ['Silence, for miles.', 'DUNE FIELDS', 'DESERT', 'The heat writes its own rules.', '— OPEN HORIZON —', 'MIRAGE'],
    musicQuery: 'desert ambient drone',
  },
  wildlife: {
    videotags: ['wild animals', 'lion pride', 'birds flying', 'safari'],
    imagetags: ['wildlife portrait', 'elephant herd', 'eagle', 'zebra'],
    captions: ['Nature, unscripted.', 'WILD AT HEART', 'SAFARI', 'Every species has a role.', '— THE WILD —', 'INSTINCT'],
    musicQuery: 'african tribal ambient',
  },
  food: {
    videotags: ['cooking food', 'chef kitchen', 'street food', 'coffee pour'],
    imagetags: ['gourmet dish', 'fresh ingredients', 'bakery', 'coffee cup'],
    captions: ['Made from scratch.', 'FARM TO TABLE', 'FLAVOR', 'Good food, slow down.', '— THE KITCHEN —', 'FRESH DAILY'],
    musicQuery: 'kitchen lofi chill',
  },
  fitness: {
    videotags: ['gym workout', 'running training', 'yoga flow', 'boxing'],
    imagetags: ['weightlifting', 'yoga pose', 'running shoes', 'stretching'],
    captions: ['Show up anyway.', 'TRAIN HARD', 'DISCIPLINE', 'Strength is built, not born.', '— NO SHORTCUTS —', 'REPS'],
    musicQuery: 'energetic workout beat',
  },
  technology: {
    videotags: ['coding programmer', 'data center', 'robotics', 'circuit board'],
    imagetags: ['laptop code', 'server room', 'microchip', 'workspace desk'],
    captions: ['Built for what\'s next.', 'THE FUTURE, NOW', 'TECH', 'Every line of code counts.', '— SYSTEM ONLINE —', 'v1.0'],
    musicQuery: 'tech corporate ambient',
  },
  travel: {
    videotags: ['travel vlog', 'airport departure', 'road trip', 'backpacking'],
    imagetags: ['passport map', 'suitcase', 'airplane window', 'scenic overlook'],
    captions: ['Somewhere, else.', 'WANDERLUST', 'TRAVEL', 'Collect moments, not things.', '— NEXT STOP —', 'ONE WAY'],
    musicQuery: 'travel upbeat acoustic',
  },
  business: {
    videotags: ['office meeting', 'startup team', 'handshake deal', 'presentation'],
    imagetags: ['office workspace', 'business meeting', 'skyscraper', 'whiteboard'],
    captions: ['Ideas into motion.', 'GROWTH MINDSET', 'BUSINESS', 'Built by the team, for the team.', '— NEXT QUARTER —', 'LAUNCH'],
    musicQuery: 'corporate motivational ambient',
  },
  music: {
    videotags: ['concert crowd', 'musician playing', 'dj set', 'vinyl record'],
    imagetags: ['guitar closeup', 'concert lights', 'headphones', 'studio mixer'],
    captions: ['Feel the drop.', 'LIVE SOUND', 'MUSIC', 'Every beat tells a story.', '— ON STAGE —', 'ENCORE'],
    musicQuery: 'electronic beat energetic',
  },
  fashion: {
    videotags: ['fashion runway', 'street style', 'fashion shoot', 'designer studio'],
    imagetags: ['fashion model', 'clothing rack', 'sneakers', 'runway show'],
    captions: ['Wear it your way.', 'NEW COLLECTION', 'STYLE', 'Fashion is a language.', '— RUNWAY —', 'SS26'],
    musicQuery: 'runway electronic stylish',
  },
  autumn: {
    videotags: ['autumn leaves', 'fall forest', 'windy trees', 'harvest field'],
    imagetags: ['fall foliage', 'pumpkin patch', 'autumn park', 'maple leaf'],
    captions: ['Everything changes color.', 'FALL SEASON', 'AUTUMN', 'The quiet turn of the year.', '— HARVEST —', 'COZY'],
    musicQuery: 'autumn acoustic ambient',
  },
  'winter-sports': {
    videotags: ['snowboarding', 'ski slope', 'ice skating', 'snowfall'],
    imagetags: ['ski resort', 'snowy mountain', 'ice rink', 'snowboard'],
    captions: ['Chase the powder.', 'WINTER SEASON', 'SNOW', 'Cold air, clear mind.', '— FRESH TRACKS —', 'SUB-ZERO'],
    musicQuery: 'winter cinematic ambient',
  },
  'coffee-culture': {
    videotags: ['coffee shop', 'barista pour', 'espresso machine', 'roasting beans'],
    imagetags: ['latte art', 'coffee beans', 'cafe interior', 'coffee cup steam'],
    captions: ['One cup at a time.', 'THIRD WAVE', 'COFFEE', 'Slow mornings, strong brew.', '— ROASTED FRESH —', 'ESPRESSO'],
    musicQuery: 'coffee shop lofi chill',
  },
  'startup-hustle': {
    videotags: ['startup office', 'coding team', 'brainstorm session', 'pitch meeting'],
    imagetags: ['whiteboard sketch', 'open workspace', 'laptop coffee', 'sticky notes'],
    captions: ['Ship it anyway.', 'MOVE FAST', 'STARTUP', 'Built at 2am, shipped at 9.', '— DAY ONE —', 'ITERATE'],
    musicQuery: 'startup corporate lofi',
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

/** Pick up to `n` distinct random items from `items` (fewer if the pool is smaller). */
function pickManyRandom<T>(items: T[], n: number): T[] {
  const pool = [...items]
  const out: T[] = []
  while (out.length < n && pool.length > 0) {
    const [item] = pool.splice(Math.floor(Math.random() * pool.length), 1)
    out.push(item)
  }
  return out
}

function pickTopic(): [string, PixabayTopic] {
  const keys = Object.keys(PIXABAY_TOPICS)
  const key = keys[Math.floor(Math.random() * keys.length)]
  return [key, PIXABAY_TOPICS[key]]
}

async function fetchPixabay<T extends 'photos' | 'videos'>(
  kind: T,
  query: string,
  page: number,
): Promise<T extends 'photos' ? PixabayPhoto[] : PixabayVideo[]> {
  const url = `/api/pixabay/${kind}?query=${encodeURIComponent(query)}&page=${page}&per_page=15`
  const res = await fetch(url)
  if (!res.ok) return [] as never
  const data = await res.json()
  return data.hits ?? []
}

/** One API call for a batch of videos on a random tag/page for the topic. */
async function fetchVideos(topic: PixabayTopic): Promise<PixabayVideo[]> {
  const tag = pickRandom(topic.videotags)
  if (!tag) return []
  const page = 1 + Math.floor(Math.random() * 3)
  const hits = await fetchPixabay('videos', tag, page)
  console.log('[pixabay] video search', {
    tag,
    page,
    hitCount: hits.length,
    resultTags: hits.map((h) => h.tags),
  })
  return hits
}

/** One API call for a batch of images on a random tag/page for the topic. */
async function fetchImages(topic: PixabayTopic): Promise<PixabayPhoto[]> {
  const tag = pickRandom(topic.imagetags)
  if (!tag) return []
  const page = 1 + Math.floor(Math.random() * 3)
  const hits = await fetchPixabay('photos', tag, page)
  console.log('[pixabay] image search', {
    tag,
    page,
    hitCount: hits.length,
    resultTags: hits.map((h) => h.tags),
  })
  return hits
}

export interface LoadRandomPixabayDeps {
  engine: TimelineEngine
  timelineRef: RefObject<TimelineRef | null>
}

export interface LoadPixabayTopicDeps extends LoadRandomPixabayDeps {
  topicName: string
  topic: PixabayTopic
}

/** Picks one of the curated PIXABAY_TOPICS at random and composes it. */
export async function loadRandomPixabay(deps: LoadRandomPixabayDeps): Promise<string> {
  const [topicName, topic] = pickTopic()
  return loadPixabayTopic({ ...deps, topicName, topic })
}

/**
 * Build a Pixabay project from a given topic (curated or AI-generated):
 * fetches alternating video/image clips, lays them on the video lane with
 * fade transitions, and spreads that topic's captions across all 4 elements
 * (text) lanes.
 */
export async function loadPixabayTopic({
  engine,
  timelineRef,
  topicName,
  topic,
}: LoadPixabayTopicDeps): Promise<string> {
  // Exactly two API calls — one batch of videos, one batch of images — run in
  // parallel. Each proxy request returns up to 15 hits, so we pick distinct
  // clips from those pools locally instead of one request per visual.
  const videoSlots = Math.ceil(VISUAL_COUNT / 2)
  const imageSlots = VISUAL_COUNT - videoSlots
  const [videoPool, imagePool] = await Promise.all([fetchVideos(topic), fetchImages(topic)])
  const videos = pickManyRandom(videoPool, videoSlots)
  const images = pickManyRandom(imagePool, imageSlots)

  // Alternate video/image so the edit doesn't clump by kind. If one pool runs
  // dry, fall back to the other so we still fill up to VISUAL_COUNT slots.
  const takeVideo = () => {
    const item = videos.shift()
    return item && { kind: 'video' as const, asset: importPixabayVideo(item) }
  }
  const takeImage = () => {
    const item = images.shift()
    return item && { kind: 'image' as const, asset: importPixabayPhoto(item) }
  }
  const fetched: { kind: 'video' | 'image'; asset: MediaAsset }[] = []
  for (let i = 0; i < VISUAL_COUNT; i++) {
    const next = i % 2 === 0 ? takeVideo() || takeImage() : takeImage() || takeVideo()
    if (next) fetched.push(next)
  }

  if (fetched.length === 0) {
    throw new Error(`No Pixabay results for topic "${topicName}" — try again.`)
  }

  const project = engine.getProject()
  const fps = project.fps
  const stage = project.stage
  const fadeFrames = Math.max(2, secondsToFrames(FADE_MS / 1000, fps))
  const desiredFrames = Math.round(fps * CLIP_SECONDS)

  const videoTrack = project.tracks.find((t) => t.kind === 'video')
  const elementsTracks = project.tracks.filter((t) => t.kind === 'elements')
  if (!videoTrack || elementsTracks.length === 0) {
    throw new Error('Expected a video track and at least one elements track on the project')
  }

  engine.batch(() => {
    // --- CLEAR PREVIOUS LOAD: this loader owns the video + elements lanes, so
    // running it again (e.g. clicking the button twice) must clear whatever
    // it placed last time first — otherwise the new clips, which start back
    // at frame 0, collide with the leftover ones and addClip throws.
    for (const track of [videoTrack, ...elementsTracks]) {
      for (const clip of engine.getClipsOnTrack(track.id)) {
        engine.removeClip(clip.id, track.id)
      }
    }

    // --- VIDEO LANE: alternating video/image clips --------------------------
    let cursor = 0
    const videoClipIds: string[] = []
    const placedClips: [number, number][] = []
    for (const item of fetched) {
      const sourceFrames =
        item.asset.durationSec > 0 ? Math.max(1, secondsToFrames(item.asset.durationSec, fps)) : desiredFrames
      const duration = Math.min(desiredFrames, sourceFrames)
      const transform = transformFromCoverRect(
        item.asset.width ?? stage.width,
        item.asset.height ?? stage.height,
        stage.width,
        stage.height,
      )
      const clip = engine.addClip({
        trackId: videoTrack.id,
        type: item.kind,
        name: item.asset.name,
        startFrame: cursor,
        durationFrames: duration,
        src: item.asset.src,
        assetId: item.asset.id,
        transform,
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
  }, `Random load from Pixabay — ${topicName}`)

  // --- Post-load: clean playback state -------------------------------------
  const playback = usePlaybackStore.getState()
  playback.pause()
  playback.setCurrentFrame(0)
  requestAnimationFrame(() => timelineRef.current?.fitToWindow())

  return topicName
}

export const PIXABAY_TOPIC_NAMES = Object.keys(PIXABAY_TOPICS)
