const rawApiOrigin =
  (import.meta as ImportMeta & { env?: { VITE_API_ORIGIN?: string } }).env?.VITE_API_ORIGIN?.trim() ?? ""

export const apiOrigin = rawApiOrigin.replace(/\/+$/, "")

export function apiUrl(path: string) {
  if (!apiOrigin) {
    return path
  }

  return `${apiOrigin}${path.startsWith("/") ? path : `/${path}`}`
}

export function apiBasePath(path: string) {
  return apiUrl(path)
}
