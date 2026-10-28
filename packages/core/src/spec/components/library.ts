/**
 * The component library: every `ComponentDef`, collected from the two halves
 * built in parallel (AV-8a type/devices/structure, AV-8b data/lists/groups).
 * Until a name has an entry, `expandComponents` reports it as
 * `component-unavailable` rather than failing.
 */

import type { ComponentDef } from './types'
import { TYPE_COMPONENTS } from './library/type'
import { DATA_COMPONENTS } from './library/data'

export const COMPONENT_DEFS: ReadonlyArray<ComponentDef> = [...TYPE_COMPONENTS, ...DATA_COMPONENTS]
