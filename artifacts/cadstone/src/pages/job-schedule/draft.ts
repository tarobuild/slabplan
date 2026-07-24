import {
  DEFAULT_SCHEDULE_COLOR,
  addBusinessDays,
  calculateBusinessEndDate,
  classifyWorkday,
  dateKey,
  deriveScheduleStatus,
  type ScheduleItemPayload,
  type ScheduleItemRecord,
  type ScheduleSettings,
  type ScheduleWorkdayException,
} from "@/lib/schedule"
import type { AppUser } from "./types"

export function isDraftScheduleItemId(id: string) {
  return id.startsWith("draft-item-")
}

export function isDraftScheduleNoteId(id: string) {
  return id.startsWith("draft-note-")
}

export function cloneScheduleItems(items: ScheduleItemRecord[]) {
  return items.map((item) => ({
    ...item,
    tags: [...item.tags],
    assigneeIds: [...item.assigneeIds],
    assignees: item.assignees.map((assignee) => ({ ...assignee })),
    predecessors: item.predecessors.map((predecessor) => ({ ...predecessor })),
    notesStream: item.notesStream.map((note) => ({ ...note })),
    attachments: item.attachments.map((attachment) => ({ ...attachment })),
    relatedTodos: item.relatedTodos.map((todo) => ({ ...todo })),
    conflictReasons: item.conflictReasons ? [...item.conflictReasons] : [],
  }))
}

export function schedulePayloadFromItem(item: ScheduleItemRecord): ScheduleItemPayload {
  return {
    title: item.title,
    displayColor: item.displayColor || DEFAULT_SCHEDULE_COLOR,
    assigneeIds: [...item.assigneeIds].sort(),
    startDate: item.startDate,
    workDays: Math.max(item.workDays, 1),
    endDate: null,
    isHourly: !!item.isHourly,
    startTime: item.isHourly ? item.startTime : null,
    endTime: item.isHourly ? item.endTime : null,
    progress: Math.max(0, Math.min(100, item.progress ?? 0)),
    reminder: item.reminder || "none",
    notes: item.notes ?? null,
    notifyUserIds: [],
    tags: [...item.tags].sort((left, right) => left.localeCompare(right)),
    predecessors: item.predecessors
      .map((predecessor) => ({
        scheduleItemId: predecessor.scheduleItemId,
        dependencyType: predecessor.dependencyType,
        lagDays: predecessor.lagDays,
      }))
      .sort((left, right) => {
        if (left.scheduleItemId !== right.scheduleItemId) {
          return left.scheduleItemId.localeCompare(right.scheduleItemId)
        }

        if (left.dependencyType !== right.dependencyType) {
          return left.dependencyType.localeCompare(right.dependencyType)
        }

        return left.lagDays - right.lagDays
      }),
    phaseId: item.phaseId,
    showOnGantt: item.showOnGantt ?? true,
    visibleToEstimators: item.visibleToEstimators ?? true,
    visibleToInstallers: item.visibleToInstallers ?? true,
    visibleToOfficeStaff: item.visibleToOfficeStaff ?? true,
    isComplete: item.isComplete ?? false,
  }
}

function schedulePayloadSignature(item: ScheduleItemRecord) {
  return JSON.stringify(schedulePayloadFromItem(item))
}

export function scheduleDraftSignature(item: ScheduleItemRecord) {
  return JSON.stringify({
    payload: schedulePayloadFromItem(item),
    draftNotes: item.notesStream
      .filter((note) => isDraftScheduleNoteId(note.id))
      .map((note) => note.note),
  })
}

function calculateBusinessStartDateForEndDate(
  endDate: string,
  workDays: number,
  exceptions: ScheduleWorkdayException[],
) {
  const current = new Date(`${endDate}T00:00:00`)

  while (!classifyWorkday(current, exceptions).isWorkday) {
    current.setDate(current.getDate() - 1)
  }

  let remaining = Math.max(workDays, 1)

  while (remaining > 1) {
    current.setDate(current.getDate() - 1)

    if (classifyWorkday(current, exceptions).isWorkday) {
      remaining -= 1
    }
  }

  return dateKey(current)
}

function resolveDraftPredecessorStartDate(
  startDate: string,
  workDays: number,
  predecessors: ScheduleItemPayload["predecessors"],
  predecessorMap: Map<string, { startDate: string; endDate: string }>,
  workdayExceptions: ScheduleWorkdayException[],
) {
  let resolvedStartDate = startDate

  for (const predecessor of predecessors) {
    const linked = predecessorMap.get(predecessor.scheduleItemId)

    if (!linked) {
      continue
    }

    if (predecessor.dependencyType === "finish_to_start") {
      const candidate = addBusinessDays(linked.endDate, predecessor.lagDays + 1, workdayExceptions)
      if (candidate > resolvedStartDate) {
        resolvedStartDate = candidate
      }
      continue
    }

    if (predecessor.dependencyType === "start_to_start") {
      const candidate = addBusinessDays(linked.startDate, predecessor.lagDays, workdayExceptions)
      if (candidate > resolvedStartDate) {
        resolvedStartDate = candidate
      }
      continue
    }

    if (predecessor.dependencyType === "finish_to_finish") {
      const desiredEnd = addBusinessDays(linked.endDate, predecessor.lagDays, workdayExceptions)
      const currentEnd = calculateBusinessEndDate(resolvedStartDate, Math.max(workDays, 1), workdayExceptions)
      if (currentEnd >= desiredEnd) {
        continue
      }
      const candidateStart = calculateBusinessStartDateForEndDate(
        desiredEnd,
        Math.max(workDays, 1),
        workdayExceptions,
      )
      if (candidateStart > resolvedStartDate) {
        resolvedStartDate = candidateStart
      }
      continue
    }

    const desiredEnd = addBusinessDays(linked.startDate, predecessor.lagDays, workdayExceptions)
    const currentEnd = calculateBusinessEndDate(resolvedStartDate, Math.max(workDays, 1), workdayExceptions)
    if (currentEnd >= desiredEnd) {
      continue
    }
    const candidateStart = calculateBusinessStartDateForEndDate(
      desiredEnd,
      Math.max(workDays, 1),
      workdayExceptions,
    )
    if (candidateStart > resolvedStartDate) {
      resolvedStartDate = candidateStart
    }
  }

  return resolvedStartDate
}

function draftConflictReasons(
  item: Pick<ScheduleItemRecord, "title" | "startDate" | "endDate" | "predecessors">,
  predecessorMap: Map<string, { title: string; startDate: string; endDate: string }>,
  workdayExceptions: ScheduleWorkdayException[],
) {
  const reasons: string[] = []

  for (const predecessor of item.predecessors) {
    const linked = predecessorMap.get(predecessor.scheduleItemId)

    if (!linked) {
      continue
    }

    if (predecessor.dependencyType === "finish_to_start") {
      const requiredStart = addBusinessDays(linked.endDate, predecessor.lagDays + 1, workdayExceptions)
      if (item.startDate < requiredStart) {
        reasons.push(`${item.title} starts before ${linked.title} finishes`)
      }
      continue
    }

    if (predecessor.dependencyType === "start_to_start") {
      const requiredStart = addBusinessDays(linked.startDate, predecessor.lagDays, workdayExceptions)
      if (item.startDate < requiredStart) {
        reasons.push(`${item.title} starts before ${linked.title} is allowed to start it`)
      }
      continue
    }

    if (predecessor.dependencyType === "finish_to_finish") {
      const requiredEnd = addBusinessDays(linked.endDate, predecessor.lagDays, workdayExceptions)
      if (item.endDate < requiredEnd) {
        reasons.push(`${item.title} finishes before ${linked.title} requirement is met`)
      }
      continue
    }

    const requiredEnd = addBusinessDays(linked.startDate, predecessor.lagDays, workdayExceptions)
    if (item.endDate < requiredEnd) {
      reasons.push(`${item.title} finishes before ${linked.title} start dependency is met`)
    }
  }

  return reasons
}

function findDependencyCycleItemIds(items: ScheduleItemRecord[]) {
  const itemIds = new Set(items.map((item) => item.id))
  const graph = new Map(
    items.map((item) => [
      item.id,
      item.predecessors
        .map((predecessor) => predecessor.scheduleItemId)
        .filter((id) => itemIds.has(id)),
    ]),
  )
  const cycleIds = new Set<string>()
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const stack: string[] = []

  function visit(id: string) {
    if (visiting.has(id)) {
      const cycleStart = stack.indexOf(id)
      for (const cycleId of stack.slice(cycleStart)) {
        cycleIds.add(cycleId)
      }
      return
    }

    if (visited.has(id)) {
      return
    }

    visiting.add(id)
    stack.push(id)

    for (const predecessorId of graph.get(id) ?? []) {
      visit(predecessorId)
    }

    stack.pop()
    visiting.delete(id)
    visited.add(id)
  }

  for (const id of itemIds) {
    visit(id)
  }

  return cycleIds
}

export function normalizeDraftScheduleItems(
  items: ScheduleItemRecord[],
  users: AppUser[],
  settings: ScheduleSettings,
  workdayExceptions: ScheduleWorkdayException[],
) {
  const userMap = new Map(users.map((user) => [user.id, user]))
  const phaseMap = new Map(settings.phases.map((phase) => [phase.id, phase]))
  let normalized = cloneScheduleItems(items).map((item) => ({
    ...item,
    displayColor: item.displayColor || DEFAULT_SCHEDULE_COLOR,
    workDays: Math.max(item.workDays, 1),
    progress: Math.max(0, Math.min(100, item.progress ?? 0)),
    isHourly: !!item.isHourly,
    startTime: item.isHourly ? item.startTime || "08:00" : null,
    reminder: item.reminder || "none",
    showOnGantt: item.showOnGantt ?? true,
    visibleToEstimators: item.visibleToEstimators ?? true,
    visibleToInstallers: item.visibleToInstallers ?? true,
    visibleToOfficeStaff: item.visibleToOfficeStaff ?? true,
    isComplete: item.isComplete ?? false,
    tags: [...item.tags],
    assigneeIds: Array.from(new Set(item.assigneeIds)),
    predecessors: item.predecessors.map((predecessor) => ({
      ...predecessor,
      lagDays: Math.max(0, predecessor.lagDays),
    })),
  }))
  const cycleItemIds = findDependencyCycleItemIds(normalized)

  for (let pass = 0; pass < Math.max(normalized.length * 2, 1); pass += 1) {
    const predecessorMap = new Map(
      normalized.map((item) => [
        item.id,
        {
          startDate: item.startDate,
          endDate: item.endDate,
        },
      ]),
    )

    let changed = false

    normalized = normalized.map((item) => {
      if (cycleItemIds.has(item.id)) {
        return item
      }

      const nextStartDate = item.predecessors.length > 0
        ? resolveDraftPredecessorStartDate(
            item.startDate,
            item.workDays,
            item.predecessors.map((predecessor) => ({
              scheduleItemId: predecessor.scheduleItemId,
              dependencyType: predecessor.dependencyType,
              lagDays: predecessor.lagDays,
            })),
            predecessorMap,
            workdayExceptions,
          )
        : item.startDate
      const nextEndDate = calculateBusinessEndDate(nextStartDate, item.workDays, workdayExceptions)

      if (nextStartDate !== item.startDate || nextEndDate !== item.endDate) {
        changed = true
      }

      return {
        ...item,
        startDate: nextStartDate,
        endDate: nextEndDate,
      }
    })

    if (!changed) {
      break
    }
  }

  const normalizedMap = new Map(
    normalized.map((item) => [
      item.id,
      {
        title: item.title,
        startDate: item.startDate,
        endDate: item.endDate,
      },
    ]),
  )

  return normalized.map((item) => {
    const phase = item.phaseId ? phaseMap.get(item.phaseId) : null
    const assignees = item.assigneeIds
      .map((assigneeId) => userMap.get(assigneeId))
      .filter((assignee): assignee is AppUser => !!assignee)
      .map((assignee) => ({
        id: assignee.id,
        fullName: assignee.fullName,
        email: assignee.email,
        role: assignee.role,
        avatarUrl: assignee.avatarUrl,
      }))
    const predecessors = item.predecessors.map((predecessor) => ({
      ...predecessor,
      title: normalizedMap.get(predecessor.scheduleItemId)?.title || predecessor.title || "Unknown task",
    }))
    const conflictReasons = [
      ...(cycleItemIds.has(item.id)
        ? [`${item.title} has a circular dependency`]
        : []),
      ...draftConflictReasons(
        {
          title: item.title,
          startDate: item.startDate,
          endDate: item.endDate,
          predecessors,
        },
        normalizedMap,
        workdayExceptions,
      ),
    ]

    return {
      ...item,
      phaseName: phase?.name ?? null,
      phaseColor: phase?.color ?? null,
      assignees,
      predecessors,
      noteCount: item.notesStream.length,
      relatedTodoCount: item.relatedTodos.length,
      status: deriveScheduleStatus({
        startDate: item.startDate,
        endDate: item.endDate,
        progress: item.progress ?? 0,
        isComplete: item.isComplete ?? false,
      }),
      hasConflict: conflictReasons.length > 0,
      conflictReasons,
    }
  })
}
