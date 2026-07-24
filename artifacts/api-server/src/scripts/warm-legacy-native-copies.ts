import { and, eq, gt, gte, isNull, lte } from "drizzle-orm";
import { db, pool } from "@workspace/db";
import { files } from "@workspace/db/schema";
import {
  inspectStoredFileNativeCopy,
  warmStoredFileNativeCopy,
} from "../lib/storage";

const LEGACY_MULTIPART_MIN_BYTES = 24 * 1024 * 1024;

type Options = {
  dryRun: boolean;
  limit?: number;
  fileId?: string;
  since?: Date;
  until?: Date;
};

function parsePositiveInteger(value: string | undefined, flag: string): number {
  if (!value || !/^\d+$/.test(value)) {
    throw new Error(`${flag} requires a positive integer.`);
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} requires a positive integer.`);
  }
  return parsed;
}

function parseDate(value: string | undefined, flag: string): Date {
  if (!value) {
    throw new Error(`${flag} requires an ISO date or timestamp.`);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) {
    throw new Error(`${flag} requires an ISO date or timestamp.`);
  }
  return parsed;
}

function parseOptions(args: readonly string[]): Options {
  const options: Options = { dryRun: false };
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    switch (flag) {
      case "--":
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--limit":
        options.limit = parsePositiveInteger(args[++index], flag);
        break;
      case "--file-id": {
        const value = args[++index]?.trim();
        if (!value) throw new Error(`${flag} requires a file id.`);
        options.fileId = value;
        break;
      }
      case "--since":
        options.since = parseDate(args[++index], flag);
        break;
      case "--until":
        options.until = parseDate(args[++index], flag);
        break;
      default:
        throw new Error(`Unknown argument: ${flag}`);
    }
  }
  if (options.since && options.until && options.since > options.until) {
    throw new Error("--since must not be later than --until.");
  }
  return options;
}

function safeLogName(value: string): string {
  return value.replace(/[\r\n\t]/g, " ");
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  console.log(
    "[warm-legacy-native-copies] SAFETY: reads source objects; writes only derived .cadstone-native objects; performs zero DELETE operations and zero database writes; idempotent and safe to interrupt.",
  );
  console.log(
    `[warm-legacy-native-copies] mode=${options.dryRun ? "dry-run (zero storage writes)" : "materialize"}`,
  );

  const filters = [
    isNull(files.deletedAt),
    gt(files.fileSize, LEGACY_MULTIPART_MIN_BYTES),
  ];
  if (options.fileId) filters.push(eq(files.id, options.fileId));
  if (options.since) filters.push(gte(files.createdAt, options.since));
  if (options.until) filters.push(lte(files.createdAt, options.until));

  const baseQuery = db
    .select({
      id: files.id,
      originalName: files.originalName,
      fileUrl: files.fileUrl,
      fileSize: files.fileSize,
      createdAt: files.createdAt,
    })
    .from(files)
    .where(and(...filters))
    .orderBy(files.createdAt, files.id);
  const candidates = options.limit
    ? await baseQuery.limit(options.limit)
    : await baseQuery;

  const counts = {
    native: 0,
    alreadyMaterialized: 0,
    needsMaterialization: 0,
    created: 0,
    failed: 0,
  };

  for (const candidate of candidates) {
    const startedAt = Date.now();
    let outcome = "failed";
    try {
      if (!candidate.fileUrl) {
        throw new Error("database row has no storage URL");
      }
      if (options.dryRun) {
        const inspected = await inspectStoredFileNativeCopy(candidate.fileUrl);
        outcome = inspected;
        if (inspected === "native") counts.native += 1;
        if (inspected === "already-materialized")
          counts.alreadyMaterialized += 1;
        if (inspected === "needs-materialization")
          counts.needsMaterialization += 1;
      } else {
        const warmed = await warmStoredFileNativeCopy(candidate.fileUrl);
        outcome = warmed;
        if (warmed === "native") counts.native += 1;
        if (warmed === "already-materialized") counts.alreadyMaterialized += 1;
        if (warmed === "created") counts.created += 1;
      }
    } catch (error) {
      counts.failed += 1;
      outcome = `failed:${error instanceof Error ? error.message : String(error)}`;
    }
    console.log(
      `[warm-legacy-native-copies] id=${candidate.id} name=${JSON.stringify(safeLogName(candidate.originalName))} size=${candidate.fileSize ?? "unknown"} createdAt=${candidate.createdAt.toISOString()} outcome=${JSON.stringify(outcome)} ms=${Date.now() - startedAt}`,
    );
  }

  console.log(
    `[warm-legacy-native-copies] summary candidates=${candidates.length} native=${counts.native} alreadyMaterialized=${counts.alreadyMaterialized} needsMaterialization=${counts.needsMaterialization} created=${counts.created} failed=${counts.failed}`,
  );
  if (counts.failed > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error("[warm-legacy-native-copies] fatal", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
