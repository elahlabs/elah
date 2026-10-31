import { codeToHtml, type ShikiTransformer } from 'shiki'
import { label } from '@/components/eb'
import { CopyButton } from './CopyButton'

/**
 * A syntax-highlighted code block, highlighted on the server by shiki, so no
 * highlighter ships to the browser. Both themes are emitted as CSS variables
 * and `.dark` picks one (styles/globals.css, "Docs code"). `highlight` marks
 * 1-based lines with a red rail, to point at the line that matters.
 */
export async function Code({
  code,
  lang = 'tsx',
  title,
  highlight = [],
}: {
  code: string
  lang?: string
  title?: string
  highlight?: number[]
}) {
  const source = code.trim()
  const marks: ShikiTransformer = {
    line(node, line) {
      if (highlight.includes(line)) this.addClassToHast(node, 'hl')
    },
  }
  const html = await codeToHtml(source, {
    lang,
    themes: { light: 'github-light', dark: 'github-dark-dimmed' },
    defaultColor: false,
    transformers: [marks],
  })
  return (
    <figure className="docs-code my-5 border border-outline-variant bg-surface-low">
      <figcaption className="flex h-9 items-center justify-between border-b border-outline-variant pl-4">
        <span className={`text-on-surface-variant ${label}`}>{title ?? lang}</span>
        <CopyButton text={source} />
      </figcaption>
      <div dangerouslySetInnerHTML={{ __html: html }} />
    </figure>
  )
}
