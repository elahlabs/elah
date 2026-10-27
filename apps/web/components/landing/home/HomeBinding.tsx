import { MotionBindingDemo } from '@/components/motion/MotionBindingDemo'
import { Section } from './Section'
import { Sel } from '@/components/eb'

/** Keyframe binding explainer (brief section 5 item 4, section 6.2). */
export function HomeBinding() {
  return (
    <Section
      n={2} scene="Bind" kicker="Keys, not pixels"
      id="binding"
      title={<>The motion is <Sel>bound</Sel> to the timeline.</>}
      intro="Code, or a model, describes the motion, and elah lands it as keyframes: not a video, not a black-box layer. Every animated property is a channel on a clip, so it can be inspected, retimed, split and diffed like any other data. Hover a row under Keys to jump to that key."
    >
      <MotionBindingDemo />
    </Section>
  )
}
