type DeferredRefreshOptions<TView> = {
  refresh: Promise<unknown>
  waitMs: number
  open: () => TView
  isActive: (view: TView) => boolean
  update: (view: TView) => void
}

export const openWithDeferredRefresh = async <TView>({
  refresh,
  waitMs,
  open,
  isActive,
  update,
}: DeferredRefreshOptions<TView>) => {
  let refreshSettled = false
  const trackedRefresh = refresh.then(
    () => {
      refreshSettled = true
      return true
    },
    () => {
      refreshSettled = true
      return false
    },
  )

  if (waitMs > 0) {
    await Promise.race([
      trackedRefresh,
      new Promise<void>((resolve) => window.setTimeout(resolve, waitMs)),
    ])
  }

  const view = open()

  if (!refreshSettled) {
    void trackedRefresh.then((succeeded) => {
      if (succeeded && isActive(view)) {
        update(view)
      }
    })
  }

  return view
}
