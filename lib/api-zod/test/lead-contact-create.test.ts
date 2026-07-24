import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { LeadsPostLeadsIdContactsBody } from "../src/generated/api.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const generatedTypePath = path.resolve(
  here,
  "../src/generated/types/leadsContactCreateSchema.ts",
);

test("lead contact create generated type encodes clone and manual branches", async () => {
  const source = await readFile(generatedTypePath, "utf8");

  assert.match(source, /export type LeadsContactCreateSchema =/);
  assert.match(source, /sourceContactId: string;/);
  assert.match(source, /displayName: string;/);
  assert.match(source, /email: string;/);
  assert.doesNotMatch(source, /export interface LeadsContactCreateSchema/);

  const manualBranch = source.split(/\n\s*\}\n\s*\| \{\n/, 2)[1] ?? "";
  assert.match(manualBranch, /displayName: string;/);
  assert.match(manualBranch, /email: string;/);
  assert.doesNotMatch(manualBranch, /displayName\?: string \| null;/);
  assert.doesNotMatch(manualBranch, /email\?: string \| null;/);
});

test("lead contact create parser rejects bodies the API rejects", () => {
  assert.equal(LeadsPostLeadsIdContactsBody.safeParse({}).success, false);
  assert.equal(
    LeadsPostLeadsIdContactsBody.safeParse({
      displayName: null,
      email: null,
    }).success,
    false,
  );
  assert.equal(
    LeadsPostLeadsIdContactsBody.safeParse({
      sourceContactId: "11111111-1111-4111-8111-111111111111",
    }).success,
    true,
  );
  assert.equal(
    LeadsPostLeadsIdContactsBody.safeParse({
      displayName: "Primary Buyer",
      email: "buyer@example.com",
    }).success,
    true,
  );
});
