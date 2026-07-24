import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { LeadsPostLeadsIdConvertToJobBody } from "../src/generated/api.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const generatedTypesDir = path.resolve(here, "../src/generated/types");

test("lead convert-to-job date overrides stay as calendar-date strings", async () => {
  const parsed = LeadsPostLeadsIdConvertToJobBody.parse({
    job: {
      projectedStart: "2026-04-01",
      projectedCompletion: "2026-04-30",
    },
  });

  assert.equal(parsed.job?.projectedStart, "2026-04-01");
  assert.equal(parsed.job?.projectedCompletion, "2026-04-30");
  assert.equal(typeof parsed.job?.projectedStart, "string");

  const invalid = LeadsPostLeadsIdConvertToJobBody.safeParse({
    job: {
      projectedStart: "2026-04-01T00:00:00.000Z",
    },
  });
  assert.equal(invalid.success, false);

  const source = await readFile(
    path.join(generatedTypesDir, "leadConvertToJobBodyJob.ts"),
    "utf8",
  );
  assert.doesNotMatch(source, /projectedStart\?: Date \| null;/);
  assert.doesNotMatch(source, /projectedCompletion\?: Date \| null;/);
  assert.match(source, /projectedStart\?: string \| null;/);
  assert.match(source, /projectedCompletion\?: string \| null;/);
});

test("lead convert-to-job body keeps clientId and newClient mutually exclusive", async () => {
  const existingClient = LeadsPostLeadsIdConvertToJobBody.safeParse({
    clientId: "11111111-1111-4111-8111-111111111111",
  });
  assert.equal(existingClient.success, true);

  const inlineClient = LeadsPostLeadsIdConvertToJobBody.safeParse({
    newClient: { companyName: "Cadstone" },
  });
  assert.equal(inlineClient.success, true);

  const omittedClientChoice = LeadsPostLeadsIdConvertToJobBody.safeParse({
    job: { title: "Converted lead" },
  });
  assert.equal(omittedClientChoice.success, true);

  const bothClientChoices = LeadsPostLeadsIdConvertToJobBody.safeParse({
    clientId: "11111111-1111-4111-8111-111111111111",
    newClient: { companyName: "Cadstone" },
  });
  assert.equal(bothClientChoices.success, false);

  const source = await readFile(
    path.join(generatedTypesDir, "leadConvertToJobBody.ts"),
    "utf8",
  );
  assert.match(source, /export type LeadConvertToJobBody =/);
  assert.match(source, /clientId: string;/);
  assert.match(source, /newClient\?: never;/);
  assert.match(source, /clientId\?: never;/);
  assert.doesNotMatch(source, /export interface LeadConvertToJobBody/);
});
