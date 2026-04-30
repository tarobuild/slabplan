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

export interface UseScheduleDataOptions {
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

  useEffect(() => {
    onItemsFetchedRef.current = onItemsFetched
  }, [onItemsFetched])

  async function fetchItems() {
    if (!jobId) {
      return
    }

    const collected: ScheduleItemRecord[] = []
    const pageSize = 500
    let page = 1
    let totalPages = 1
    let totalItems = 0
    while (page <= totalPages && page <= 20) {
      const response = await scheduleGetJobsJobIdSchedule(jobId, {
        page,
        limit: pageSize,
      })
      collected.push(...((response.data ?? []) as unknown as ScheduleItemRecord[]))
      totalPages = response.pagination?.totalPages ?? 1
      totalItems = response.pagination?.totalItems ?? collected.length
      page += 1
    }
    const nextItems = collected
    setItems(nextItems)
    setItemsTotal(totalItems)
    onItemsFetchedRef.current(nextItems)
  }

  async function fetchBaseline() {
    if (!jobId) {
      return
    }

    const response = await api.get<{ baseline: ScheduleBaselineRecord | null }>(`/jobs/${jobId}/schedule/baseline`)
    setBaseline(response.data.baseline ?? null)
  }

  async function fetchWorkdayExceptions() {
    if (!jobId) {
      return
    }

    const response = await api.get<{ exceptions: ScheduleWorkdayException[] }>(`/jobs/${jobId}/workday-exceptions`)
    setWorkdayExceptions(response.data.exceptions ?? [])
  }

  async function fetchSettings() {
    if (!jobId) {
      return
    }

    const response = await api.get<ScheduleSettings>(`/jobs/${jobId}/schedule/settings`)
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
    const response = await api.get<{ users: AppUser[] }>("/users")
    setUsers(response.data.users ?? [])
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
    if (!jobId) {
      return
    }

    setHistoryLoading(true)

    try {
      const response = await api.get<{ data: ActivityEntry[] }>(`/activity?jobId=${jobId}&page=1&limit=100`)
      setHistoryEntries(
        (response.data.data ?? []).filter((entry) => entry.entityType.startsWith("schedule_")),
      )
    } catch (err) {
      toastApiError(err, "Failed to load schedule history")
    } finally {
      setHistoryLoading(false)
    }
  }

  async function loadData() {
    if (!jobId) {
      return
    }

    setLoading(true)

    try {
      await Promise.all([fetchItems(), fetchUsers(), fetchJobs(), fetchSettings(), fetchBaseline(), fetchWorkdayExceptions()])
    } catch (err) {
      toastApiError(err, "Failed to load schedule")
    } finally {
      setLoading(false)
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
