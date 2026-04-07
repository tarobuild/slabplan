import { seedDatabase } from "./seed";
import { pool } from "./index";

async function main() {
  const result = await seedDatabase();

  console.log(
    `Seeded ${result.users.length} users, ${result.jobs.length} jobs, ${result.leads.length} leads.`,
  );
  console.log(`Seed password: ${result.password}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
