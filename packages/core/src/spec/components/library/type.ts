/**
 * Type, device and structure components (AV-8a): kinetic-title, word-hits,
 * typewriter-line, circled-phrase, quote-card, clock-sweep, logo-outro,
 * section-break. One file per component beside this one; collected here.
 */
import type { ComponentDef } from '../types'
import { circledPhrase } from './circledPhrase'
import { clockSweep } from './clockSweep'
import { kineticTitle } from './kineticTitle'
import { logoOutro } from './logoOutro'
import { quoteCard } from './quoteCard'
import { sectionBreak } from './sectionBreak'
import { typewriterLine } from './typewriterLine'
import { wordHits } from './wordHits'

export const TYPE_COMPONENTS: ReadonlyArray<ComponentDef> = [
  kineticTitle,
  wordHits,
  typewriterLine,
  circledPhrase,
  quoteCard,
  clockSweep,
  logoOutro,
  sectionBreak,
]
