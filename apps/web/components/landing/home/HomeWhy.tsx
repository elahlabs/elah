import { Section } from './Section'
import { Sel } from './Sel'
import { mono, outline, sans } from './ui'

const SOURCES = {
  remotionLicense: 'https://github.com/remotion-dev/remotion/blob/main/LICENSE.md',
  remotionWeb: 'https://www.remotion.dev/docs/web-renderer/',
  hyperframes: 'https://github.com/heygen-com/hyperframes',
} as const

interface Row {
  label: string
  elah: string
  remotion: string
  hyperframes: string
}

/**
 * Cells are limited to what each project's own public docs state (brief
 * section 8). Rows that could not be checked against a source were dropped:
 * "output is an editable timeline" and "footage stays on the device".
 */
const rows: Row[] = [
  { label: 'Open-source licence', elah: 'Apache-2.0', remotion: 'Remotion License: free for individuals and for-profit organizations up to 3 employees; a Company License is required beyond that', hyperframes: 'Apache-2.0' },
  { label: 'Motion written as code', elah: 'Yes: html scenes and VideoSpec (experimental)', remotion: 'Yes: React components', hyperframes: 'Yes: html with data attributes' },
  { label: 'Renders in the browser with no server', elah: 'Yes, in Chrome or Edge', remotion: 'Experimental web renderer, a subset of html and css', hyperframes: 'Renders with headless Chrome and FFmpeg' },
]

const link = 'text-[#5E5D58] underline underline-offset-2 transition-colors hover:text-[#0E0E10]'

/** "Why elah" comparison (brief section 8). Short, factual, no adjectives. */
export function HomeWhy() {
  const th = `px-4 py-3 text-left text-[12px] font-normal text-[#5E5D58] ${mono}`
  const td = `border-t border-[#D9D7D0] px-4 py-4 align-top text-[15px] leading-[23px] text-[#5E5D58] ${sans}`
  return (
    <Section n={7} scene="Compare" kicker="From public docs" id="why" title={<>How elah <Sel>compares.</Sel></>}>
      <div className={`overflow-x-auto bg-[#F7F6F2] ${outline}`} tabIndex={0} role="region" aria-label="Comparison table">
        <table className="w-full min-w-[720px] border-collapse">
          <thead>
            <tr>
              <th scope="col" className={th}>
                <span className="sr-only">Capability</span>
              </th>
              <th scope="col" className={`${th} !text-[#FF003C]`}>elah</th>
              <th scope="col" className={th}>Remotion</th>
              <th scope="col" className={th}>HyperFrames</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}>
                <th scope="row" className={`${td} text-left font-semibold !text-[#0E0E10]`}>{r.label}</th>
                <td className={`${td} !text-[#0E0E10]`}>{r.elah}</td>
                <td className={td}>{r.remotion}</td>
                <td className={td}>{r.hyperframes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={`m-0 text-[13px] leading-[21px] text-[#5E5D58] ${sans}`}>
        Sources: <a href={SOURCES.remotionLicense} className={link}>Remotion license</a>, <a href={SOURCES.remotionWeb} className={link}>Remotion web renderer</a>,{' '}
        <a href={SOURCES.hyperframes} className={link}>HyperFrames on GitHub</a>. Checked against their public pages; check them for current terms.
      </p>
    </Section>
  )
}
