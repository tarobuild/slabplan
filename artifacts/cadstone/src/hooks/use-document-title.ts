import { useEffect } from "react"

const APP_SUFFIX = "CAD Stone Networks"

/**
 * Sets `document.title` to `"<title> · CAD Stone Networks"` while the
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
    document.title = trimmed ? `${trimmed} · ${APP_SUFFIX}` : APP_SUFFIX

    return () => {
      document.title = previous
    }
  }, [title])
}
