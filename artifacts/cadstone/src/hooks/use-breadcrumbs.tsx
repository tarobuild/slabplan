import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"

export type BreadcrumbItem = {
  label: string
  to?: string
}

type BreadcrumbsContextValue = {
  override: BreadcrumbItem[] | null
  setOverride: (items: BreadcrumbItem[] | null) => void
}

const BreadcrumbsContext = createContext<BreadcrumbsContextValue | null>(null)

export function BreadcrumbsProvider({ children }: { children: ReactNode }) {
  const [override, setOverride] = useState<BreadcrumbItem[] | null>(null)
  const value = useMemo(() => ({ override, setOverride }), [override])
  return (
    <BreadcrumbsContext.Provider value={value}>
      {children}
    </BreadcrumbsContext.Provider>
  )
}

function useBreadcrumbsContext(): BreadcrumbsContextValue {
  const ctx = useContext(BreadcrumbsContext)
  if (!ctx) {
    throw new Error("useBreadcrumbs must be used inside BreadcrumbsProvider")
  }
  return ctx
}

/**
 * Pages can call this hook to override the auto-derived breadcrumbs
 * (e.g. inject a real client / job name once the data has loaded).
 * The override is cleared automatically on unmount.
 */
export function useSetBreadcrumbs(items: BreadcrumbItem[] | null): void {
  const { setOverride } = useBreadcrumbsContext()
  // Stable JSON key so the effect doesn't churn for identical inputs.
  const key = items === null ? null : JSON.stringify(items)
  useEffect(() => {
    setOverride(items)
    return () => setOverride(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
}

export function useBreadcrumbsOverride(): BreadcrumbItem[] | null {
  return useBreadcrumbsContext().override
}

export function useClearBreadcrumbs(): () => void {
  const { setOverride } = useBreadcrumbsContext()
  return useCallback(() => setOverride(null), [setOverride])
}
