import type { Project } from '@elah/core'

export type DemoName = 'hero' | 'easing' | 'stagger' | 'text' | 'path' | 'expressions' | 'tilt' | 'effects'

/** Project JSON for a demo, loaded on demand so the page does not ship all of them up front. */
export async function loadDemoProject(name: DemoName): Promise<Project> {
  const mod = await import(`./projects/${name}.json`)
  return (mod.default ?? mod) as Project
}
