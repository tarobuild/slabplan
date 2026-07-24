import assert from "node:assert/strict"
import { describe, test } from "node:test"

import { canCreateScheduleItemRole, hasRoleAccess, ROLE_GATES } from "./role-access.ts"

describe("hasRoleAccess", () => {
  test("admin can access admin-only office routes", () => {
    assert.equal(hasRoleAccess("admin", ROLE_GATES.sales), true)
    assert.equal(hasRoleAccess("admin", ROLE_GATES.clients), true)
  })

  test("project_manager uses the same field-user route gates as crew", () => {
    assert.equal(hasRoleAccess("project_manager", ROLE_GATES.sales), false)
    assert.equal(hasRoleAccess("project_manager", ROLE_GATES.clients), false)
    assert.equal(hasRoleAccess("project_manager", ROLE_GATES.companyViews), false)
    assert.equal(hasRoleAccess("project_manager", ROLE_GATES.schedule), false)
    assert.equal(hasRoleAccess("project_manager", ROLE_GATES.dailyLogs), false)
    assert.equal(hasRoleAccess("project_manager", ROLE_GATES.myJobs), true)
    assert.equal(hasRoleAccess("project_manager", ROLE_GATES.atRisk), true)
  })

  test("crew_member is blocked from admin-only office routes", () => {
    // The role gate must redirect field users away from these routes,
    // matching the backend's per-role enforcement and avoiding the ugly
    // empty-page + "Forbidden" toast combo.
    assert.equal(hasRoleAccess("crew_member", ROLE_GATES.sales), false)
    assert.equal(hasRoleAccess("crew_member", ROLE_GATES.clients), false)
    assert.equal(hasRoleAccess("crew_member", ROLE_GATES.companyViews), false)
    assert.equal(hasRoleAccess("crew_member", ROLE_GATES.schedule), false)
    assert.equal(hasRoleAccess("crew_member", ROLE_GATES.dailyLogs), false)
    assert.equal(hasRoleAccess("crew_member", ROLE_GATES.myJobs), true)
    assert.equal(hasRoleAccess("crew_member", ROLE_GATES.atRisk), false)
  })

  test("drafter can access shared sales, assigned jobs, and schedule views only", () => {
    assert.equal(hasRoleAccess("drafter", ROLE_GATES.sales), true)
    assert.equal(hasRoleAccess("drafter", ROLE_GATES.schedule), true)
    assert.equal(hasRoleAccess("drafter", ROLE_GATES.dailyLogs), false)
    assert.equal(hasRoleAccess("drafter", ROLE_GATES.companyViews), false)
    assert.equal(hasRoleAccess("drafter", ROLE_GATES.clients), false)
    assert.equal(hasRoleAccess("drafter", ROLE_GATES.reports), false)
    assert.equal(hasRoleAccess("drafter", ROLE_GATES.myJobs), true)
    assert.equal(hasRoleAccess("drafter", ROLE_GATES.atRisk), false)
  })

  test("schedule item creation admits admins and drafters only", () => {
    assert.equal(canCreateScheduleItemRole("admin"), true)
    assert.equal(canCreateScheduleItemRole("drafter"), true)
    assert.equal(canCreateScheduleItemRole("project_manager"), false)
    assert.equal(canCreateScheduleItemRole("crew_member"), false)
    assert.equal(canCreateScheduleItemRole(null), false)
  })

  test("at-risk drilldowns are PM-only because they render PM dashboard data", () => {
    assert.equal(hasRoleAccess("admin", ROLE_GATES.atRisk), false)
    assert.equal(hasRoleAccess("project_manager", ROLE_GATES.atRisk), true)
    assert.equal(hasRoleAccess("crew_member", ROLE_GATES.atRisk), false)
  })

  test("admin-only gate admits admin and rejects everyone else", () => {
    const adminOnly = ["admin"] as const
    assert.equal(hasRoleAccess("admin", adminOnly), true)
    assert.equal(hasRoleAccess("project_manager", adminOnly), false)
    assert.equal(hasRoleAccess("crew_member", adminOnly), false)
    assert.equal(hasRoleAccess("drafter", adminOnly), false)
  })

  test("a missing role (signed-out edge case) is always blocked", () => {
    assert.equal(hasRoleAccess(null, ROLE_GATES.sales), false)
    assert.equal(hasRoleAccess(undefined, ROLE_GATES.sales), false)
    assert.equal(hasRoleAccess("", ROLE_GATES.sales), false)
  })

  test("an unknown role string is rejected rather than crashing", () => {
    // Defensive: a future role we don't yet know about should fall through to
    // "no access" instead of being silently allowed.
    assert.equal(hasRoleAccess("super_admin", ROLE_GATES.sales), false)
    assert.equal(hasRoleAccess("guest", ROLE_GATES.clients), false)
  })
})
