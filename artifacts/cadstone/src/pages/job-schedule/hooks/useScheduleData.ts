import { useEffect, useRef, useState } from "react"
import { scheduleGetJobsJobIdSchedule } from "@workspace/api-client-react"
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

interface UseScheduleDataOptions {
  jobId: string | undefined
  setViewMode: Setter<ViewMode>
  setCalendarPeriod: Setter<CalendarPeriod>
  onItemsFetched: (items: ScheduleItemRecord[]) => void
  historyOpen: boolean
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
  const latestJobIdRef = useRef(jobId)

  useEffect(() => {
    onItemsFetchedRef.current = onItemsFetched
  }, [onItemsFetched])

  useEffect(() => {
    latestJobIdRef.current = jobId
  }, [jobId])

  const isCurrentJob = (requestedJobId: string | undefined) =>
    latestJobIdRef.current === requestedJobId

  async function fetchItems() {
    const requestedJobId = jobId
    if (!requestedJobId) {
      return
    }

    const collected: ScheduleItemRecord[] = []
    const pageSize = 500
    let page = 1
    let totalPages = 1
    let totalItems = 0
    while (page <= totalPages && page <= 20) {
      const response = await scheduleGetJobsJobIdSchedule(requestedJobId, {
        page,
        limit: pageSize,
      })
      if (!isCurrentJob(requestedJobId)) return
      collected.push(...((response.data ?? []) as unknown as ScheduleItemRecord[]))
      if (response.pagination && "totalPages" in response.pagination) {
        totalPages = response.pagination.totalPages
        totalItems = response.pagination.totalItems
      } else {
        totalPages = 1
        totalItems = collected.length
      }
      page += 1
    }
    const nextItems = collected
    if (isCurrentJob(requestedJobId)) {
      setItems(nextItems)
      setItemsTotal(totalItems)
      onItemsFetchedRef.current(nextItems)
    }
  }

  async function fetchBaseline() {
    const requestedJobId = jobId
    if (!requestedJobId) {
      return
    }

    const response = await api.get<{ baseline: ScheduleBaselineRecord | null }>(`/jobs/${requestedJobId}/schedule/baseline`)
    if (isCurrentJob(requestedJobId)) {
      setBaseline(response.data.baseline ?? null)
    }
  }

  async function fetchWorkdayExceptions() {
    const requestedJobId = jobId
    if (!requestedJobId) {
      return
    }

    const response = await api.get<{ exceptions: ScheduleWorkdayException[] }>(`/jobs/${requestedJobId}/workday-exceptions`)
    if (isCurrentJob(requestedJobId)) {
      setWorkdayExceptions(response.data.exceptions ?? [])
    }
  }

  async function fetchSettings() {
    const requestedJobId = jobId
    if (!requestedJobId) {
      return
    }

    const response = await api.get<ScheduleSettings>(`/jobs/${requestedJobId}/schedule/settings`)
    if (!isCurrentJob(requestedJobId)) return
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
    const requestedJobId = jobId
    if (!requestedJobId) {
      return
    }

    setHistoryLoading(true)

    try {
      const response = await api.get<{ data: ActivityEntry[] }>(`/activity?jobId=${requestedJobId}&page=1&limit=100`)
      if (isCurrentJob(requestedJobId)) {
        setHistoryEntries(
          (response.data.data ?? []).filter((entry) => entry.entityType.startsWith("schedule_")),
        )
      }
    } catch (err) {
      if (isCurrentJob(requestedJobId)) {
        toastApiError(err, "Failed to load schedule history")
      }
    } finally {
      if (isCurrentJob(requestedJobId)) {
        setHistoryLoading(false)
      }
    }
  }

  async function loadData() {
    const requestedJobId = jobId
    if (!requestedJobId) {
      setItems([])
      setItemsTotal(0)
      onItemsFetchedRef.current([])
      setBaseline(null)
      setWorkdayExceptions([])
      setHistoryEntries([])
      setLoading(false)
      setHistoryLoading(false)
      return
    }

    setLoading(true)

    try {
      await Promise.all([fetchItems(), fetchUsers(), fetchJobs(), fetchSettings(), fetchBaseline(), fetchWorkdayExceptions()])
    } catch (err) {
      if (isCurrentJob(requestedJobId)) {
        toastApiError(err, "Failed to load schedule")
      }
    } finally {
      if (isCurrentJob(requestedJobId)) {
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
