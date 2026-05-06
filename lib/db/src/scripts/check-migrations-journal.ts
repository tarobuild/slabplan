import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(here, "../../migrations");
const journalPath = path.join(migrationsDir, "meta", "_journal.json");

type JournalEntry = {
  idx: number;
  tag: string;
  checksum?: string;
};
type Journal = { entries: JournalEntry[] };

function sha256(contents: string): string {
  return crypto.createHash("sha256").update(contents).digest("hex");
}

async function main() {
  const sqlFiles = (await fs.readdir(migrationsDir))
    .filter((entry) => entry.endsWith(".sql"))
    .sort((a, b) => a.localeCompare(b));

  const sqlChecksums = new Map<string, string>();
  await Promise.all(
    sqlFiles.map(async (file) => {
      const tag = file.replace(/\.sql$/, "");
      const contents = await fs.readFile(path.join(migrationsDir, file), "utf8");
      sqlChecksums.set(tag, sha256(contents));
    }),
  );

  const journalRaw = await fs.readFile(journalPath, "utf8");
  const journal = JSON.parse(journalRaw) as Journal;

  const errors: string[] = [];

  // Duplicate tag detection (Set-based comparison would mask these).
  const tagCounts = new Map<string, number>();
  const idxCounts = new Map<number, number>();
  for (const entry of journal.entries) {
    tagCounts.set(entry.tag, (tagCounts.get(entry.tag) ?? 0) + 1);
    idxCounts.set(entry.idx, (idxCounts.get(entry.idx) ?? 0) + 1);
  }
  for (const [tag, count] of tagCounts) {
    if (count > 1) errors.push(`Duplicate journal tag: ${tag} (x${count})`);
  }
  for (const [idx, count] of idxCounts) {
    if (count > 1) errors.push(`Duplicate journal idx: ${idx} (x${count})`);
  }

  // Missing on either side.
  const journalTags = new Set(journal.entries.map((e) => e.tag));
  for (const tag of sqlChecksums.keys()) {
    if (!journalTags.has(tag)) errors.push(`SQL file with no journal entry: ${tag}.sql`);
  }
  for (const tag of journalTags) {
    if (!sqlChecksums.has(tag)) errors.push(`Journal entry with no SQL file: ${tag}`);
  }

  // Per-entry content integrity.
  for (const entry of journal.entries) {
    const expected = sqlChecksums.get(entry.tag);
    if (expected === undefined) continue; // already reported above
    if (!entry.checksum) {
      errors.push(
        `Journal entry ${entry.tag} is missing a checksum. Run rebuild-migrations-journal.`,
      );
      continue;
    }
    if (entry.checksum !== expected) {
      errors.push(
        `Checksum mismatch for ${entry.tag}: journal=${entry.checksum.slice(0, 12)}… file=${expected.slice(0, 12)}…. ` +
          "If the SQL was edited intentionally, write a NEW migration; do not edit an applied one.",
      );
    }
  }

  if (errors.length === 0) {
    console.log(
      `OK: ${sqlFiles.length} SQL files match ${journal.entries.length} journal entries (tags, idxs, sha256 checksums all clean).`,
    );
    return;
  }

  console.error("Migration journal is out of sync with SQL files:");
  for (const err of errors) console.error(`  - ${err}`);
  console.error(
    "\nFix by running: pnpm --filter @workspace/db rebuild-migrations-journal",
  );
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
