import { ReactElement, useCallback, useRef, useState } from "react"
import { useBeforeUnload, useBlocker } from "react-router-dom"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type UnsavedChangesGuardOptions = {
  title?: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
}

const DEFAULT_TITLE = "Discard unsaved changes?"
const DEFAULT_DESCRIPTION =
  "Your changes haven\u2019t been saved yet. If you leave now they\u2019ll be lost."
const DEFAULT_CONFIRM_LABEL = "Discard changes"
const DEFAULT_CANCEL_LABEL = "Keep editing"
const BEFORE_UNLOAD_MESSAGE =
  "You have unsaved changes. Leave without saving them?"

export function useUnsavedChangesGuard(
  isDirty: boolean,
  options: UnsavedChangesGuardOptions = {},
) {
  const {
    title = DEFAULT_TITLE,
    description = DEFAULT_DESCRIPTION,
    confirmLabel = DEFAULT_CONFIRM_LABEL,
    cancelLabel = DEFAULT_CANCEL_LABEL,
  } = options

  // Browser-level guard: warns on tab close / hard reload / external nav.
  useBeforeUnload(
    useCallback(
      (event: BeforeUnloadEvent) => {
        if (!isDirty) {
          return
        }

        event.preventDefault()
        event.returnValue = BEFORE_UNLOAD_MESSAGE
      },
      [isDirty],
    ),
    { capture: true },
  )

  // Router-level guard: intercepts in-app SPA navigation (link clicks,
  // navigate(), back/forward) and prompts before leaving.
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      isDirty && currentLocation.pathname !== nextLocation.pathname,
  )

  const [pendingAction, setPendingAction] = useState<{ run: () => void } | null>(
    null,
  )

  // Radix's AlertDialogAction / AlertDialogCancel auto-close the dialog after
  // their click handlers run, which then fires `onOpenChange(false)`. Without a
  // guard, that follow-up close would re-enter the cancel logic right after a
  // confirmation and call `blocker.reset()`, undoing the navigation we just
  // proceeded with. This ref skips that one extra cancel after a confirm.
  const justResolvedRef = useRef(false)

  const open = blocker.state === "blocked" || pendingAction !== null

  const handleConfirm = useCallback(() => {
    justResolvedRef.current = true
    if (pendingAction) {
      pendingAction.run()
      setPendingAction(null)
    }
    if (blocker.state === "blocked") {
      blocker.proceed()
    }
  }, [blocker, pendingAction])

  const handleCancel = useCallback(() => {
    if (justResolvedRef.current) {
      justResolvedRef.current = false
      return
    }
    if (pendingAction) {
      setPendingAction(null)
    }
    if (blocker.state === "blocked") {
      blocker.reset()
    }
  }, [blocker, pendingAction])

  const confirmDiscardChanges = useCallback(
    (onConfirm: () => void) => {
      if (!isDirty) {
        onConfirm()
        return
      }
      setPendingAction({ run: onConfirm })
    },
    [isDirty],
  )

  const dialog: ReactElement = (
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          handleCancel()
        }
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={handleCancel}>
            {cancelLabel}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirm}
            className={cn(
              buttonVariants({ variant: "destructive" }),
            )}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )

  return {
    confirmDiscardChanges,
    isDirty,
    dialog,
  }
}
