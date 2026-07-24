import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { LeadsGetLeadsResponse } from "../src/generated/api.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const generatedTypesDir = path.resolve(here, "../src/generated/types");

test("lead list projectedSalesDate remains a calendar-date string", async () => {
  const parsed = LeadsGetLeadsResponse.parse({
    leads: [
      {
        id: "11111111-1111-4111-8111-111111111111",
        title: "Kitchen remodel",
        streetAddress: null,
        city: null,
        state: null,
        zipCode: null,
        confidence: 50,
        projectedSalesDate: "2026-04-01",
        estimatedRevenueMin: "1000",
        estimatedRevenueMax: "2000",
        status: "open",
        projectType: null,
        leadSource: null,
        createdAt: "2026-03-01T12:00:00.000Z",
        updatedAt: null,
        createdByName: null,
        clientContact: null,
        convertedJob: null,
      },
    ],
    pagination: {
      page: 1,
      pageSize: 25,
      totalItems: 1,
      totalPages: 1,
    },
    summary: {
      estimatedRevenueMinTotal: "1000",
      estimatedRevenueMaxTotal: "2000",
    },
  });

  assert.equal(parsed.leads[0]?.projectedSalesDate, "2026-04-01");
  assert.equal(typeof parsed.leads[0]?.projectedSalesDate, "string");

  const invalid = LeadsGetLeadsResponse.safeParse({
    ...parsed,
    leads: [
      {
        ...parsed.leads[0],
        projectedSalesDate: "2026-04-01T00:00:00.000Z",
      },
    ],
  });
  assert.equal(invalid.success, false);

  for (const file of ["leadListItem.ts", "leadDetail.ts"]) {
    const source = await readFile(path.join(generatedTypesDir, file), "utf8");
    assert.doesNotMatch(source, /projectedSalesDate\?: Date \| null;/);
    assert.match(source, /projectedSalesDate\?: string \| null;/);
  }
});
