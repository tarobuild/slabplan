import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import type { ArAgingRow } from "../src/generated/types/arAgingRow.ts";
import type { ClientDetailRollups } from "../src/generated/types/clientDetailRollups.ts";
import type { ClientListItem } from "../src/generated/types/clientListItem.ts";
import type { JobSummary } from "../src/generated/types/jobSummary.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const generatedTypesDir = path.resolve(here, "../src/generated/types");

function asNumber(value: number) {
  return value;
}

test("generated money rollup fields are JSON numbers, not bigint", async () => {
  const files = [
    "arAgingRow.ts",
    "clientListItem.ts",
    "clientDetailRollups.ts",
    "jobSummary.ts",
  ];

  for (const file of files) {
    const source = await readFile(path.join(generatedTypesDir, file), "utf8");

    assert.doesNotMatch(source, /:\s*bigint\b/);
    assert.doesNotMatch(source, /bigint\s*\|/);
  }

  const listItemMoney: Pick<
    ClientListItem,
    "contractValueCents" | "amountPaidCents" | "outstandingCents"
  > = {
    contractValueCents: 120_000,
    amountPaidCents: 45_000,
    outstandingCents: 75_000,
  };
  const rollups: Pick<
    ClientDetailRollups,
    "contractValueCents" | "amountPaidCents" | "outstandingCents"
  > = listItemMoney;
  const jobSummaryMoney: Pick<JobSummary, "contractValueCents" | "amountPaidCents"> = {
    contractValueCents: 120_000,
    amountPaidCents: 45_000,
  };
  const agingMoney: Pick<
    ArAgingRow,
    "current" | "d1to30" | "d31to60" | "d61to90" | "d90plus" | "total"
  > = {
    current: 10_000,
    d1to30: 20_000,
    d31to60: 30_000,
    d61to90: 40_000,
    d90plus: 50_000,
    total: 150_000,
  };

  assert.equal(asNumber(listItemMoney.contractValueCents), 120_000);
  assert.equal(asNumber(rollups.outstandingCents), 75_000);
  assert.equal(asNumber(jobSummaryMoney.amountPaidCents ?? 0), 45_000);
  assert.equal(asNumber(agingMoney.total), 150_000);
});

test("A/R aging money fields document cents and safe integer bounds", async () => {
  const source = await readFile(path.join(generatedTypesDir, "arAgingRow.ts"), "utf8");

  for (const field of ["current", "d1to30", "d31to60", "d61to90", "d90plus", "total"]) {
    assert.match(source, new RegExp(`Whole cents[\\s\\S]*@maximum 9007199254740991[\\s\\S]*${field}: number;`));
  }
});
