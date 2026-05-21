import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const source = readFileSync(new URL("./accept-invite.tsx", import.meta.url), "utf8")

test("invite acceptance has a synchronous duplicate-submit guard", () => {
  assert.match(source, /useRef/)
  assert.match(source, /const submittingRef = useRef\(false\)/)
  assert.match(source, /if \(submittingRef\.current\) return/)
  assert.match(source, /submittingRef\.current = true/)
  assert.match(source, /submittingRef\.current = false/)
  assert.match(source, /disabled=\{submitting\}/)
})

test("invite acceptance covers missing token and password validation branches", () => {
  assert.match(source, /if \(!token\) \{/)
  assert.match(source, /This setup link is incomplete/)
  assert.match(source, /Ask your administrator for a fresh invite link/)
  assert.match(source, /navigate\("\/login", \{ replace: true \}\)/)

  assert.match(source, /if \(password\.length < 8\) \{/)
  assert.match(source, /toast\.error\("Password must be at least 8 characters\."\)/)
  assert.match(source, /if \(password !== confirm\) \{/)
  assert.match(source, /toast\.error\("Passwords do not match\."\)/)
  assert.match(source, /confirm && password !== confirm/)
})

test("invite acceptance submits a validated payload, authenticates, and navigates", () => {
  assert.match(source, /const payload: AuthAcceptInviteSchema = \{ token, password \}/)
  assert.match(source, /validatePayload\(AuthPostAuthAcceptInviteBody, payload\)/)
  assert.match(source, /authPostAuthAcceptInvite\(\s*validated,\s*\)/)
  assert.match(source, /setAuth\(response\.user, response\.accessToken\)/)
  assert.match(source, /toast\.success\(`Welcome to \$\{APP_NAME\}, \$\{response\.user\.fullName\}\.`\)/)
  assert.match(source, /navigate\("\/dashboard", \{ replace: true \}\)/)
})

test("invite acceptance routes API failures through the shared toast helper", () => {
  assert.match(source, /catch \(err: unknown\) \{/)
  assert.match(source, /toastApiError\(err, "Could not accept invite"\)/)
  assert.match(source, /finally \{/)
  assert.match(source, /setSubmitting\(false\)/)
})
