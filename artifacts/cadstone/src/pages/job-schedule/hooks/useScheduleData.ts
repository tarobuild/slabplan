import { useEffect, useRef, useState } from "react"
import {
  scheduleGetJobsJobIdSchedule,
  type ScheduleListResponsePagination,
} from "@workspace/api-client-react"
import { api } from "@/lib/api"
import {
  type ScheduleBaselineRecord,
  type ScheduleItemRecord,
  type ScheduleSettings,
  type ScheduleWorkdayException,
} from "@/lib/schedule"
import { toastApiError } from "@/lib/api-errors"
import { DEFAULT_SETTINGS } from "../constants"
import { applyDefaultViewChoice, buildSettingsForm } from "../filters"
import type {
  ActivityEntry,
  AppUser,
  CalendarPeriod,
  JobOption,
  ScheduleSettingsForm,
  ViewMode,
} from "../types"

type Setter<T> = React.Dispatch<React.SetStateAction<T>>
type OffsetSchedulePagination = Extract<
  ScheduleListResponsePagination,
  { totalPages: number; totalItems: number }
>

interface UseScheduleDataOptions {
  jobId: string | undefined
  setViewMode: Setter<ViewMode>
  setCalendarPeriod: Setter<CalendarPeriod>
  onItemsFetched: (items: ScheduleItemRecord[]) => void
  historyOpen: boolean
}

function requireOffsetSchedulePagination(
  pagination: ScheduleListResponsePagination,
): OffsetSchedulePagination {
  if ("totalPages" in pagination && "totalItems" in pagination) {
    return pagination
  }
  throw new Error("Schedule page request returned cursor pagination.")
}

export function useScheduleData({
  jobId,
  setViewMode,
  setCalendarPeriod,
  onItemsFetched,
  historyOpen,
}: UseScheduleDataOptions) {
  const [items, setItems] = useState<ScheduleItemRecord[]>([])
  const [itemsTotal, setItemsTotal] = useState(0)
  const [users, setUsers] = useState<AppUser[]>([])
  const [jobs, setJobs] = useState<JobOption[]>([])
  const [settings, setSettings] = useState<ScheduleSettings>(DEFAULT_SETTINGS)
  const [settingsForm, setSettingsForm] = useState<ScheduleSettingsForm>(() => buildSettingsForm(DEFAULT_SETTINGS))
  const [baseline, setBaseline] = useState<ScheduleBaselineRecord | null>(null)
  const [workdayExceptions, setWorkdayExceptions] = useState<ScheduleWorkdayException[]>([])
  const [editingCategories, setEditingCategories] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyEntries, setHistoryEntries] = useState<ActivityEntry[]>([])

  const appliedDefaultViewRef = useRef(false)
  const onItemsFetchedRef = useRef(onItemsFetched)
  const currentJobIdRef = useRef(jobId)

  currentJobIdRef.current = jobId

  function isCurrentJob(requestJobId: string) {
    return currentJobIdRef.current === requestJobId
  }

  useEffect(() => {
    onItemsFetchedRef.current = onItemsFetched
  }, [onItemsFetched])

  async function fetchItems() {
    const requestJobId = jobId
    if (!requestJobId) {
      return
    }

    const collected: ScheduleItemRecord[] = []
    const pageSize = 500
    let page = 1
    let totalPages = 1
    let totalItems = 0
    while (page <= totalPages && page <= 20) {
      const response = await scheduleGetJobsJobIdSchedule(requestJobId, {
        page,
        limit: pageSize,
      })
      collected.push(...((response.data ?? []) as unknown as ScheduleItemRecord[]))
      const pagination = requireOffsetSchedulePagination(response.pagination)
      totalPages = pagination.totalPages
      totalItems = pagination.totalItems
      page += 1
    }
    if (!isCurrentJob(requestJobId)) {
      return
    }
    const nextItems = collected
    setItems(nextItems)
    setItemsTotal(totalItems)
    onItemsFetchedRef.current(nextItems)
  }

  async function fetchBaseline() {
    const requestJobId = jobId
    if (!requestJobId) {
      return
    }

    const response = await api.get<{ baseline: ScheduleBaselineRecord | null }>(`/jobs/${requestJobId}/schedule/baseline`)
    if (!isCurrentJob(requestJobId)) {
      return
    }
    setBaseline(response.data.baseline ?? null)
  }

  async function fetchWorkdayExceptions() {
    const requestJobId = jobId
    if (!requestJobId) {
      return
    }

    const response = await api.get<{ exceptions: ScheduleWorkdayException[] }>(`/jobs/${requestJobId}/workday-exceptions`)
    if (!isCurrentJob(requestJobId)) {
      return
    }
    setWorkdayExceptions(response.data.exceptions ?? [])
  }

  async function fetchSettings() {
    const requestJobId = jobId
    if (!requestJobId) {
      return
    }

    const response = await api.get<ScheduleSettings>(`/jobs/${requestJobId}/schedule/settings`)
    if (!isCurrentJob(requestJobId)) {
      return
    }
    const nextSettings: ScheduleSettings = {
      ...DEFAULT_SETTINGS,
      ...response.data,
      phases: response.data.phases ?? [],
      tags: response.data.tags ?? [],
      workdayExceptionCategories: response.data.workdayExceptionCategories ?? [],
    }
    setSettings(nextSettings)
    setSettingsForm(buildSettingsForm(nextSettings))
    setEditingCategories(
      Object.fromEntries((nextSettings.workdayExceptionCategories ?? []).map((category) => [category.id, category.name])),
    )

    if (!appliedDefaultViewRef.current) {
      applyDefaultViewChoice(nextSettings.defaultView, setViewMode, setCalendarPeriod)
      appliedDefaultViewRef.current = true
    }
  }

  async function fetchUsers() {
    try {
      const response = await api.get<{ users: AppUser[] }>("/users", {
        suppressForbiddenRedirect: true,
      })
      setUsers(response.data.users ?? [])
    } catch {
      // Crew members lack permission to list all users; that's fine —
      // they don't need the assignee picker, so just leave the list empty.
      setUsers([])
    }
  }

  async function fetchJobs() {
    const response = await api.get<{ jobs: JobOption[] }>("/jobs", {
      params: {
        page: 1,
        pageSize: 100,
      },
    })
    setJobs(response.data.jobs ?? [])
  }

  async function fetchHistory() {
    const requestJobId = jobId
    if (!requestJobId) {
      return
    }

    setHistoryLoading(true)

    try {
      const response = await api.get<{ data: ActivityEntry[] }>(`/activity?jobId=${requestJobId}&page=1&limit=100`)
      if (!isCurrentJob(requestJobId)) {
        return
      }
      setHistoryEntries(
        (response.data.data ?? []).filter((entry) => entry.entityType.startsWith("schedule_")),
      )
    } catch (err) {
      if (isCurrentJob(requestJobId)) {
        toastApiError(err, "Failed to load schedule history")
      }
    } finally {
      if (isCurrentJob(requestJobId)) {
        setHistoryLoading(false)
      }
    }
  }

  async function loadData() {
    const requestJobId = jobId
    if (!requestJobId) {
      return
    }

    setLoading(true)

    try {
      await Promise.all([fetchItems(), fetchUsers(), fetchJobs(), fetchSettings(), fetchBaseline(), fetchWorkdayExceptions()])
    } catch (err) {
      if (isCurrentJob(requestJobId)) {
        toastApiError(err, "Failed to load schedule")
      }
    } finally {
      if (isCurrentJob(requestJobId)) {
        setLoading(false)
      }
    }
  }

  async function refreshScheduleData() {
    await Promise.all([fetchItems(), fetchBaseline(), fetchWorkdayExceptions()])

    if (historyOpen) {
      await fetchHistory()
    }
  }

  useEffect(() => {
    void loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId])

  useEffect(() => {
    if (historyOpen) {
      void fetchHistory()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyOpen, jobId])

  return {
    items,
    setItems,
    itemsTotal,
    users,
    setUsers,
    jobs,
    setJobs,
    settings,
    setSettings,
    settingsForm,
    setSettingsForm,
    baseline,
    setBaseline,
    workdayExceptions,
    setWorkdayExceptions,
    editingCategories,
    setEditingCategories,
    loading,
    setLoading,
    historyLoading,
    historyEntries,
    fetchItems,
    fetchSettings,
    fetchHistory,
    refreshScheduleData,
  }
}
