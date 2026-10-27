/**
 * Hand a file to the user. Inside a claude.ai artifact the `downloads` capability is the only route that
 * works: the frame is sandboxed without `allow-downloads`, so an `<a download>` is blocked silently. Reach it
 * with `await window.claude.use('downloads')` (the contract promises no `window.claude.downloads` member);
 * anywhere else (a local server, elah.dev) fall back to an `<a download>` of a blob: URL.
 */

type DownloadsApi = { save: (opts: { filename: string; data: Blob }) => Promise<unknown> | unknown }
type ClaudeApi = { use?: (name: 'downloads') => Promise<DownloadsApi | null>; downloads?: DownloadsApi }

function claudeApi(): ClaudeApi | undefined {
  return (window as unknown as { claude?: ClaudeApi }).claude
}

function isFramed(): boolean {
  try {
    return window.self !== window.top
  } catch {
    return true // a cross-origin top window throws: that is a frame
  }
}

async function downloadsApi(): Promise<DownloadsApi | undefined> {
  const claude = claudeApi()
  const api = (await claude?.use?.('downloads')) ?? claude?.downloads
  return api && typeof api.save === 'function' ? api : undefined
}

export type SaveRoute = 'capability' | 'anchor'

export async function saveFile(filename: string, data: Blob): Promise<SaveRoute> {
  const api = await downloadsApi()
  if (api) {
    try {
      await api.save({ filename, data })
      return 'capability'
    } catch (e) {
      const code = (e as { code?: string } | null)?.code
      if (code === 'declined') throw new Error('Save cancelled')
      throw new Error(`The viewer could not save the file${code ? ` (${code})` : ''}`)
    }
  }
  // A framed page without the capability cannot download: the sandbox blocks the anchor without telling us.
  if (isFramed()) throw new Error('Saving files is not available in this view; allow downloads in the artifact permissions and reload')
  const url = URL.createObjectURL(data)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
  return 'anchor'
}
