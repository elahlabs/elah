/**
 * Test-only: a tiny XML string → SvgNode tree. Not exported from the package;
 * core's vitest environment is Node, so there is no `DOMParser` to lean on
 * (PV-P6b-2). Handles just enough of XML to read the fixtures: elements,
 * attributes, self-closing tags, end tags, comments, `<?…?>`, `<!DOCTYPE …>`,
 * `<![CDATA[…]]>` and entity decoding.
 */

import type { SvgNode } from '../types'

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_m, body: string) => {
    if (body === 'amp') return '&'
    if (body === 'lt') return '<'
    if (body === 'gt') return '>'
    if (body === 'quot') return '"'
    if (body === 'apos') return "'"
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : ''
    }
    return _m
  })
}

function localName(name: string): string {
  const idx = name.indexOf(':')
  return idx < 0 ? name : name.slice(idx + 1)
}

const ATTR_RE = /([^\s=/>]+)\s*=\s*("([^"]*)"|'([^']*)')/g

function parseAttrs(text: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  ATTR_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = ATTR_RE.exec(text))) {
    const rawName = m[1]
    if (rawName === 'xmlns' || rawName.startsWith('xmlns:')) continue
    const value = m[3] !== undefined ? m[3] : (m[4] ?? '')
    attrs[localName(rawName)] = decodeEntities(value)
  }
  return attrs
}

export function parseXml(source: string): SvgNode {
  let i = 0
  const n = source.length

  function skipMisc(): void {
    for (;;) {
      while (i < n && /\s/.test(source[i])) i++
      if (source.startsWith('<?', i)) {
        const end = source.indexOf('?>', i)
        i = end < 0 ? n : end + 2
        continue
      }
      if (source.startsWith('<!--', i)) {
        const end = source.indexOf('-->', i)
        i = end < 0 ? n : end + 3
        continue
      }
      if (source.startsWith('<!DOCTYPE', i) || source.startsWith('<!doctype', i)) {
        const end = source.indexOf('>', i)
        i = end < 0 ? n : end + 1
        continue
      }
      break
    }
  }

  function parseElement(): SvgNode {
    skipMisc()
    if (source[i] !== '<') throw new Error(`parseXml: expected '<' at ${i}`)
    i++ // consume '<'
    const nameStart = i
    while (i < n && !/[\s/>]/.test(source[i])) i++
    const rawName = source.slice(nameStart, i)
    const tag = localName(rawName)

    const attrStart = i
    while (i < n && source[i] !== '>' && !(source[i] === '/' && source[i + 1] === '>')) i++
    const attrText = source.slice(attrStart, i)
    const attrs = parseAttrs(attrText)

    if (source[i] === '/' && source[i + 1] === '>') {
      i += 2
      return { tag, attrs, children: [] }
    }
    if (source[i] !== '>') throw new Error(`parseXml: expected '>' at ${i}`)
    i++ // consume '>'

    const children: SvgNode[] = []
    let text = ''
    for (;;) {
      if (i >= n) throw new Error(`parseXml: unexpected end of input inside <${tag}>`)
      if (source.startsWith('<![CDATA[', i)) {
        const end = source.indexOf(']]>', i)
        const body = end < 0 ? source.slice(i + 9) : source.slice(i + 9, end)
        text += body
        i = end < 0 ? n : end + 3
        continue
      }
      if (source.startsWith('<!--', i)) {
        const end = source.indexOf('-->', i)
        i = end < 0 ? n : end + 3
        continue
      }
      if (source.startsWith('</', i)) {
        const closeStart = i + 2
        let j = closeStart
        while (j < n && !/[\s>]/.test(source[j])) j++
        const closeRawName = source.slice(closeStart, j)
        while (j < n && source[j] !== '>') j++
        j++ // consume '>'
        const closeTag = localName(closeRawName)
        if (closeTag !== tag) {
          throw new Error(`parseXml: mismatched end tag </${closeRawName}>, expected </${rawName}>`)
        }
        i = j
        break
      }
      if (source[i] === '<') {
        children.push(parseElement())
        continue
      }
      const textStart = i
      while (i < n && source[i] !== '<') i++
      text += decodeEntities(source.slice(textStart, i))
    }

    const node: SvgNode = { tag, attrs, children }
    if (tag === 'style') node.text = text
    return node
  }

  const root = parseElement()
  return root
}
