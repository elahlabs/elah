/**
 * The in-browser side of `elah export`, embedded as strings so the CLI ships
 * a single bundled file. The page deep-imports core's real exportVideo from
 * the harness server (bypassing core's index.js and everything browser-page
 * irrelevant) and streams progress + the MP4 bytes back over HTTP.
 */

export const HARNESS_HTML = `<!doctype html>
<html>
  <head><meta charset="utf-8"><title>elah export harness</title></head>
  <body><script type="module" src="/harness.js"></script></body>
</html>
`

/**
 * The callback routes carry a per-run random token so no other local process
 * can post a forged /result into the output file or read the media routes.
 *
 * With `encoder: 'ffmpeg'` the page still composites every frame, but encodes
 * nothing: it posts the audio mix first (so ffmpeg can mux it in one pass),
 * then each frame as a PNG through core's `png-sequence` frameSink. A frame
 * POST is answered only once ffmpeg has taken the bytes, so a slow encoder
 * throttles the page instead of piling frames up in memory.
 */
export function harnessJs(token: string): string {
  return `const project = globalThis.__ELAH_PROJECT__
const { encoder, ...options } = globalThis.__ELAH_OPTIONS__ ?? {}
const post = (path, body, type) =>
  fetch('/cb/${token}' + path, { method: 'POST', headers: { 'content-type': type }, body })
const postOk = async (path, body, type) => {
  const res = await post(path, body, type)
  if (!res.ok) throw new Error('harness server rejected ' + path.split('?')[0] + ' (' + res.status + ')')
}
const onProgress = (p) => {
  void post('/progress', JSON.stringify(p), 'application/json')
}
const onAudioIssue = (message, src) => {
  void post('/audio-issue', JSON.stringify({ message, src }), 'application/json')
}

try {
  if (!project) throw new Error('project was not injected into the harness page')
  const { exportVideo, renderAudioMix } = await import('/core/export/exportVideo.js')
  if (encoder === 'ffmpeg') {
    const { defaultAudioResolver } = await import('/core/media/audio/audioResolver.js')
    const audio = await renderAudioMix(project, defaultAudioResolver, onAudioIssue)
    if (audio) {
      const query = new URLSearchParams({
        sampleRate: String(audio.sampleRate),
        channels: String(audio.numberOfChannels),
        length: String(audio.length),
      })
      await postOk('/audio?' + query, new Blob(audio.channels), 'application/octet-stream')
    }
    await exportVideo(project, {
      container: 'png-sequence',
      outputHeight: options.outputHeight,
      onProgress,
      frameSink: {
        write: (_name, data) => postOk('/frame', data, 'image/png'),
        close: async () => {},
        abort: async () => {},
      },
    })
    await postOk('/finish', '', 'text/plain')
  } else {
    const blob = await exportVideo(project, { ...options, onProgress, onAudioIssue })
    await post('/result', await blob.arrayBuffer(), 'application/octet-stream')
  }
} catch (err) {
  await post(
    '/error',
    JSON.stringify({ message: String(err?.message ?? err), stack: err?.stack }),
    'application/json'
  )
}
`
}
