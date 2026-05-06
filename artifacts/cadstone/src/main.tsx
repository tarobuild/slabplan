import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
// Initialize Sentry before React renders so the ErrorBoundary sees a
// configured client (Task #348).
import { initSentry, setSentryUser } from "./lib/sentry"
initSentry()
import App from "./App"
import "./index.css"
import { useAuthStore } from "./store/auth"

// Mirror the auth store into Sentry's user context. We pass `id` and
// `role` only — never `email` or `fullName` (PII).
setSentryUser(useAuthStore.getState().user
  ? { id: useAuthStore.getState().user!.id, role: useAuthStore.getState().user!.role }
  : null)
useAuthStore.subscribe((state) => {
  setSentryUser(state.user ? { id: state.user.id, role: state.user.role } : null)
})

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
