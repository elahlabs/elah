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
 */
export function harnessJs(token: string): string {
  return `const project = globalThis.__ELAH_PROJECT__
const options = globalThis.__ELAH_OPTIONS__ ?? {}
const post = (path, body, type) =>
  fetch('/cb/${token}' + path, { method: 'POST', headers: { 'content-type': type }, body })

try {
  if (!project) throw new Error('project was not injected into the harness page')
  const { exportVideo } = await import('/core/export/exportVideo.js')
  const blob = await exportVideo(project, {
    ...options,
    onProgress: (p) => {
      void post('/progress', JSON.stringify(p), 'application/json')
    },
    onAudioIssue: (message, src) => {
      void post('/audio-issue', JSON.stringify({ message, src }), 'application/json')
    },
  })
  await post('/result', await blob.arrayBuffer(), 'application/octet-stream')
} catch (err) {
  await post(
    '/error',
    JSON.stringify({ message: String(err?.message ?? err), stack: err?.stack }),
    'application/json'
  )
}
`
}
