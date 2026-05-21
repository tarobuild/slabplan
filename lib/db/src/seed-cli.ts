import { seedDatabase } from "./seed";
import { pool } from "./index";

async function main() {
  const result = await seedDatabase();

  console.log(
    `Seeded ${result.users.length} users, ${result.jobs.length} jobs, ${result.leads.length} leads.`,
  );

  if (process.env.STONE_TRACK_PRINT_SEED_PASSWORD === "true") {
    console.log(`Seed user password: ${result.password}`);
  } else {
    console.log(
      "Seed user password hidden. Set STONE_TRACK_PRINT_SEED_PASSWORD=true for local-only display.",
    );
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
