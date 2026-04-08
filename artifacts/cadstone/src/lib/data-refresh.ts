export type AppDataResource = "jobs" | "clients" | "leads" | "navigation"

const refreshTarget = new EventTarget()

function refreshEventName(resource: AppDataResource) {
  return `cadstone:data-refresh:${resource}`
}

export function invalidateAppData(resources: AppDataResource | AppDataResource[]) {
  const normalized = Array.isArray(resources) ? resources : [resources]

  for (const resource of new Set(normalized)) {
    refreshTarget.dispatchEvent(new Event(refreshEventName(resource)))
  }
}

export function subscribeToDataRefresh(resource: AppDataResource, listener: () => void) {
  const eventName = refreshEventName(resource)
  const handler = () => listener()

  refreshTarget.addEventListener(eventName, handler)

  return () => {
    refreshTarget.removeEventListener(eventName, handler)
  }
}
