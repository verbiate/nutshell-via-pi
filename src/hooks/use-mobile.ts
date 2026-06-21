import { useCallback, useSyncExternalStore } from "react"

const MOBILE_BREAKPOINT = 768

// ponytail: useSyncExternalStore is the textbook shape for matchMedia — no
// mount-time setState cascade, SSR-safe by default (returns false on server).
export function useIsMobile() {
  const subscribe = useCallback((onChange: () => void) => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    mql.addEventListener("change", onChange)
    return () => mql.removeEventListener("change", onChange)
  }, [])
  return useSyncExternalStore(
    subscribe,
    () => window.innerWidth < MOBILE_BREAKPOINT,
    () => false,
  )
}
