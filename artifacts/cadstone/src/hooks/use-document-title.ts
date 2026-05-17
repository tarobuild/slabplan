import { useEffect } from "react"
import { APP_NAME } from "@/lib/brand"

/**
 * Sets `document.title` to `"<title> · SlabPlan"` while the
 * calling component is mounted. Restores the previous title on unmount
 * so stale page titles don't leak between route transitions when the
 * next page is a tick slow to mount.
 *
 * Pass a falsy value to render the bare app suffix.
 */
export function useDocumentTitle(title: string | null | undefined) {
  useEffect(() => {
    const previous = document.title
    const trimmed = title?.trim()
    document.title = trimmed ? `${trimmed} · ${APP_NAME}` : APP_NAME

    return () => {
      document.title = previous
    }
  }, [title])
}
