import { useEffect } from "react"
import { useBeforeUnload, useBlocker } from "react-router-dom"

export function useUnsavedChangesGuard(
  isDirty: boolean,
  message = "You have unsaved changes. Leave without saving them?",
) {
  // Browser-level guard: warns on tab close / hard reload / external nav.
  useBeforeUnload(
    (event) => {
      if (!isDirty) {
        return
      }

      event.preventDefault()
      event.returnValue = message
    },
    { capture: true },
  )

  // Router-level guard: intercepts in-app SPA navigation (link clicks,
  // navigate(), back/forward) and prompts before leaving.
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      isDirty && currentLocation.pathname !== nextLocation.pathname,
  )

  useEffect(() => {
    if (blocker.state !== "blocked") {
      return
    }

    if (window.confirm(message)) {
      blocker.proceed()
    } else {
      blocker.reset()
    }
  }, [blocker, message])

  function confirmDiscardChanges() {
    return !isDirty || window.confirm(message)
  }

  return {
    confirmDiscardChanges,
    isDirty,
  }
}
