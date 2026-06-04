import { useMemo } from 'react'
import { theme } from './theme'

function highlightJson(json: string): React.ReactNode[] {
  const parts: React.ReactNode[] = []
  const re =
    /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g
  let last = 0
  let m: RegExpExecArray | null
  let key = 0

  while ((m = re.exec(json)) !== null) {
    if (m.index > last) {
      parts.push(json.slice(last, m.index))
    }
    const [full, str, colon] = m
    if (str !== undefined) {
      const color = colon ? theme.info : theme.success
      parts.push(
        <span key={key++} style={{ color }}>
          {full}
        </span>,
      )
    } else if (/^(true|false|null)$/.test(full)) {
      parts.push(
        <span key={key++} style={{ color: theme.warning }}>
          {full}
        </span>,
      )
    } else {
      parts.push(
        <span key={key++} style={{ color: theme.purple }}>
          {full}
        </span>,
      )
    }
    last = m.index + full.length
  }
  if (last < json.length) parts.push(json.slice(last))
  return parts
}

export function JsonHighlight({ value }: { value: unknown }) {
  const text = useMemo(() => JSON.stringify(value, null, 2), [value])
  return <code style={{ whiteSpace: 'pre' }}>{highlightJson(text)}</code>
}
