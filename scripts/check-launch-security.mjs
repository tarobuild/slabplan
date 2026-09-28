import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const launchRoots = [
  "workspace",
  "@workspace/api-server",
  "@workspace/cadstone",
  "@workspace/api-spec",
];

export function assessLaunchAudit(audit, projects) {
  if (
    !audit?.advisories ||
    audit.error ||
    !audit.metadata?.vulnerabilities ||
    !Array.isArray(projects)
  ) {
    throw new Error("The dependency audit did not return a complete report.");
  }
  for (const root of launchRoots) {
    if (!projects.some((project) => project.name === root))
      throw new Error(`Missing launch dependency graph: ${root}`);
  }
  const installed = new Set();
  function visit(node) {
    for (const kind of [
      "dependencies",
      "devDependencies",
      "optionalDependencies",
    ]) {
      for (const [name, dependency] of Object.entries(node[kind] ?? {})) {
        installed.add(`${dependency.from ?? name}@${dependency.version}`);
        visit(dependency);
      }
    }
  }
  projects.forEach(visit);
  const included = [];
  const excluded = [];
  for (const advisory of Object.values(audit.advisories)) {
    if (
      !advisory.module_name ||
      !Array.isArray(advisory.findings) ||
      advisory.findings.length === 0 ||
      !["low", "moderate", "high", "critical"].includes(advisory.severity) ||
      advisory.findings.some((finding) => typeof finding.version !== "string")
    ) {
      throw new Error("The dependency audit returned a malformed advisory.");
    }
    // Match the installed graph, not pnpm's deduplicated advisory path. Shared
    // packages can be reported under a mobile/sandbox root but also ship on web.
    const matched = advisory.findings.some((finding) =>
      installed.has(`${advisory.module_name}@${finding.version}`),
    );
    (matched ? included : excluded).push(advisory);
  }
  return {
    included,
    excluded,
    blocking: included.filter(
      ({ severity }) => severity === "critical" || severity === "high",
    ),
  };
}

function runJson(args, allowAuditFindings = false) {
  let output;
  try {
    output = execFileSync("pnpm", args, {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (error) {
    if (!allowAuditFindings || !error.stdout) throw error;
    output = error.stdout;
  }
  return JSON.parse(output);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const projects = runJson([
      ...launchRoots.flatMap((root) => ["--filter", `${root}...`]),
      "list",
      "--depth",
      "Infinity",
      "--json",
    ]);
    const result = assessLaunchAudit(
      runJson(["audit", "--json"], true),
      projects,
    );
    console.log(
      `Launch audit: ${result.included.length} advisories in the web, API, codegen, and root build/test graph; ${result.blocking.length} high/critical.`,
    );
    for (const advisory of result.included)
      console.log(
        `${advisory.severity}: ${advisory.module_name} ${advisory.url}`,
      );
    console.log(
      `Other workspace advisories (mobile/sandbox, not deployed by build:web/build:api): ${result.excluded.length}. These remain in pnpm audit and are not suppressed.`,
    );
    if (result.blocking.length) process.exitCode = 1;
  } catch (error) {
    console.error(`Launch audit failed: ${error.message}`);
    process.exitCode = 1;
  }
}
