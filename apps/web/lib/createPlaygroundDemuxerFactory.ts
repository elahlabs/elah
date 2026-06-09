import * as _mediabunny from 'mediabunny'
import { createMediabunnyBackend } from '@elah/editor'
import type { DemuxerFactory, MediabunnyModule } from '@elah/editor'

const mediabunny = _mediabunny as unknown as MediabunnyModule

export function createPlaygroundDemuxerFactory(): DemuxerFactory {
  return () =>
    createMediabunnyBackend(mediabunny, {
      blobResolver: async (src: string): Promise<Blob> => {
        const res = await fetch(src)
        if (!res.ok) {
          throw new Error(
            `createPlaygroundDemuxerFactory: failed to fetch media "${src}" ` +
            `(HTTP ${res.status} ${res.statusText}).`,
          )
        }
        return res.blob()
      },
    })
}
