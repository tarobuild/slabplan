import assert from "node:assert/strict"
import { describe, test } from "node:test"

import { hasRoleAccess, ROLE_GATES } from "./role-access.ts"

describe("hasRoleAccess", () => {
  test("admin can access admin-only office routes", () => {
    assert.equal(hasRoleAccess("admin", ROLE_GATES.sales), true)
    assert.equal(hasRoleAccess("admin", ROLE_GATES.clients), true)
  })

  test("project_manager uses the same field-user route gates as crew", () => {
    assert.equal(hasRoleAccess("project_manager", ROLE_GATES.sales), false)
    assert.equal(hasRoleAccess("project_manager", ROLE_GATES.clients), false)
    assert.equal(hasRoleAccess("project_manager", ROLE_GATES.companyViews), false)
    assert.equal(hasRoleAccess("project_manager", ROLE_GATES.myJobs), true)
  })

  test("crew_member is blocked from admin-only office routes", () => {
    // The role gate must redirect field users away from these routes,
    // matching the backend's per-role enforcement and avoiding the ugly
    // empty-page + "Forbidden" toast combo.
    assert.equal(hasRoleAccess("crew_member", ROLE_GATES.sales), false)
    assert.equal(hasRoleAccess("crew_member", ROLE_GATES.clients), false)
    assert.equal(hasRoleAccess("crew_member", ROLE_GATES.companyViews), false)
    assert.equal(hasRoleAccess("crew_member", ROLE_GATES.myJobs), true)
  })

  test("admin-only gate admits admin and rejects everyone else", () => {
    const adminOnly = ["admin"] as const
    assert.equal(hasRoleAccess("admin", adminOnly), true)
    assert.equal(hasRoleAccess("project_manager", adminOnly), false)
    assert.equal(hasRoleAccess("crew_member", adminOnly), false)
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
