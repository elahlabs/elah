import { Lock } from 'lucide-react'
import { tryElahHref } from './links'

/** Only features Elah Creator has today. Never add music or anything unbuilt. */
export const IN_ELAH: { id: string; label: string }[] = [
  { id: 'captions', label: 'Add captions' },
  { id: 'remove-background', label: 'Remove background' },
  { id: 'voice-over', label: 'Add voice-over' },
  { id: 'broll-images', label: 'Generate B-roll / images' },
  { id: 'assistant', label: 'Edit with the AI Assistant' },
]

export function InElah() {
  return (
    <section className="inelah" aria-label="In Elah" data-testid="in-elah">
      <span className="row-lbl">In Elah</span>
      <div className="chips">
        {IN_ELAH.map((o) => (
          <a key={o.id} className="chip locked" href={tryElahHref(o.id)} target="_blank" rel="noopener noreferrer" data-testid={`inelah-${o.id}`} title={`${o.label}: open in Elah Creator`}>
            <Lock size={12} /> {o.label} <span className="pill-in">in Elah</span>
          </a>
        ))}
      </div>
    </section>
  )
}
