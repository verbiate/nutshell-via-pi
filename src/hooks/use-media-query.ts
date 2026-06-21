import { useCallback, useSyncExternalStore } from "react"

// ponytail: useSyncExternalStore is the textbook shape for matchMedia — no
// mount-time setState cascade, SSR-safe by default (returns false on server).
export function useMediaQuery(query: string) {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mql = window.matchMedia(query)
      mql.addEventListener("change", onChange)
      return () => mql.removeEventListener("change", onChange)
    },
    [query],
  )
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  )
}
