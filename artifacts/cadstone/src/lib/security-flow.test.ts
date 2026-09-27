import assert from "node:assert/strict"
import { afterEach, test } from "node:test"
import { continueAuthentication, useSecurityFlow } from "./security-flow"
import { useAuthStore } from "../store/auth"

afterEach(() => { useAuthStore.getState().clearAuth(); useSecurityFlow.setState({ challengeToken: null, email: "", emailSent: null }) })

test("email and MFA challenges do not create authenticated sessions", () => {
  assert.equal(continueAuthentication({ verificationRequired: true, email: "test@example.test", emailSent: false }), "/verify-email")
  assert.equal(useAuthStore.getState().accessToken, null)
  assert.equal(useSecurityFlow.getState().emailSent, false)
  assert.equal(continueAuthentication({ setupRequired: true, challengeToken: "test-opaque-challenge" }, "/subscribe"), "/account-verification")
  assert.equal(useAuthStore.getState().accessToken, null)
  assert.equal(useSecurityFlow.getState().mode, "setup")
  assert.equal(useSecurityFlow.getState().destination, "/subscribe")
})

test("a full session clears the temporary challenge and incomplete responses fail loudly", () => {
  assert.throws(() => continueAuthentication({}), /incomplete/)
  assert.equal(useAuthStore.getState().user, null)
  continueAuthentication({ mfaRequired: true, challengeToken: "test-challenge" })
  assert.equal(continueAuthentication({ accessToken: "test-session", user: { id: "test-id", email: "test@example.test", fullName: "TEST User", role: "admin", avatarUrl: null, phone: null } }), "/dashboard")
  assert.equal(useAuthStore.getState().accessToken, "test-session")
  assert.equal(useSecurityFlow.getState().challengeToken, null)
})
