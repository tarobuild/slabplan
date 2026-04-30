import { test as setup } from "@playwright/test"
import fs from "node:fs"
import path from "node:path"
import {
  ANWAR,
  CESAR,
  getWorkerCredentials,
  type Credentials,
} from "./helpers/auth"
import { ANWAR_STATE, CESAR_STATE, WORKER_STATE } from "./helpers/storage"

for (const stateFile of [CESAR_STATE, ANWAR_STATE, WORKER_STATE]) {
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
