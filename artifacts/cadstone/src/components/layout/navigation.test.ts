import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { ROLE_GATES, type AppRole } from "@/lib/role-access"
import { deriveFromPath } from "./Breadcrumbs.tsx"
import {
  getPrimaryDestinations,
  isDestinationActive,
  type NavDestination,
} from "./navigation.ts"

const ROLES: AppRole[] = ["admin", "project_manager", "crew_member", "drafter"]

function labels(role: AppRole | null) {
  return getPrimaryDestinations(role).map((item) => item.label)
}

function activeLabels(role: AppRole, pathname: string) {
  return getPrimaryDestinations(role)
    .filter((item) => isDestinationActive(pathname, item))
    .map((item) => item.label)
}

test("each role sees exactly its primary destinations", () => {
  assert.deepEqual(labels("admin"), [
    "Home",
    "Clients",
    "Schedule",
    "Daily Logs",
    "Sales",
    "Reports",
    "Resources",
  ])
  assert.deepEqual(labels("project_manager"), ["Home", "My Jobs", "My Daily Logs", "Resources"])
  assert.deepEqual(labels("crew_member"), ["Home", "My Jobs", "My Daily Logs", "Resources"])
  assert.deepEqual(labels("drafter"), ["Home", "My Jobs", "Schedule", "Sales"])
})

test("a missing or unknown role gets no gated destinations", () => {
  assert.deepEqual(labels(null), ["Home", "Resources"])
  assert.deepEqual(
    getPrimaryDestinations("owner").map((item) => item.label),
    ["Home", "Resources"],
  )
})

test("gated destinations follow ROLE_GATES for every role", () => {
  const gated: Array<[string, ReadonlyArray<AppRole>]> = [
    ["/clients", ROLE_GATES.clients],
    ["/schedule", ROLE_GATES.schedule],
    ["/sales", ROLE_GATES.sales],
    ["/reports", ROLE_GATES.reports],
  ]
  for (const role of ROLES) {
    const paths = getPrimaryDestinations(role).map((item) => item.to)
    for (const [path, allowed] of gated) {
      assert.equal(
        paths.includes(path),
        allowed.includes(role),
        `${role} ${allowed.includes(role) ? "should" : "should not"} see ${path}`,
      )
    }
    // The company Daily Logs feed is admin-only; field users get their own feed.
    const dailyLogRoles: ReadonlyArray<AppRole> = ROLE_GATES.dailyLogs
    assert.equal(paths.includes("/daily-logs"), dailyLogRoles.includes(role))
  }
})

test("exact destinations only light up on their own path", () => {
  const home = getPrimaryDestinations("admin").find((item) => item.label === "Home") as NavDestination
  assert.equal(isDestinationActive("/dashboard", home), true)
  assert.equal(isDestinationActive("/dashboard/extra", home), false)

  const companyLogs = getPrimaryDestinations("admin").find(
    (item) => item.label === "Daily Logs",
  ) as NavDestination
  assert.equal(isDestinationActive("/daily-logs", companyLogs), true)
  assert.equal(isDestinationActive("/daily-logs/mine", companyLogs), false)
})

test("prefix matching respects path segment boundaries", () => {
  const clients = getPrimaryDestinations("admin").find((item) => item.label === "Clients") as NavDestination
  assert.equal(isDestinationActive("/clients", clients), true)
  assert.equal(isDestinationActive("/clients/abc", clients), true)
  assert.equal(isDestinationActive("/jobs/123/files/documents", clients), true)
  assert.equal(isDestinationActive("/clientsx", clients), false)
  assert.equal(isDestinationActive("/jobsite", clients), false)
})

test("exactly one destination is active for common routes", () => {
  const cases: Array<[AppRole, string, string]> = [
    ["admin", "/dashboard", "Home"],
    ["admin", "/clients/abc", "Clients"],
    ["admin", "/jobs/123/daily-logs", "Clients"],
    ["admin", "/schedule", "Schedule"],
    ["admin", "/daily-logs", "Daily Logs"],
    ["admin", "/sales/leads", "Sales"],
    ["admin", "/reports/ar-aging", "Reports"],
    ["project_manager", "/jobs/123/schedule", "My Jobs"],
    ["project_manager", "/daily-logs/mine", "My Daily Logs"],
    ["crew_member", "/jobs", "My Jobs"],
    ["crew_member", "/resources", "Resources"],
    ["drafter", "/jobs/123/files/documents", "My Jobs"],
    ["drafter", "/schedule", "Schedule"],
  ]
  for (const [role, pathname, expected] of cases) {
    assert.deepEqual(activeLabels(role, pathname), [expected], `${role} at ${pathname}`)
  }
})

test("settings and unknown routes do not highlight a primary destination", () => {
  for (const role of ROLES) {
    assert.deepEqual(activeLabels(role, "/settings/profile"), [], role)
    assert.deepEqual(activeLabels(role, "/not-a-page"), [], role)
  }
})

test("the desktop navigation reads destinations from the shared module", () => {
  const source = readFileSync(new URL("./AppNavigation.tsx", import.meta.url), "utf8")
  assert.match(source, /getPrimaryDestinations\(/)
  assert.match(source, /isDestinationActive\(/)
})

test("record ids fall back to a readable breadcrumb label", () => {
  assert.deepEqual(
    deriveFromPath("/jobs/7f1c2d3e-aaaa-bbbb-cccc-1234567890ab/daily-logs").map((item) => item.label),
    ["Jobs", "Details", "Daily Logs"],
  )
})
