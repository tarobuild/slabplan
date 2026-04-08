import { useEffect } from "react"
import { useBeforeUnload, useBlocker } from "react-router-dom"

export function useUnsavedChangesGuard(
  isDirty: boolean,
  message = "You have unsaved changes. Leave without saving them?",
) {
  const blocker = useBlocker(isDirty)

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

  useEffect(() => {
    if (blocker.state !== "blocked") {
      return
    }

    if (window.confirm(message)) {
      blocker.proceed()
      return
    }

    blocker.reset()
  }, [blocker, message])

  function confirmDiscardChanges() {
    return !isDirty || window.confirm(message)
  }

  return {
    confirmDiscardChanges,
    isDirty,
  }
}
