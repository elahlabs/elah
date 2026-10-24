import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { GITHUB_URL } from '@/config/nav'
import { CropMarks, Sel } from './Sel'
import { btnLarge, container, display, label, lead, sectionY } from './ui'

/** Closing call to action: the last shot, on the ink stage, framed by crop marks. */
export function HomeCta() {
  const onInk = `inline-flex items-center justify-center gap-2 font-medium no-underline transition-colors uppercase tracking-[0.12em] font-[family-name:var(--font-geist-mono),ui-monospace,monospace]`
  return (
    <section data-scene="Wrap" className={sectionY}>
      <div className={container}>
        <div className="relative bg-[var(--lp-stage)] [outline:1px_solid_var(--lp-stage-line)] px-6 py-16 text-[#F0EFEA] sm:px-12 lg:py-24">
          <CropMarks color="#5E5D58" size={18} inset={14} />
          <p className={`m-0 mb-8 text-[#9A9993] ${label}`}>Final cut</p>
          <h2 className={`m-0 text-[52px] font-extrabold leading-[0.88] sm:text-[88px] lg:text-[120px] ${display}`}>
            Write the motion.
            <br />
            Keep the <Sel><span className="text-[#F0EFEA]">timeline.</span></Sel>
          </h2>
          <div className="mt-10 flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
            <p className={`${lead} max-w-[520px] !text-[#C9C8C2]`}>
              elah is open source. Let Claude write the video, then edit its keyframes and export an mp4 in your browser.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Link href="/claude" className={`${onInk} ${btnLarge} bg-[#FF003C] text-[#0E0E10] hover:bg-[#F0EFEA]`}>
                Try the Claude plugin
                <ArrowRight size={15} strokeWidth={2} aria-hidden />
              </Link>
              <a
                href={GITHUB_URL}
                target="_blank"
                rel="noopener noreferrer"
                className={`${onInk} ${btnLarge} border border-[#F0EFEA] text-[#F0EFEA] hover:bg-[#F0EFEA] hover:text-[#0E0E10]`}
              >
                View on GitHub
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
