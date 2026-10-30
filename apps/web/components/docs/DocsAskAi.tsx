'use client'

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { ArrowUpRight, Check, ChevronDown, Copy, FileText } from 'lucide-react'
import posthog from 'posthog-js'
import { label } from '@/components/eb'
import { docsNav } from '@/config/docs'
import { siteConfig } from '@/config/site'

type Tool = 'prompt' | 'claude' | 'codex' | 'opencode'

/* Brand marks from simple-icons (CC0). Codex has no mark of its own there, so it wears OpenAI's. */
const CLAUDE_PATH =
  'm4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z'
const OPENAI_PATH =
  'M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z'
const OPENCODE_PATH = 'M22 24H2V0h20zM17 4.8H7v14.4h10z'

function Mark({ path, color, size = 16 }: { path: string; color?: string; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden fill={color ?? 'currentColor'}>
      <path d={path} />
    </svg>
  )
}

const MARKS: Record<Exclude<Tool, 'prompt'>, ReactNode> = {
  claude: <Mark path={CLAUDE_PATH} color="#D97757" />,
  codex: <Mark path={OPENAI_PATH} />,
  opencode: <Mark path={OPENCODE_PATH} size={14} />,
}

/** POSIX single-quote a string for a shell command line. */
function shellQuote(s: string) {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

function pageTitle(pathname: string) {
  for (const section of docsNav) {
    for (const item of section.items) if (item.href === pathname) return item.title
  }
  return 'Elah docs'
}

function promptFor(pathname: string) {
  const url = `${siteConfig.url}${pathname}`
  return (
    `I am building with Elah (${siteConfig.url}), an open-source video editing engine for the browser. ` +
    `Read the "${pageTitle(pathname)}" docs page at ${url} and the docs index at ${siteConfig.url}/llms.txt, ` +
    `then help me apply it in this project. Ask me what I am building first.`
  )
}

const ITEMS: { tool: Exclude<Tool, 'prompt'>; title: string; hint: string }[] = [
  { tool: 'claude', title: 'Ask Claude Code', hint: 'Opens in your terminal, prompt ready' },
  { tool: 'codex', title: 'Ask Codex', hint: 'Copies a codex command to run' },
  { tool: 'opencode', title: 'Ask OpenCode', hint: 'Copies an opencode command to run' },
]

const NOTES: Record<Tool, string> = {
  prompt: 'Prompt copied. Paste it into any assistant.',
  claude: 'Opening Claude Code. If nothing opens, the command is on your clipboard.',
  codex: 'Command copied. Paste it in your terminal.',
  opencode: 'Command copied. Paste it in your terminal.',
}

/**
 * "Ask AI" split button at the top of every docs page. The main half copies a
 * prompt that points an assistant at this page and llms.txt; the menu hands
 * the same prompt to a coding agent:
 * - Claude Code opens through its `claude-cli://open?q=` deep link (pre-filled,
 *   never sent) and also copies `claude '<prompt>'`, since the link only works
 *   once Claude Code has registered its handler on the machine.
 * - Codex and OpenCode have no documented deep link, so they copy the CLI
 *   command (`codex '<prompt>'`, `opencode --prompt '<prompt>'`).
 */
export function DocsAskAi() {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [done, setDone] = useState<Tool | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [open])

  function run(tool: Tool) {
    const prompt = promptFor(pathname)
    const text = {
      prompt,
      claude: `claude ${shellQuote(prompt)}`,
      codex: `codex ${shellQuote(prompt)}`,
      opencode: `opencode --prompt ${shellQuote(prompt)}`,
    }[tool]
    navigator.clipboard?.writeText(text).catch(() => {
      // clipboard may be unavailable (insecure context); the note still shows
    })
    if (tool === 'claude') window.location.href = `claude-cli://open?q=${encodeURIComponent(prompt)}`
    posthog.capture('docs_ask_ai_clicked', { tool, path: pathname })
    setOpen(false)
    setDone(tool)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setDone(null), 3500)
  }

  function onMenuKey(e: KeyboardEvent) {
    const items = [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])]
    const i = items.indexOf(document.activeElement as HTMLElement)
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus()
    } else if (e.key === 'Escape') {
      setOpen(false)
      trigger.current?.focus()
    }
  }

  const half = 'flex h-[34px] items-center gap-2 px-3 text-[13px] font-medium text-on-surface transition-colors hover:bg-surface-container'
  const row = 'flex w-full items-center gap-3 px-2.5 py-2 text-left no-underline outline-none transition-colors hover:bg-surface-container focus-visible:bg-surface-container'
  const tile = 'flex h-8 w-8 shrink-0 items-center justify-center border border-outline-variant bg-surface text-on-surface'

  return (
    <div ref={root} className="relative mb-6 flex justify-end">
      <div className="flex items-stretch border border-outline-variant bg-surface-low">
        <button type="button" onClick={() => run('prompt')} className={half}>
          {done === 'prompt' ? <Check size={14} strokeWidth={2} aria-hidden /> : <Copy size={14} strokeWidth={2} aria-hidden />}
          Copy prompt
        </button>
        <span aria-hidden className="w-px bg-outline-variant" />
        <button
          ref={trigger}
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label="Ask an AI coding agent about this page"
          onClick={() => setOpen((o) => !o)}
          className={half}
        >
          <span className="flex items-center -space-x-1.5">
            {(['claude', 'codex', 'opencode'] as const).map((t) => (
              <span key={t} className="flex h-[22px] w-[22px] items-center justify-center rounded-full border border-outline-variant bg-surface [&_svg]:h-3 [&_svg]:w-3">
                {MARKS[t]}
              </span>
            ))}
          </span>
          Ask AI
          <ChevronDown size={14} strokeWidth={2} aria-hidden className={`transition-transform duration-150 ${open ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {open ? (
        <div
          ref={menu}
          role="menu"
          aria-label="Ask AI"
          onKeyDown={onMenuKey}
          className="absolute right-0 top-full z-40 mt-2 w-[min(340px,calc(100vw-2rem))] border border-outline-variant bg-surface-low p-1.5 shadow-[0_12px_32px_-12px_rgba(14,14,16,0.25)]"
        >
          <button type="button" role="menuitem" onClick={() => run('prompt')} className={row}>
            <span className={tile}>
              <Copy size={15} strokeWidth={1.75} aria-hidden />
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="text-[13px] font-medium text-on-surface">Copy prompt</span>
              <span className="text-xs text-on-surface-variant">Paste into any assistant</span>
            </span>
          </button>
          {ITEMS.map((item) => (
            <button key={item.tool} type="button" role="menuitem" onClick={() => run(item.tool)} className={row}>
              <span className={tile}>{MARKS[item.tool]}</span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-[13px] font-medium text-on-surface">{item.title}</span>
                <span className="text-xs text-on-surface-variant">{item.hint}</span>
              </span>
              {item.tool === 'claude' ? <ArrowUpRight size={14} strokeWidth={2} aria-hidden className="text-on-surface-variant" /> : null}
            </button>
          ))}
          <div className="my-1.5 h-px bg-outline-variant" />
          <a href="/llms.txt" target="_blank" rel="noopener" role="menuitem" className={row}>
            <span className={tile}>
              <FileText size={15} strokeWidth={1.75} aria-hidden />
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-[13px] font-medium text-on-surface">View llms.txt</span>
              <span className="text-xs text-on-surface-variant">The docs index, written for AI</span>
            </span>
            <ArrowUpRight size={14} strokeWidth={2} aria-hidden className="text-on-surface-variant" />
          </a>
        </div>
      ) : null}

      <p
        aria-live="polite"
        className={`pointer-events-none absolute right-0 top-full z-30 mb-0 mt-2 flex items-center gap-2 border border-outline-variant bg-surface-low px-3 py-2 text-xs text-on-surface transition-opacity duration-200 ${
          done && !open ? 'opacity-100' : 'opacity-0'
        }`}
      >
        <span aria-hidden className="h-[7px] w-[7px] shrink-0 bg-[#FF003C]" />
        <span className={label}>{done === 'claude' ? 'Opening' : 'Copied'}</span>
        {done ? NOTES[done] : null}
      </p>
    </div>
  )
}
