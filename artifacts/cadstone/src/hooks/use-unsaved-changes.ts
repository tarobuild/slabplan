import { useEffect } from "react"
import { useBeforeUnload } from "react-router-dom"

export function useUnsavedChangesGuard(
  isDirty: boolean,
  message = "You have unsaved changes. Leave without saving them?",
) {
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

  function confirmDiscardChanges() {
    return !isDirty || window.confirm(message)
  }

  return {
    confirmDiscardChanges,
    isDirty,
  }
}
