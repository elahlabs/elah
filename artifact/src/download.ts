/**
 * Hand a file to the user. Inside a claude.ai artifact the `downloads` capability is the route that works
 * (`window.claude.downloads.save({ filename, data: Blob })`, proven by the founder's in-frame check);
 * anywhere else (a local server, elah.dev) fall back to an `<a download>` of a blob: URL.
 */

type DownloadsApi = { save: (opts: { filename: string; data: Blob }) => Promise<unknown> | unknown }

function downloadsApi(): DownloadsApi | undefined {
  const w = window as unknown as { claude?: { downloads?: DownloadsApi } }
  const api = w.claude?.downloads
  return api && typeof api.save === 'function' ? api : undefined
}

export type SaveRoute = 'capability' | 'anchor'

export async function saveFile(filename: string, data: Blob): Promise<SaveRoute> {
  const api = downloadsApi()
  if (api) {
    try {
      await api.save({ filename, data })
      return 'capability'
    } catch (e) {
      console.warn('downloads.save failed, falling back to an anchor download', e)
    }
  }
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
