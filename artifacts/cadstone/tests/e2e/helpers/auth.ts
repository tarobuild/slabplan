import type { Page, APIRequestContext } from "@playwright/test"
import fs from "node:fs"
import { ANWAR_STATE, CESAR_STATE, PM_STATE, WORKER_STATE } from "./storage"

export type Credentials = { email: string; password: string }

const REFRESH_COOKIE = "stone_track_refresh_token"

function requireSeedPassword(envVar: string, who: string): string {
  const value = process.env[envVar]
  if (!value) {
    throw new Error(
      `${envVar} is not set. The Playwright suite needs ${who}'s password ` +
        `to match what seed-users.mjs --db=local was run with. Set it to ` +
        `the same value passed to the seed script.`,
    )
  }
  return value
}

export const CESAR: Credentials = {
  email: "admin-primary@stone-track.test",
  get password() {
    return requireSeedPassword("SEED_ADMIN_PRIMARY_PASSWORD", "primary admin")
  },
}

export const ANWAR: Credentials = {
  email: "admin-secondary@stone-track.test",
  get password() {
    return requireSeedPassword("SEED_ADMIN_SECONDARY_PASSWORD", "secondary admin")
  },
}

// Synthetic crew_member fixture used to assert worker-level role gates
// actually fire. The seed script (artifacts/api-server/scripts/seed-users.mjs)
// requires SEED_WORKER_FIXTURE_PASSWORD when seeding --db=local; this
// helper reads the same env var so the password used at seed time matches
// the password used at login time. There is intentionally no fallback —
// missing env var fails loudly here too.
export const WORKER_EMAIL = "worker@stone-track.test"

export function getWorkerCredentials(): Credentials {
  const password = process.env.SEED_WORKER_FIXTURE_PASSWORD
  if (!password) {
    throw new Error(
      "SEED_WORKER_FIXTURE_PASSWORD is not set. The Playwright worker " +
        "fixture (worker@stone-track.test) requires this env var. Set it to " +
        "the same value passed to seed-users.mjs --db=local.",
    )
  }
  return { email: WORKER_EMAIL, password }
}

// Synthetic project_manager fixture used by Playwright to drive PM-positive
// flows (PM-of-job CAN edit own job, manage schedule, view financials).
// Unlike the worker fixture, the PM is NOT seeded by seed-users.mjs — it
// is provisioned by auth.setup.ts via the existing
// `ensureProjectManagerFixture` helper (admin-invites the user, then
// auth.setup reissues a fresh invite token and consumes it via
// /auth/accept-invite to set the password to SEED_PM_FIXTURE_PASSWORD).
// The Playwright suite is the only consumer that needs a logged-in PM,
// so production never gets this user.
export const PM_EMAIL = "fixture-pm@stone-track.test"

export function getPmCredentials(): Credentials {
  const password = process.env.SEED_PM_FIXTURE_PASSWORD
  if (!password) {
    throw new Error(
      "SEED_PM_FIXTURE_PASSWORD is not set. The Playwright PM fixture " +
        "(fixture-pm@stone-track.test) requires this env var so auth.setup " +
        "can consume the invite token and so loginViaApi can fall back " +
        "to /auth/login if the refresh cookie is invalidated. Pick any " +
        "password that satisfies the API's password policy (>= 12 chars, " +
        "no obvious weak patterns).",
    )
  }
  return { email: PM_EMAIL, password }
}

// Module-level memoization: the API server rate-limits /auth/login to
// 5 attempts per email per 10 minutes, so hitting it once per test would
// trip the limiter long before the suite finishes. With workers=1 every
// spec shares this process, so one login per user covers everything.
const tokenCache = new Map<string, { accessToken: string; userId: string }>()

/**
 * Log in via the UI. After this resolves we are sitting on /dashboard.
 * Use sparingly — prefer `loginViaApi` + the auth token for anything
 * that doesn't genuinely need to click through the sign-in form.
 */
export async function loginViaUi(page: Page, creds: Credentials) {
  // Seed the auth state directly by calling /auth/login from within the
  // browser context. This piggy-backs on the refresh-token cookie, so a
  // subsequent visit to /dashboard hydrates via bootstrapAuthSession —
  // and we still hold the assertion that "user can log in" because the
  // UI-driven test in auth.spec.ts posts to the real form.
  await page.goto("/login")
  await page.getByLabel(/email/i).fill(creds.email)
  await page.getByLabel(/password/i).fill(creds.password)
  await page.getByRole("button", { name: /sign in/i }).click()
  await page.waitForURL(/\/dashboard(\?|$|\/)/)
}

function stateFileFor(creds: Credentials) {
  if (creds.email === CESAR.email) return CESAR_STATE
  if (creds.email === ANWAR.email) return ANWAR_STATE
  if (creds.email === WORKER_EMAIL) return WORKER_STATE
  if (creds.email === PM_EMAIL) return PM_STATE
  return null
}

function readRefreshTokenFromState(statePath: string): string | null {
  try {
    const raw = fs.readFileSync(statePath, "utf8")
    const parsed = JSON.parse(raw) as {
      cookies?: Array<{ name: string; value: string }>
    }
    return (
      parsed.cookies?.find((c) => c.name === REFRESH_COOKIE)?.value ?? null
    )
  } catch {
    return null
  }
}

/**
 * Memoized API login. Reuses the refresh cookie provisioned by
 * auth.setup.ts to mint a fresh access token via /auth/refresh (which
 * is NOT rate limited), avoiding the per-email 5-attempt cap on
 * /auth/login. Falls back to /auth/login for credentials that don't
 * have a provisioned state file.
 */
export async function loginViaApi(
  request: APIRequestContext,
  creds: Credentials,
): Promise<{ accessToken: string; userId: string }> {
  const cached = tokenCache.get(creds.email)
  if (cached) return cached

  const statePath = stateFileFor(creds)
  const refreshToken = statePath ? readRefreshTokenFromState(statePath) : null

  if (refreshToken) {
    const res = await request.post("/api/auth/refresh", {
      headers: {
        "X-Requested-With": "XMLHttpRequest",
        Cookie: `${REFRESH_COOKIE}=${refreshToken}`,
      },
    })
    if (res.ok()) {
      const body = await res.json()
      const record = { accessToken: body.accessToken, userId: body.user.id }
      tokenCache.set(creds.email, record)
      return record
    }
    // Fall through to /auth/login if refresh rejects the cookie (e.g.
    // server restarted and the refresh secret rotated).
  }

  const res = await request.post("/api/auth/login", {
    data: creds,
    headers: { "X-Requested-With": "XMLHttpRequest" },
  })
  if (!res.ok()) {
    throw new Error(`Login failed for ${creds.email}: ${res.status()}`)
  }
  const body = await res.json()
  const record = { accessToken: body.accessToken, userId: body.user.id }
  tokenCache.set(creds.email, record)
  return record
}

export function authHeaders(accessToken: string) {
  return {
    Authorization: `Bearer ${accessToken}`,
    "X-Requested-With": "XMLHttpRequest",
  }
}
