import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query"
import { ApiError, setAuthTokenGetter } from "@workspace/api-client-react"
import { useAuthStore } from "@/store/auth"
import { refreshSession } from "@/lib/api"
import { subscribeToDataRefresh, type AppDataResource } from "@/lib/data-refresh"

let initialized = false

function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError
}

function shouldRetry(failureCount: number, error: unknown): boolean {
  if (!isApiError(error)) {
    return failureCount < 1
  }

  if (error.status === 401) {
    // Allow one retry so the cookie-based refresh that runs from
    // the cache `onError` handler has a chance to seat a new token.
    return failureCount < 1
  }

  if (error.status >= 400 && error.status < 500 && error.status !== 408 && error.status !== 429) {
    return false
  }

  return failureCount < 2
}

async function handleAuthError(error: unknown): Promise<void> {
  if (!isApiError(error) || error.status !== 401) {
    return
  }

  await refreshSession()
}

const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error) => {
      void handleAuthError(error)
    },
  }),
  mutationCache: new MutationCache({
    onError: (error) => {
      void handleAuthError(error)
    },
  }),
  defaultOptions: {
    queries: {
      retry: shouldRetry,
      refetchOnWindowFocus: false,
      staleTime: 30 * 1000,
    },
    mutations: {
      retry: (failureCount, error) => {
        if (isApiError(error) && error.status === 401) {
          return failureCount < 1
        }
        return false
      },
    },
  },
})

const RESOURCE_URL_PREFIXES: Record<AppDataResource, string[]> = {
  jobs: ["/api/jobs"],
  clients: ["/api/clients"],
  leads: ["/api/leads"],
  navigation: [],
}

function urlMatchesPrefixes(url: unknown, prefixes: string[]): boolean {
  if (typeof url !== "string" || prefixes.length === 0) {
    return false
  }
  return prefixes.some(
    (prefix) =>
      url === prefix || url.startsWith(`${prefix}/`) || url.startsWith(`${prefix}?`),
  )
}

function bridgeDataRefreshToReactQuery(): void {
  const resources: AppDataResource[] = ["jobs", "clients", "leads"]

  for (const resource of resources) {
    const prefixes = RESOURCE_URL_PREFIXES[resource]
    if (prefixes.length === 0) continue

    subscribeToDataRefresh(resource, () => {
      void queryClient.invalidateQueries({
        predicate: (query) => urlMatchesPrefixes(query.queryKey[0], prefixes),
      })
    })
  }
}

export function getQueryClient(): QueryClient {
  return queryClient
}

export function configureApiClient(): void {
  if (initialized) {
    return
  }
  initialized = true

  setAuthTokenGetter(() => useAuthStore.getState().accessToken)
  bridgeDataRefreshToReactQuery()
}
