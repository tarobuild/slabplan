const rawApiOrigin = import.meta.env.VITE_API_ORIGIN?.trim() ?? ""

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
