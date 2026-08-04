export const getLatencySampleIndexAtPointer = (
  clientX: number,
  left: number,
  width: number,
  itemCount: number,
): number | null => {
  if (
    !Number.isFinite(clientX) ||
    !Number.isFinite(left) ||
    !Number.isFinite(width) ||
    !Number.isFinite(itemCount) ||
    width <= 0 ||
    itemCount <= 0
  ) {
    return null
  }

  const ratio = Math.max(0, Math.min(1, (clientX - left) / width))

  return Math.min(itemCount - 1, Math.floor(ratio * itemCount))
}
