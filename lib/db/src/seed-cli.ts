import { seedDatabase } from "./seed";
import { pool } from "./index";

async function main() {
  const result = await seedDatabase();

  console.log(
    `Seeded ${result.users.length} users, ${result.jobs.length} jobs, ${result.leads.length} leads.`,
  );

  // Dev-only CLI helper: print the freshly generated seed credential
  // so operators can copy it. Both scanners flag this line as
  // "password sent to standard output", but this script is invoked
  // manually in development against a local database — there is no
  // production codepath that runs it. Suppressed at scan-config level
  // (.hounddogignore + semgrep paths.exclude) and inline below for
  // human readers.
  // nosemgrep: vendored-rules.generic.secrets.gitleaks.generic-api-key
  // hounddog-ignore-next-line: PASSWORD
  console.log(`Seed user password: ${result.password}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
