import { test as setup } from "@playwright/test"
import fs from "node:fs"
import path from "node:path"
import {
  ANWAR,
  CESAR,
  getPmCredentials,
  getWorkerCredentials,
  PM_EMAIL,
  type Credentials,
} from "./helpers/auth"
import {
  ensureProjectManagerFixture,
  findUserIdByEmail,
  reissueInvite,
} from "./helpers/api"
import {
  ANWAR_STATE,
  CESAR_STATE,
  PM_STATE,
  WORKER_STATE,
} from "./helpers/storage"

for (const stateFile of [CESAR_STATE, ANWAR_STATE, WORKER_STATE, PM_STATE]) {
  fs.mkdirSync(path.dirname(stateFile), { recursive: true })
}

const REFRESH_COOKIE = "cadstone_refresh_token"

function readRefreshCookieFrom(
  file: string,
): { name: string; value: string } | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as {
      cookies?: Array<{ name: string; value: string }>
    }
    const cookie = parsed.cookies?.find((c) => c.name === REFRESH_COOKIE)
    return cookie ? { name: cookie.name, value: cookie.value } : null
  } catch {
    return null
  }
}

async function provisionSession(
  context: Parameters<Parameters<typeof setup>[1]>[0]["context"],
  creds: Credentials,
  outFile: string,
) {
  // Prefer the refresh endpoint (not rate-limited) over /auth/login (5/email
  // /10min). If a previous run persisted a still-valid refresh cookie, use
  // it — this keeps the suite green even after repeated runs trip the
  // in-memory login limiter.
  const existingRefresh = fs.existsSync(outFile)
    ? readRefreshCookieFrom(outFile)
    : null
  if (existingRefresh) {
    const refreshRes = await context.request.post("/api/auth/refresh", {
      headers: {
        "X-Requested-With": "XMLHttpRequest",
        Cookie: `${existingRefresh.name}=${existingRefresh.value}`,
      },
    })
    if (refreshRes.ok()) {
      // /auth/refresh rotates the refresh cookie on the response. Seed it
      // into the context so storageState() captures the fresh pair.
      const setCookies = refreshRes.headersArray().filter(
        (h) => h.name.toLowerCase() === "set-cookie",
      )
      for (const { value } of setCookies) {
        const [pair] = value.split(";")
        const eq = pair.indexOf("=")
        if (eq < 0) continue
        const name = pair.slice(0, eq).trim()
        const cookieValue = pair.slice(eq + 1).trim()
        await context.addCookies([
          {
            name,
            value: cookieValue,
            domain: "localhost",
            path: name === REFRESH_COOKIE ? "/api/auth" : "/uploads",
            httpOnly: true,
            secure: false,
            sameSite: "Lax",
          },
        ])
      }
      await context.storageState({ path: outFile })
      return
    }
  }

  const res = await context.request.post("/api/auth/login", {
    data: creds,
    headers: { "X-Requested-With": "XMLHttpRequest" },
  })
  if (!res.ok()) {
    throw new Error(
      `auth.setup: login failed for ${creds.email}: ${res.status()} ${await res.text()}`,
    )
  }
  // Persist the context's cookies (including the httpOnly refresh cookie)
  // so downstream specs can boot into an authenticated session via
  // /auth/refresh instead of re-hitting the rate-limited /auth/login.
  await context.storageState({ path: outFile })
}

setup("authenticate Cesar (admin)", async ({ context }) => {
  await provisionSession(context, CESAR, CESAR_STATE)
})

setup("authenticate Anwar (admin)", async ({ context }) => {
  await provisionSession(context, ANWAR, ANWAR_STATE)
})

setup("authenticate Worker fixture (crew_member)", async ({ context }) => {
  await provisionSession(context, getWorkerCredentials(), WORKER_STATE)
})

// PM fixture: unlike the admin/worker users, this account is NOT seeded
// by seed-users.mjs because production has no PMs by default. Instead we
// invite it here on demand (idempotent — `ensureProjectManagerFixture`
// reuses any existing project_manager), reissue a fresh invite token,
// and consume that token via /auth/accept-invite to (re)set the password
// to SEED_PM_FIXTURE_PASSWORD. The accept-invite response sets the
// refresh cookie on the context, so storageState() captures a session
// downstream specs can refresh from like any other fixture.
setup("authenticate PM fixture (project_manager)", async ({ context }) => {
  const pmCreds = getPmCredentials()

  // Fast path: a previous setup run persisted a still-valid refresh
  // cookie. Reuse it via /auth/refresh and avoid re-running the
  // invite-accept dance (which mutates the PM's password every time).
  const existingRefresh = fs.existsSync(PM_STATE)
    ? readRefreshCookieFrom(PM_STATE)
    : null
  if (existingRefresh) {
    const refreshRes = await context.request.post("/api/auth/refresh", {
      headers: {
        "X-Requested-With": "XMLHttpRequest",
        Cookie: `${existingRefresh.name}=${existingRefresh.value}`,
      },
    })
    if (refreshRes.ok()) {
      const setCookies = refreshRes.headersArray().filter(
        (h) => h.name.toLowerCase() === "set-cookie",
      )
      for (const { value } of setCookies) {
        const [pair] = value.split(";")
        const eq = pair.indexOf("=")
        if (eq < 0) continue
        const name = pair.slice(0, eq).trim()
        const cookieValue = pair.slice(eq + 1).trim()
        await context.addCookies([
          {
            name,
            value: cookieValue,
            domain: "localhost",
            path: name === REFRESH_COOKIE ? "/api/auth" : "/uploads",
            httpOnly: true,
            secure: false,
            sameSite: "Lax",
          },
        ])
      }
      await context.storageState({ path: PM_STATE })
      return
    }
  }

  // Cold path: we need a Cesar admin token to invite/find the PM and
  // reissue an invite. Hit /auth/login directly via context.request — a
  // single login per setup run is well within the 5/email/10min budget.
  const loginRes = await context.request.post("/api/auth/login", {
    data: CESAR,
    headers: { "X-Requested-With": "XMLHttpRequest" },
  })
  if (!loginRes.ok()) {
    throw new Error(
      `auth.setup PM: admin login failed: ${loginRes.status()} ${await loginRes.text()}`,
    )
  }
  const adminToken = (await loginRes.json()).accessToken as string

  // Idempotent: invites the PM if missing, otherwise returns the
  // existing one. Then re-look-up by email to be sure we have the right
  // id even when the helper found a pre-existing PM with a different
  // email (any active project_manager satisfies the helper).
  await ensureProjectManagerFixture(context.request, adminToken)
  const pmId = await findUserIdByEmail(context.request, adminToken, PM_EMAIL)
  if (!pmId) {
    throw new Error(
      `auth.setup PM: ${PM_EMAIL} not found after ensureProjectManagerFixture. ` +
        `If your local DB already has a different project_manager, delete ` +
        `${PM_STATE} and re-run; the helper will invite ${PM_EMAIL} when no ` +
        `active PM exists.`,
    )
  }

  const { token: inviteToken } = await reissueInvite(
    context.request,
    adminToken,
    pmId,
  )

  // Consume the invite to set a known password. This response sets the
  // refresh cookie on the context (replacing Cesar's cookie from the
  // login above, since both endpoints use cadstone_refresh_token).
  const acceptRes = await context.request.post("/api/auth/accept-invite", {
    data: { token: inviteToken, password: pmCreds.password },
    headers: { "X-Requested-With": "XMLHttpRequest" },
  })
  if (!acceptRes.ok()) {
    throw new Error(
      `auth.setup PM: accept-invite failed: ${acceptRes.status()} ${await acceptRes.text()}. ` +
        `Most likely SEED_PM_FIXTURE_PASSWORD does not satisfy the API ` +
        `password policy (>= 12 chars, no obvious weak patterns).`,
    )
  }

  await context.storageState({ path: PM_STATE })
})
