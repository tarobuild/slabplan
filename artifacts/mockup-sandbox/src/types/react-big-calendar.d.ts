declare module "react-big-calendar" {
  import type { ComponentType, CSSProperties } from "react"

  export type View = "month" | "week" | "work_week" | "day" | "agenda"

  export function dateFnsLocalizer(config: {
    format: (...args: any[]) => string
    parse: (...args: any[]) => Date
    startOfWeek: (date: Date) => Date
    getDay: (date: Date) => number
    locales: Record<string, unknown>
  }): unknown

  export const Calendar: ComponentType<{
    localizer: unknown
    events: any[]
    view?: View
    onView?: (view: View) => void
    onSelectEvent?: (event: any) => void
    eventPropGetter?: (event: any) => { style?: CSSProperties; className?: string }
    dayPropGetter?: (date: Date) => { style?: CSSProperties; className?: string }
    style?: CSSProperties
  }>
}
