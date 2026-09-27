import { create } from "zustand"
import { useAuthStore, type AuthUser } from "@/store/auth"

type SecurityFlow = {
  challengeToken: string | null
  mode: "setup" | "login"
  destination: string
  email: string
  emailSent: boolean | null
}

// Challenges and enrollment secrets must never enter URLs or persistent storage.
export const useSecurityFlow = create<SecurityFlow>(() => ({ challengeToken: null, mode: "login", destination: "/dashboard", email: "", emailSent: null }))

export function continueAuthentication(payload: unknown, destination = "/dashboard"): string {
  if (!payload || typeof payload !== "object") throw new Error("The sign-in response was incomplete. Please try again.")
  const data = payload as Record<string, unknown>
  if (data.verificationRequired === true && typeof data.email === "string") {
    useAuthStore.getState().clearAuth()
    useSecurityFlow.setState({ challengeToken: null, email: data.email, emailSent: typeof data.emailSent === "boolean" ? data.emailSent : null })
    return "/verify-email"
  }
  if ((data.mfaRequired === true || data.setupRequired === true) && typeof data.challengeToken === "string") {
    useSecurityFlow.setState({ challengeToken: data.challengeToken, mode: data.setupRequired ? "setup" : "login", destination })
    return "/account-verification"
  }
  if (typeof data.accessToken !== "string" || !data.user || typeof data.user !== "object" || !("id" in data.user)) {
    throw new Error("The sign-in response was incomplete. Please try again.")
  }
  useAuthStore.getState().setAuth(data.user as AuthUser, data.accessToken)
  useSecurityFlow.setState({ challengeToken: null })
  return destination
}
