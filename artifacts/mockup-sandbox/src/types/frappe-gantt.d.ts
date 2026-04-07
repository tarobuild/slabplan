declare module "frappe-gantt" {
  export type GanttTask = {
    id: string
    name: string
    start: string
    end?: string
    duration?: string
    progress?: number
    dependencies?: string[] | string
    custom_class?: string
    description?: string
  }

  export type GanttOptions = {
    view_mode?: "Day" | "Week" | "Month" | "Year" | string
    readonly?: boolean
    readonly_dates?: boolean
    readonly_progress?: boolean
    today_button?: boolean
    popup_on?: "click" | "hover"
    ignore?: "weekend" | Array<string | Date> | ((date: Date) => boolean)
    on_click?: (task: GanttTask) => void
    on_view_change?: (mode: string) => void
    popup?: (context: {
      task: GanttTask
      set_title: (value: string) => void
      set_subtitle: (value: string) => void
      set_details: (value: string) => void
      add_action: (html: string, handler: () => void) => void
    }) => string | false | void
  }

  export default class Gantt {
    constructor(
      wrapper: string | HTMLElement | SVGElement,
      tasks: GanttTask[],
      options?: GanttOptions,
    )
    change_view_mode(viewMode?: string, maintainPos?: boolean): void
    update_options(options: GanttOptions): void
    scroll_current(): void
  }
}
