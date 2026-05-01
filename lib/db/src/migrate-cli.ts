import { pool } from "./index";
import { applyMigrations } from "./migrate";

async function main() {
  const result = await applyMigrations();

  if (result.baselined.length > 0) {
    console.log(
      `Recorded baseline migrations as already applied: ${result.baselined.join(", ")}`,
    );
  }

  if (result.applied.length > 0) {
    console.log(`Applied migrations: ${result.applied.join(", ")}`);
    return;
  }

  console.log("No pending migrations.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
