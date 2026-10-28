'use client'

import dynamic from 'next/dynamic'
import { useEffect, useState } from 'react'
import { LoadOnView } from '@/components/motion/LoadOnView'
import { loadDemoProject, type DemoName } from '@/lib/demos/load'
import type { Project } from '@elah/core'
import type { DemoPlayerProps } from './DemoPlayer'

const DemoPlayer = dynamic(() => import('./DemoPlayer'), { ssr: false })

type Props = Omit<DemoPlayerProps, 'project'> & {
  /** A prebuilt demo, or a project you pass yourself. */
  name?: DemoName
  project?: Project
  /** Height reserved before the engine loads, so the page does not jump. */
  minHeight?: number
  eager?: boolean
}

function Loaded({ name, project, ...rest }: Props) {
  const [p, setP] = useState<Project | null>(project ?? null)
  useEffect(() => {
    if (project) setP(project)
    else if (name) void loadDemoProject(name).then(setP)
  }, [name, project])
  return p ? <DemoPlayer project={p} {...rest} /> : null
}

/** Loads the engine and the project only when the demo scrolls near the viewport. */
export function LazyDemo({ minHeight = 220, eager, ...props }: Props) {
  const placeholder = (
    <div aria-hidden className="bg-[#170F10]" style={{ minHeight }} />
  )
  if (eager) return <Loaded {...props} />
  return (
    <LoadOnView placeholder={placeholder}>
      <Loaded {...props} />
    </LoadOnView>
  )
}
