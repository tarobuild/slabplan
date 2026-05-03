import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { api } from "@/lib/api"

export function useClientFilterFromUrl(): string | null {
  if (typeof window === "undefined") return null
  const sp = new URLSearchParams(window.location.search)
  const cid = sp.get("client")
  return cid && cid.length > 0 ? cid : null
}

export function ClientFilterChip({
  clientId,
  clearTo,
}: {
  clientId: string
  clearTo: string
}) {
  const [name, setName] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    api
      .get(`/clients/${clientId}`)
      .then((r) => {
        if (!cancelled) setName(r.data?.client?.companyName ?? null)
      })
      .catch(() => {
        if (!cancelled) setName(null)
      })
    return () => {
      cancelled = true
    }
  }, [clientId])
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-orange-200 bg-orange-50 px-3 py-1 text-xs font-medium text-orange-700">
      Client: {name ?? "Loading…"}
      <Link
        to={clearTo}
        aria-label="Clear client filter"
        className="ml-1 text-orange-700 hover:text-orange-900"
      >
        ×
      </Link>
    </span>
  )
}
