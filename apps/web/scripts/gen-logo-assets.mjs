/**
 * One-off asset generator: turns the white-background "e" mark
 * (public/assets/logo-single.png) into:
 *   - public/elah-mark.png       transparent red "e" for navbar/footer (any theme)
 *   - app/icon.png               256² favicon (red "e" on brand charcoal)
 *   - app/apple-icon.png         180² apple touch icon
 *   - public/icons/icon-192.png  PWA manifest icon
 *   - public/icons/icon-512.png  PWA manifest icon
 *   - public/icons/maskable-512.png  PWA maskable icon (extra safe-zone padding)
 *
 * Run once: `node scripts/gen-logo-assets.mjs`
 */
import sharp from 'sharp'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { mkdirSync } from 'node:fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const web = resolve(__dirname, '..')

const SRC = resolve(web, 'public/assets/logo-single.png')
const BRAND_BG = { r: 0x2b, g: 0x30, b: 0x3b, alpha: 1 } // charcoal from the wordmark

/** Knock out the near-white background to transparent, then tight-trim. */
async function transparentMark() {
  const { data, info } = await sharp(SRC).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width, height, channels } = info
  for (let i = 0; i < data.length; i += channels) {
    const r = data[i], g = data[i + 1], b = data[i + 2]
    const min = Math.min(r, g, b)
    if (min > 235) {
      data[i + 3] = 0 // fully white → transparent
    } else if (min > 200) {
      data[i + 3] = Math.round(((235 - min) / 35) * 255) // feather edge
    }
  }
  return sharp(data, { raw: { width, height, channels } })
    .png()
    .trim({ threshold: 1 })
}

async function run() {
  // 1) Transparent mark for the UI (square, padded).
  const markBuf = await (await transparentMark()).toBuffer()
  const SIZE = 512
  const square = await sharp(markBuf)
    .resize(SIZE, SIZE, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer()
  await sharp(square).toFile(resolve(web, 'public/elah-mark.png'))

  // 2) Favicons: the mark centred on a brand-charcoal rounded square.
  const PAD = 0.16

  const makeIcon = async (size, out, pad = PAD) => {
    const paddedForSize = await sharp(markBuf)
      .resize(Math.round(size * (1 - pad * 2)), Math.round(size * (1 - pad * 2)), {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .toBuffer()
    await sharp({ create: { width: size, height: size, channels: 4, background: BRAND_BG } })
      .composite([{ input: paddedForSize, gravity: 'center' }])
      .png()
      .toFile(resolve(web, out))
  }

  await makeIcon(256, 'app/icon.png')
  await makeIcon(180, 'app/apple-icon.png')

  // PWA manifest icons.
  mkdirSync(resolve(web, 'public/icons'), { recursive: true })
  await makeIcon(192, 'public/icons/icon-192.png')
  await makeIcon(512, 'public/icons/icon-512.png')
  // maskable: android crops to a circle inscribed in the 80% safe zone, so the
  // mark needs noticeably more breathing room than the favicon build.
  await makeIcon(512, 'public/icons/maskable-512.png', 0.26)

  console.log(
    'Generated: public/elah-mark.png, app/icon.png, app/apple-icon.png, ' +
      'public/icons/icon-192.png, public/icons/icon-512.png, public/icons/maskable-512.png',
  )
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
