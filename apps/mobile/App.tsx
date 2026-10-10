import { useEffect, useRef, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { StatusBar } from 'expo-status-bar'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import {
  EditorProvider,
  applyEngineCommand,
  beginMove,
  beginTrim,
  computeLaneSlots,
  defaultCommandTargets,
  endMove,
  endTrim,
  framesToTimecode,
  snapshotFromStores,
  Timeline,
  timelineContentWidth,
  timelineColors,
  updateMove,
  updateTrim,
  usePlaybackStore,
  useTimelineEngine,
  useTracksStore,
  type EngineCommand,
  type TimelineRef,
  type Track,
} from '@elah/react-native'
import { FPS, INITIAL_TRACKS, loadFixture, loadStressFixture, type FixtureIds } from './src/fixture'

/**
 * @elah/react-native dev harness (RN-T3, RN-T4, RN-T5).
 *
 * The real engine, the real @elah/react EditorProvider and the real timeline
 * model, running on Hermes, drawn by the library's <Timeline>. The buttons
 * drive the same begin/update/end reducers a gesture will call, with the
 * finger travel a gesture would report, and apply the resulting command to
 * the engine; the timeline shows each command land.
 */
export default function App() {
  return (
    <GestureHandlerRootView style={styles.fill}>
      <SafeAreaProvider>
        <EditorProvider fps={FPS} stage={{ width: 1080, height: 1920 }} initialTracks={INITIAL_TRACKS}>
          <Harness />
        </EditorProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}

function Harness() {
  const engine = useTimelineEngine()
  const [ids, setIds] = useState<FixtureIds | null>(null)
  const [lastCommand, setLastCommand] = useState<string>('(none yet)')

  useEffect(() => {
    setIds(loadFixture(engine))
  }, [engine])

  const run = (label: string, command: EngineCommand | null) => {
    if (!command) {
      setLastCommand(`${label}: no-op (nothing changed, or the clip is locked)`)
      return
    }
    applyEngineCommand(defaultCommandTargets(engine), command)
    setLastCommand(`${label}:\n${JSON.stringify(command, null, 1)}`)
  }

  // Each action is what a finished gesture produces. `translationX` and
  // `pointerY` are the numbers react-native-gesture-handler will report.
  const moveARight = () => {
    if (!ids) return
    const snapshot = snapshotFromStores()
    const session = beginMove(ids.a, snapshot)
    if (!session) return run('Move A +1s', null)
    const preview = updateMove(session, { translationX: FPS * snapshot.zoom })
    run('Move A +1s', endMove(session, preview, snapshotFromStores()))
  }

  const moveAToV2 = () => {
    if (!ids) return
    const snapshot = snapshotFromStores()
    const session = beginMove(ids.a, snapshot)
    if (!session) return run('Move A to V2', null)
    const v2 = computeLaneSlots(snapshot.tracks).find((l) => l.trackId === ids.v2)
    const preview = updateMove(session, { translationX: 0, pointerY: (v2?.top ?? 0) + 30 })
    run('Move A to V2', endMove(session, preview, snapshotFromStores()))
  }

  const trimAEnd = () => {
    if (!ids) return
    const snapshot = snapshotFromStores()
    const session = beginTrim(ids.a, 'right', snapshot)
    if (!session) return run('Trim A end', null)
    run('Trim A end -15f', endTrim(session, updateTrim(session, -15 * snapshot.zoom)))
  }

  const growAEnd = () => {
    if (!ids) return
    const snapshot = snapshotFromStores()
    const session = beginTrim(ids.a, 'right', snapshot)
    if (!session) return run('Grow A end', null)
    // Ask for far more than the lane allows: the model stops at the next clip.
    run('Grow A end (max)', endTrim(session, updateTrim(session, 10_000)))
  }

  const isPlaying = usePlaybackStore((s) => s.isPlaying)
  const togglePlay = usePlaybackStore((s) => s.togglePlayPause)
  const canUndo = useTracksStore((s) => s.canUndo)
  const canRedo = useTracksStore((s) => s.canRedo)

  const timelineRef = useRef<TimelineRef>(null)
  const lanesWidth = useRef(0)
  // The store clamps to ZOOM_MIN / ZOOM_MAX. Pinch zoom is RN-T7; these buttons let RN-T5's
  // ruler / playhead alignment be checked at several zoom levels until then.
  const zoomBy = (factor: number) => {
    const { zoom } = usePlaybackStore.getState()
    run(`Zoom ×${factor.toFixed(2)}`, { type: 'setZoom', zoom: zoom * factor })
  }

  const scrollToEnd = () => {
    const { totalFrames } = useTracksStore.getState()
    const { zoom } = usePlaybackStore.getState()
    timelineRef.current?.scrollTo(Math.max(0, timelineContentWidth(totalFrames, zoom) - lanesWidth.current))
  }

  return (
    <SafeAreaView style={styles.fill} edges={['top', 'bottom']}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={styles.page}>
        <Text style={styles.title}>Elah · React Native harness</Text>
        <Text style={styles.muted}>Engine, provider and timeline model running on this device.</Text>

        <Transport isPlaying={isPlaying} onToggle={togglePlay} />

        <Section title="Timeline (RN-T4, RN-T5)">
          <Timeline
            ref={timelineRef}
            style={styles.timeline}
            renderTrackIcon={TrackIcon}
            onLayoutLanes={(layout) => {
              lanesWidth.current = layout.width
            }}
          />
          <View style={styles.buttons}>
            <Button label="Zoom −" onPress={() => zoomBy(1 / 1.5)} />
            <Button label="Zoom +" onPress={() => zoomBy(1.5)} />
            <Button label="Scroll to start" onPress={() => timelineRef.current?.scrollTo(0)} />
            <Button label="Scroll to end" onPress={scrollToEnd} />
            <Button label="Load 200 clips" onPress={() => { loadStressFixture(engine); setLastCommand('(200 clips loaded; Reset to restore A, B, Title)') }} />
          </View>
        </Section>

        <Section title="Gesture model → engine">
          <View style={styles.buttons}>
            <Button label="Move A +1s" onPress={moveARight} />
            <Button label="Move A → V2" onPress={moveAToV2} />
            <Button label="Trim A end −15f" onPress={trimAEnd} />
            <Button label="Grow A end (max)" onPress={growAEnd} />
            <Button label="Undo" disabled={!canUndo} onPress={() => run('Undo', { type: 'undo' })} />
            <Button label="Redo" disabled={!canRedo} onPress={() => run('Redo', { type: 'redo' })} />
            <Button label="Reset" onPress={() => { setIds(loadFixture(engine)); setLastCommand('(reset)') }} />
          </View>
          <Text style={styles.code}>{lastCommand}</Text>
        </Section>

        <Section title="tracksStore">
          <ClipList />
        </Section>
      </ScrollView>
    </SafeAreaView>
  )
}

function Transport({ isPlaying, onToggle }: { isPlaying: boolean; onToggle: () => void }) {
  const frame = usePlaybackStore((s) => s.currentFrame)
  const total = useTracksStore((s) => s.totalFrames)
  return (
    <View style={styles.transport}>
      <Button label={isPlaying ? 'Pause' : 'Play'} onPress={onToggle} />
      <Text style={styles.timecode}>
        {framesToTimecode(frame, FPS)} · f{frame}
      </Text>
      <Text style={styles.muted}>
        frame {frame} / {total}
      </Text>
    </View>
  )
}

/** The library takes icons as a render prop; the harness uses text glyphs so it needs no icon set. */
const TRACK_GLYPHS: Record<Track['kind'], string> = { video: '▶', audio: '♪', elements: 'T' }

function TrackIcon(track: Track) {
  return <Text style={styles.trackIcon}>{TRACK_GLYPHS[track.kind]}</Text>
}

function ClipList() {
  const tracks = useTracksStore((s) => s.tracks)
  const clips = useTracksStore((s) => s.clips)
  return (
    <View>
      {tracks.map((track) => (
        <Text key={track.id} style={styles.mono}>
          {track.name.padEnd(9)} {(clips[track.id] ?? []).map((c) => `${c.name}[${c.startFrame},${c.startFrame + c.durationFrames})`).join('  ') || '—'}
        </Text>
      ))}
    </View>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  )
}

function Button({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.button, pressed && styles.buttonPressed, disabled && styles.buttonDisabled]}
    >
      <Text style={styles.buttonLabel}>{label}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#0f1115' },
  page: { padding: 16, gap: 16 },
  title: { color: '#f2f3f5', fontSize: 20, fontWeight: '600' },
  muted: { color: '#8b919c', fontSize: 13 },
  transport: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  timecode: { color: '#f2f3f5', fontSize: 18, fontVariant: ['tabular-nums'] },
  section: { gap: 8 },
  sectionTitle: { color: '#c9ccd2', fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  timeline: { borderRadius: 6, overflow: 'hidden' },
  trackIcon: { color: timelineColors.textMuted, fontSize: 12, width: 12, textAlign: 'center' },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  button: { backgroundColor: '#262b35', paddingHorizontal: 12, paddingVertical: 10, borderRadius: 6, minHeight: 40, justifyContent: 'center' },
  buttonPressed: { backgroundColor: '#323946' },
  buttonDisabled: { opacity: 0.4 },
  buttonLabel: { color: '#f2f3f5', fontSize: 14 },
  code: { color: '#b8e0a8', fontFamily: 'monospace', fontSize: 12, backgroundColor: '#161a21', padding: 8, borderRadius: 6 },
  mono: { color: '#d6d9de', fontFamily: 'monospace', fontSize: 12 },
})
