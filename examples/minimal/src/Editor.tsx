import {
  EditorProvider,
  Preview,
  Timeline,
  AssetPanel,
  createDefaultDemuxerFactory,
  type InitialTrackConfig,
} from '@elah/editor'
import PlayButton from './PlayButton'

/**
 * The smallest complete Elah editor: import media, drag it onto the timeline,
 * scrub, and play. Everything else you might build — inspectors, toolbars,
 * export dialogs — hangs off the same three pieces used here.
 *
 * Read the four comments marked GOTCHA. They are the things that silently
 * produce a blank canvas or a dead timeline if you get them wrong.
 */

const FPS = 30

// GOTCHA 1 — create the demuxer factory ONCE, at module scope.
// It owns decoder state. Calling createDefaultDemuxerFactory() inside the
// component body makes a new one every render and video playback stutters or
// stalls. Module scope (or a useRef) is the fix.
const demuxerFactory = createDefaultDemuxerFactory()

// Tracks are laid out top→bottom, and lower index renders on top. You can have
// any number of tracks of any kind; this is just a sensible default.
const INITIAL_TRACKS: InitialTrackConfig[] = [
  { kind: 'video', name: 'Video' },
  { kind: 'elements', name: 'Text & Shapes' },
  { kind: 'audio', name: 'Audio' },
]

export default function Editor() {
  return (
    // GOTCHA 2 — EditorProvider builds the engine ONCE, on mount.
    // fps, stage, initialTracks, and defaultTrackHeight are read a single time;
    // changing these props later does nothing. To change the canvas size at
    // runtime use `engine.setStage(width, height)` instead.
    <EditorProvider
      fps={FPS}
      stage={{ width: 1920, height: 1080 }}
      initialTracks={INITIAL_TRACKS}
    >
      {/* GOTCHA 3 — the `elah-root` class is what scopes the --elah-* design
          tokens. Without it the SDK components render with unset colours. */}
      <div className="elah-root" style={{ display: 'flex', height: '100vh' }}>
        {/* Import + browse media. Drag a card onto the timeline to add a clip. */}
        <AssetPanel style={{ width: 240, flexShrink: 0 }} />

        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          {/* The WebGL2 canvas. It renders whatever the timeline resolves to at
              the current frame — you never draw to it yourself. */}
          <Preview demuxerFactory={demuxerFactory} style={{ flex: 1, minHeight: 0 }} />

          {/* Your own UI, reading and driving the same engine. See PlayButton. */}
          <PlayButton />

          {/* GOTCHA 4 — Timeline needs an explicit height. It fills its
              container, and a flex child with no height collapses to zero. */}
          <Timeline fps={FPS} style={{ height: 240, flexShrink: 0 }} />
        </div>
      </div>
    </EditorProvider>
  )
}
