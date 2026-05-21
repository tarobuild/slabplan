import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import { ROLE_GATES, hasRoleAccess } from "./lib/role-access.ts"

const source = readFileSync(new URL("./App.tsx", import.meta.url), "utf8")

test("/jobs/:jobId/schedule is mapped to the job schedule page outlet", () => {
  const jobRoute = source.slice(
    source.indexOf('<Route path="/jobs/:jobId"'),
    source.indexOf('<Route element={<RoleGate allow={ROLE_GATES.sales} />}>'),
  )

  assert.match(jobRoute, /<Route index element=\{<Navigate to="daily-logs" replace \/>\} \/>/)
  assert.match(jobRoute, /<Route path="schedule" element=\{<JobSchedulePage \/>\} \/>/)
  assert.match(source, /const JobSchedulePage = lazy\(\(\) => import\("@\/pages\/job-schedule"\)\)/)
  assert.doesNotMatch(jobRoute, /path="schedule" element=\{<Navigate/)
})

test("/sales/leads is wired behind the sales role gate", () => {
  const salesRoute = source.slice(
    source.indexOf('<Route element={<RoleGate allow={ROLE_GATES.sales} />}>'),
    source.indexOf('<Route element={<RoleGate allow={ROLE_GATES.clients} />}>'),
  )

  assert.match(salesRoute, /<Route element=\{<RoleGate allow=\{ROLE_GATES\.sales\} \/>\}>/)
  assert.match(salesRoute, /<Route path="\/sales" element=\{<LeadsPage \/>\} \/>/)
  assert.match(salesRoute, /<Route path="\/sales\/leads" element=\{<LeadsPage \/>\} \/>/)
  assert.equal(hasRoleAccess("admin", ROLE_GATES.sales), true)
  assert.equal(hasRoleAccess("crew_member", ROLE_GATES.sales), false)
  assert.equal(hasRoleAccess("project_manager", ROLE_GATES.sales), false)
  assert.doesNotMatch(salesRoute, /redirectTo=/)
})

test("/register is wired under the public-only route guard", () => {
  const publicRoutes = source.slice(
    source.indexOf('<Route element={<PublicOnlyRoute ready={ready} />}>'),
    source.indexOf('<Route element={<ProtectedRoute ready={ready} />}>'),
  )

  assert.match(publicRoutes, /<Route element=\{<PublicOnlyRoute ready=\{ready\} \/>\}>/)
  assert.match(publicRoutes, /<Route path="\/login" element=\{<LoginPage \/>\} \/>/)
  assert.match(publicRoutes, /<Route path="\/register" element=\{<RegisterPage \/>\} \/>/)
  assert.match(publicRoutes, /<Route path="\/accept-invite" element=\{<AcceptInvitePage \/>\} \/>/)
})


test("/jobs/:jobId/files/videos is mapped to the videos files page", () => {
  const jobRoute = source.slice(
    source.indexOf('<Route path="/jobs/:jobId"'),
    source.indexOf('<Route element={<RoleGate allow={ROLE_GATES.sales} />}>'),
  )

  assert.match(jobRoute, /<Route path="files\/videos" element=\{<JobFilesVideosPage \/>\} \/>/)
  assert.match(source, /const JobFilesVideosPage = lazy\(\(\) => import\("@\/pages\/job-files-videos"\)\)/)
})

test("/jobs/:jobId/daily-logs is mapped to the job daily logs page", () => {
  const jobRoute = source.slice(
    source.indexOf('<Route path="/jobs/:jobId"'),
    source.indexOf('<Route element={<RoleGate allow={ROLE_GATES.sales} />}>'),
  )

  assert.match(jobRoute, /<Route path="daily-logs" element=\{<JobDailyLogsPage \/>\} \/>/)
  assert.match(source, /const JobDailyLogsPage = lazy\(\(\) => import\("@\/pages\/job-daily-logs"\)\)/)
})

test("/settings route table keeps profile, admin-only sections, and legacy redirects wired", () => {
  const settingsRoute = source.slice(
    source.indexOf('<Route path="/settings" element={<SettingsLayout />}>'),
    source.indexOf('<Route path="/billing" element={<Navigate to="/settings/billing" replace />} />'),
  )

  assert.match(settingsRoute, /<Route path="\/settings" element=\{<SettingsLayout \/>\}>/)
  assert.match(settingsRoute, /<Route index element=\{<Navigate to="\/settings\/profile" replace \/>\} \/>/)
  assert.match(settingsRoute, /<Route path="profile" element=\{<ProfileSection \/>\} \/>/)
  assert.match(settingsRoute, /<Route path="password" element=\{<PasswordSection \/>\} \/>/)
  assert.match(settingsRoute, /<Route path="notifications" element=\{<NotificationsSection \/>\} \/>/)
  assert.match(settingsRoute, /<Route path="tokens" element=\{<TokensSection \/>\} \/>/)

  const adminSettingsRoute = settingsRoute.slice(settingsRoute.indexOf("<Route element={<AdminRoute />}>"))
  assert.match(adminSettingsRoute, /<Route element=\{<AdminRoute \/>\}>/)
  assert.match(adminSettingsRoute, /<Route path="team" element=\{<UsersPage \/>\} \/>/)
  assert.match(adminSettingsRoute, /<Route path="company" element=\{<CompanySection \/>\} \/>/)
  assert.match(adminSettingsRoute, /<Route path="billing" element=\{<BillingSection \/>\} \/>/)
  assert.match(adminSettingsRoute, /<Route path="integrations" element=\{<IntegrationsSection \/>\} \/>/)
  assert.match(adminSettingsRoute, /<Route path="diagnostics" element=\{<DiagnosticsSection \/>\} \/>/)

  assert.match(source, /<Route path="\/billing" element=\{<Navigate to="\/settings\/billing" replace \/>\} \/>/)
  assert.match(source, /<Route path="\/billing\/success" element=\{<Navigate to="\/settings\/billing" replace \/>\} \/>/)
  assert.match(
    source,
    /<Route\s+path="\/settings\/users"\s+element=\{<Navigate to="\/settings\/team" replace \/>\}\s+\/>/,
  )
})

test("/settings/company is nested under the admin-only settings route", () => {
  const settingsRoute = source.slice(
    source.indexOf('<Route path="/settings" element={<SettingsLayout />}>'),
    source.indexOf('<Route path="/billing" element={<Navigate to="/settings/billing" replace />} />'),
  )
  const beforeAdminRoute = settingsRoute.slice(0, settingsRoute.indexOf("<Route element={<AdminRoute />}>"))
  const adminSettingsRoute = settingsRoute.slice(settingsRoute.indexOf("<Route element={<AdminRoute />}>"))

  assert.doesNotMatch(beforeAdminRoute, /path="company" element=\{<CompanySection \/>\}/)
  assert.match(adminSettingsRoute, /<Route element=\{<AdminRoute \/>\}>/)
  assert.match(adminSettingsRoute, /<Route path="company" element=\{<CompanySection \/>\} \/>/)
})

test("/reports route table keeps the reports gate and child reports wired", () => {
  const reportsGate = source.slice(
    source.indexOf('<Route element={<RoleGate allow={ROLE_GATES.reports} redirectTo="/403" />}>'),
    source.indexOf('<Route element={<RoleGate allow={ROLE_GATES.companyViews} redirectTo="/403" />}>'),
  )

  assert.match(reportsGate, /<Route element=\{<RoleGate allow=\{ROLE_GATES\.reports\} redirectTo="\/403" \/>\}>/)
  assert.match(reportsGate, /<Route path="\/reports" element=\{<ReportsLayout \/>\}>/)
  assert.match(reportsGate, /<Route index element=\{<Navigate to="ar-aging" replace \/>\} \/>/)
  assert.match(reportsGate, /<Route path="ar-aging" element=\{<ReportsArAging \/>\} \/>/)
  assert.match(reportsGate, /<Route path="revenue" element=\{<ReportsRevenue \/>\} \/>/)
  assert.match(reportsGate, /<Route path="pipeline" element=\{<ReportsPipeline \/>\} \/>/)
  assert.match(reportsGate, /<Route path="days-to-payment" element=\{<ReportsDaysToPayment \/>\} \/>/)
  assert.match(reportsGate, /<Route path="jobs-by-stage" element=\{<ReportsJobsByStage \/>\} \/>/)
})

test("catch-all route renders NotFound outside the auth-required branch", () => {
  const catchAllMatches = source.match(/<Route path="\*" element=\{<NotFoundPage \/>\} \/>/g)

  assert.equal(catchAllMatches?.length, 1)
  assert.match(
    source,
    /<Route path="\/403" element=\{<ForbiddenPage \/>\} \/>\s+<\/Route>\s+<\/Route>\s+<Route path="\*" element=\{<NotFoundPage \/>\} \/>/,
  )
})
