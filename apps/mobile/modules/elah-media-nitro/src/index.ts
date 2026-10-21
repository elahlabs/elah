import { NitroModules } from 'react-native-nitro-modules'
import type { FrameSpike } from './specs/FrameSpike.nitro'

export type { FrameSpike }

export function createFrameSpike(): FrameSpike {
  return NitroModules.createHybridObject<FrameSpike>('FrameSpike')
}
