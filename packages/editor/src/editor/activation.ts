import { useCallback, useContext } from 'react'
import { EditorContext, type MediaAsset } from '@elah/core'
import {
  insertElement,
  insertMediaAsset,
  type DragElementPayload,
  type ElementKind,
  type InsertAssetResult,
  type ShapeVariant,
} from '@elah/timeline'

export interface ActivationToast {
  message: string
  tone: 'info' | 'warn'
}

export interface MediaActivationPayload {
  kind: 'media-asset'
  asset: MediaAsset
}

export interface ElementActivationPayload {
  kind: 'element'
  element: ElementKind
  shapeVariant?: ShapeVariant
  label: string
}

export type AssetActivationPayload = MediaActivationPayload | ElementActivationPayload
export type AssetActivationHandler = (payload: AssetActivationPayload) => void | Promise<void>

interface UseAssetActivationOptions {
  activateOnTap?: boolean
  onAssetActivate?: AssetActivationHandler
  setToast: (toast: ActivationToast) => void
}

export function isActivationKey(key: string): boolean {
  return key === 'Enter' || key === ' '
}

/**
 * Tap activation is opt-in for SDK consumers, so the engine context is read
 * directly instead of via useTimelineEngine, which would throw when disabled.
 */
export function useAssetActivation({
  activateOnTap,
  onAssetActivate,
  setToast,
}: UseAssetActivationOptions) {
  const editor = useContext(EditorContext)
  const isActive = activateOnTap === true || Boolean(onAssetActivate)

  return useCallback(
    async (payload: AssetActivationPayload) => {
      if (!isActive) return

      if (onAssetActivate) {
        await onAssetActivate(payload)
        return
      }

      const engine = editor?.engine
      if (!engine) {
        setToast({ message: 'Timeline unavailable', tone: 'warn' })
        return
      }

      const result =
        payload.kind === 'media-asset'
          ? await insertMediaAsset(engine, payload.asset.id)
          : insertElement(engine, elementPayload(payload))

      showActivationToast(payload, result, setToast)
    },
    [editor, isActive, onAssetActivate, setToast],
  )
}

function elementPayload(payload: ElementActivationPayload): DragElementPayload {
  return {
    kind: 'element',
    element: payload.element,
    shapeVariant: payload.shapeVariant,
  }
}

function showActivationToast(
  payload: AssetActivationPayload,
  result: InsertAssetResult,
  setToast: (toast: ActivationToast) => void,
) {
  if (result.ok) {
    setToast({ message: `Added ${payloadName(payload)}`, tone: 'info' })
    return
  }

  if (result.reason === 'cancelled') return

  if (result.reason === 'missing-asset') {
    setToast({ message: 'Asset unavailable', tone: 'warn' })
    return
  }

  setToast({ message: `No unlocked track for ${payloadKind(payload)}`, tone: 'warn' })
}

function payloadName(payload: AssetActivationPayload): string {
  return payload.kind === 'media-asset' ? payload.asset.name : payload.label
}

function payloadKind(payload: AssetActivationPayload): string {
  return payload.kind === 'media-asset' ? payload.asset.kind : 'element'
}
