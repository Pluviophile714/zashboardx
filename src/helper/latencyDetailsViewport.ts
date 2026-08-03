export type LatencyDetailsViewportSize = {
  height: number
  width: number
}

type VisualViewportSize = {
  height: number
  width: number
}

type LatencyDetailsAnchorBounds = {
  bottom: number
  top: number
}

export const getLatencyDetailsViewportSize = (
  layoutWidth: number,
  layoutHeight: number,
  visualViewport?: VisualViewportSize | null,
): LatencyDetailsViewportSize => ({
  height: visualViewport?.height || layoutHeight,
  width: visualViewport?.width || layoutWidth,
})

export const getCompactLatencyDetailsPlacement = (
  anchor: LatencyDetailsAnchorBounds,
  viewport: LatencyDetailsViewportSize,
  padding: number,
  gap: number,
) => {
  const availableAbove = Math.max(0, anchor.top - padding - gap)
  const availableBelow = Math.max(0, viewport.height - anchor.bottom - padding - gap)
  const placement = availableBelow >= availableAbove ? 'bottom' : 'top'

  return {
    placement,
    maxHeight: Math.floor(placement === 'bottom' ? availableBelow : availableAbove),
  } as const
}
