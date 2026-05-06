import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(here, "../../migrations");
const journalPath = path.join(migrationsDir, "meta", "_journal.json");

async function main() {
  const files = (await fs.readdir(migrationsDir))
    .filter((entry) => entry.endsWith(".sql"))
    .sort((a, b) => a.localeCompare(b));

  const entries = await Promise.all(
    files.map(async (file, idx) => {
      const fullPath = path.join(migrationsDir, file);
      const [stat, contents] = await Promise.all([
        fs.stat(fullPath),
        fs.readFile(fullPath, "utf8"),
      ]);
      const checksum = crypto
        .createHash("sha256")
        .update(contents)
        .digest("hex");
      return {
        idx,
        version: "7",
        when: Math.floor(stat.mtimeMs),
        tag: file.replace(/\.sql$/, ""),
        breakpoints: true,
        checksum,
      };
    }),
  );

  const journal = {
    version: "7",
    dialect: "postgresql",
    entries,
  };

  await fs.writeFile(journalPath, `${JSON.stringify(journal, null, 2)}\n`);
  console.log(
    `Wrote ${entries.length} entries (with sha256 checksums) to ${path.relative(process.cwd(), journalPath)}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
