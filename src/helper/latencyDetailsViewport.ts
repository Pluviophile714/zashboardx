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
  left: number
  right: number
  top: number
}

export type DesktopLatencyDetailsPlacement = 'top' | 'bottom' | 'right' | 'left'

export const getLatencyDetailsViewportSize = (
  layoutWidth: number,
  layoutHeight: number,
  visualViewport?: VisualViewportSize | null,
): LatencyDetailsViewportSize => ({
  height: visualViewport?.height || layoutHeight,
  width: visualViewport?.width || layoutWidth,
})

export const getCompactLatencyDetailsPlacement = (
  anchor: Pick<LatencyDetailsAnchorBounds, 'bottom' | 'top'>,
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

export const getDesktopLatencyDetailsPlacement = (
  anchor: LatencyDetailsAnchorBounds,
  viewport: LatencyDetailsViewportSize,
  contentWidth: number,
  padding: number,
  lockedPlacement?: DesktopLatencyDetailsPlacement,
) => {
  const availableAbove = Math.max(0, anchor.top - padding)
  const availableBelow = Math.max(0, viewport.height - anchor.bottom - padding)
  const availableLeft = Math.max(0, anchor.left - padding)
  const availableRight = Math.max(0, viewport.width - anchor.right - padding)
  const placement =
    lockedPlacement ??
    (availableRight >= contentWidth
      ? 'right'
      : availableLeft >= contentWidth
        ? 'left'
        : availableAbove >= availableBelow
          ? 'top'
          : 'bottom')
  const maxHeight =
    placement === 'top'
      ? availableAbove
      : placement === 'bottom'
        ? availableBelow
        : viewport.height - padding * 2

  return {
    placement,
    maxHeight: Math.floor(maxHeight),
  } as const
}
