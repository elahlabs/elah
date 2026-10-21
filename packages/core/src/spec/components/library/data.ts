/**
 * Data, list and group components (AV-8b): stat-ring, stat-bars, big-number,
 * icon-row, badge-callouts, chip-cloud, checklist, testimonial-cards,
 * comparison. One file per component beside this one; collected here.
 */
import type { ComponentDef } from '../types'
import { statRingDef } from './statRing'
import { statBarsDef } from './statBars'
import { bigNumberDef } from './bigNumber'
import { iconRowDef } from './iconRow'
import { badgeCalloutsDef } from './badgeCallouts'
import { chipCloudDef } from './chipCloud'
import { checklistDef } from './checklist'
import { testimonialCardsDef } from './testimonialCards'
import { comparisonDef } from './comparison'

export const DATA_COMPONENTS: ReadonlyArray<ComponentDef> = [
  statRingDef,
  statBarsDef,
  bigNumberDef,
  iconRowDef,
  badgeCalloutsDef,
  chipCloudDef,
  checklistDef,
  testimonialCardsDef,
  comparisonDef,
]
