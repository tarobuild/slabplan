import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  reportsGetReportsArAging,
  reportsGetReportsDaysToPayment,
  reportsGetReportsJobsByStage,
  reportsGetReportsPipeline,
  reportsGetReportsRevenue,
} from "../src/generated/api.ts";

const originalFetch = globalThis.fetch;
const here = path.dirname(fileURLToPath(import.meta.url));
const generatedApiPath = path.resolve(here, "../src/generated/api.ts");
const openApiPath = path.resolve(here, "../../api-spec/openapi.yaml");

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const reportCases = [
  {
    path: "/api/reports/ar-aging?format=csv",
    operation: "reportsGetReportsArAging",
    responseType: "ArAgingResponse",
    run: () => reportsGetReportsArAging({ format: "csv" }),
  },
  {
    path: "/api/reports/revenue?format=csv",
    operation: "reportsGetReportsRevenue",
    responseType: "RevenueResponse",
    run: () => reportsGetReportsRevenue({ format: "csv" }),
  },
  {
    path: "/api/reports/pipeline?format=csv",
    operation: "reportsGetReportsPipeline",
    responseType: "PipelineResponse",
    run: () => reportsGetReportsPipeline({ format: "csv" }),
  },
  {
    path: "/api/reports/days-to-payment?format=csv",
    operation: "reportsGetReportsDaysToPayment",
    responseType: "DaysToPaymentResponse",
    run: () => reportsGetReportsDaysToPayment({ format: "csv" }),
  },
  {
    path: "/api/reports/jobs-by-stage?format=csv",
    operation: "reportsGetReportsJobsByStage",
    responseType: "JobsByStageResponse",
    run: () => reportsGetReportsJobsByStage({ format: "csv" }),
  },
] as const;

test("report endpoints declare text/csv and generated clients expose string return types", async () => {
  const [openApi, generatedApi] = await Promise.all([
    readFile(openApiPath, "utf8"),
    readFile(generatedApiPath, "utf8"),
  ]);

  for (const report of reportCases) {
    assert.match(openApi, new RegExp(`${report.path.split("?")[0].slice(5)}:[\\s\\S]*?text/csv:`));
    assert.match(
      generatedApi,
      new RegExp(
        `export const ${report.operation} = async \\([\\s\\S]*?\\): Promise<${report.responseType} \\| string> =>`,
      ),
    );
    assert.match(
      generatedApi,
      new RegExp(`customFetch<${report.responseType} \\| string>`),
    );
  }
});

test("generated report clients return text for CSV responses", async () => {
  const csv = "name,total\nCadstone,42\n";
  const calls: Array<RequestInfo | URL> = [];

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    calls.push(input);
    return new Response(csv, {
      headers: { "content-type": "text/csv; charset=utf-8" },
    });
  }) as typeof fetch;

  for (const report of reportCases) {
    const result = await report.run();

    assert.equal(result, csv);
  }

  assert.deepEqual(
    calls.map((call) => call.toString()),
    reportCases.map((report) => report.path),
  );
});
