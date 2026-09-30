import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const source = readFileSync(new URL("./job-detail.tsx", import.meta.url), "utf8")

test("the job name wraps instead of truncating so the full record name stays visible", () => {
  const heading = /<h1 className="([^"]+)">\s*\{job\?\.title\}/.exec(source)
  assert.ok(heading, "job title heading must be present")
  assert.doesNotMatch(heading[1], /\btruncate\b/)
  assert.match(heading[1], /\[overflow-wrap:anywhere\]/)
  assert.match(source, /flex min-w-0 flex-wrap items-center gap-x-2\.5 gap-y-1">\s*<h1/)
})

test("the job header keeps the admin actions menu and real-name breadcrumbs", () => {
  assert.match(source, /Job actions/)
  assert.match(source, /useSetBreadcrumbs\(/)
  assert.match(source, /\{ label: "Clients", to: "\/clients" \}/)
})

test("client breadcrumb, back link and client link follow the clients route gate", () => {
  assert.match(source, /const canOpenClients = hasRoleAccess\(user\?\.role, ROLE_GATES\.clients\)/)
  // Every client destination on this page is behind the gate; other roles stay on Jobs.
  const clientLinks = source.match(/`\/clients\/\$\{job\.clientId\}`/g) ?? []
  assert.equal(clientLinks.length, 3)
  assert.match(source, /\.\.\.\(canOpenClients && job\.clientId\s*\?/)
  assert.match(source, /to=\{!canOpenClients \|\| !job\?\.clientId \? "\/jobs" : `\/clients\/\$\{job\.clientId\}`\}/)
  assert.match(source, /\{canOpenClients && job\.clientId \? \(\s*<Link\s*to=\{`\/clients\/\$\{job\.clientId\}`\}/)
  assert.match(source, /: \[\{ label: "Jobs", to: "\/jobs" \}\]/)
  assert.doesNotMatch(source, /isFieldUser/)
})

test("only admins pass the clients gate used by the job header", async () => {
  const { hasRoleAccess, ROLE_GATES } = await import("../lib/role-access.ts")
  assert.equal(hasRoleAccess("admin", ROLE_GATES.clients), true)
  for (const role of ["project_manager", "crew_member", "drafter", null, undefined]) {
    assert.equal(hasRoleAccess(role, ROLE_GATES.clients), false, String(role))
  }
})

test("job section tabs keep the selected pill and keyboard focus ring inside the scroller", () => {
  const nav = source.slice(source.indexOf('aria-label="Job sections"'), source.indexOf("</nav>"))
  // The scroller is padded so rings/pills are not clipped by its overflow edge.
  assert.match(nav, /className="[^"]*\bp-1\.5\b[^"]*md:overflow-x-auto/)
  // Selected state is a filled pill (not an underline that the overflow can hide)...
  assert.match(nav, /\? "bg-accent font-semibold text-accent-foreground"/)
  assert.doesNotMatch(nav, /border-b-2/)
  // ...and keyboard focus is a visible ring, not removed.
  assert.match(nav, /focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2/)
  assert.match(nav, /aria-current=\{isActive \? "page" : undefined\}/)
})
