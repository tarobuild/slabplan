import { useEffect, type MutableRefObject } from "react"

import type { ScheduleItemRecord } from "@/lib/schedule"

interface UseDraftHistoryRefsParams {
  draftItems: ScheduleItemRecord[]
  draftItemsRef: MutableRefObject<ScheduleItemRecord[]>
  draftPast: ScheduleItemRecord[][]
  draftPastRef: MutableRefObject<ScheduleItemRecord[][]>
  draftFuture: ScheduleItemRecord[][]
  draftFutureRef: MutableRefObject<ScheduleItemRecord[][]>
}

/**
 * Mirrors the draft schedule state machine (current items + past/future undo
 * stacks) into refs so that imperative drag handlers and async commits can
 * read the latest values without re-binding on every render.
 */
export function useDraftHistoryRefs({
  draftItems,
  draftItemsRef,
  draftPast,
  draftPastRef,
  draftFuture,
  draftFutureRef,
}: UseDraftHistoryRefsParams) {
  useEffect(() => {
    draftItemsRef.current = draftItems
  }, [draftItems, draftItemsRef])

  useEffect(() => {
    draftPastRef.current = draftPast
  }, [draftPast, draftPastRef])

  useEffect(() => {
    draftFutureRef.current = draftFuture
  }, [draftFuture, draftFutureRef])
}
