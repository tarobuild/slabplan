#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Orval's zod codegen emits a path-param schema and a query-param type that
// share the same identifier (`<Op>Params`) when an operation has both path
// AND query params. The two collide when re-exported via `export *`. We rename
// the path-only zod schema in the generated `api.ts` to `<Op>PathParams` to
// keep the wildcard re-export ambiguity-free.
const RENAMES = [
  ["FilesGetFoldersIdFilesParams", "FilesGetFoldersIdFilesPathParams"],
  [
    "ScheduleGetJobsJobIdScheduleParams",
    "ScheduleGetJobsJobIdSchedulePathParams",
  ],
  [
    "DailyLogsGetJobsJobIdDailyLogsParams",
    "DailyLogsGetJobsJobIdDailyLogsPathParams",
  ],
  // Multipart body schemas: orval emits both a zod runtime schema (in
  // api.ts) AND a TS type alias (in types/) under the same name, which
  // collide when re-exported via `export *`. Suffix the zod schema so
  // the TS body type retains the orval-canonical name.
  [
    "FinancialsPostJobsJobidFinancialsChangeOrdersParseBody",
    "FinancialsPostJobsJobidFinancialsChangeOrdersParseBodySchema",
  ],
  ["BillingPostCheckoutSessionsBody", "BillingPostCheckoutSessionsBodySchema"],
];

const here = path.dirname(fileURLToPath(import.meta.url));
// Mirrors orval.config.ts — read the staging dir name from env so the codegen
// wrapper script can run post-codegen against its staging output before swap.
const outDir = process.env.CODEGEN_OUTPUT_DIR ?? "generated";
const apiZodFile = path.resolve(
  here,
  "..",
  "..",
  "api-zod",
  "src",
  outDir,
  "api.ts",
);
const apiZodTypesDir = path.resolve(
  here,
  "..",
  "..",
  "api-zod",
  "src",
  outDir,
  "types",
);
const apiClientFile = path.resolve(
  here,
  "..",
  "..",
  "api-client-react",
  "src",
  outDir,
  "api.ts",
);
const apiClientSchemasFile = path.resolve(
  here,
  "..",
  "..",
  "api-client-react",
  "src",
  outDir,
  "api.schemas.ts",
);

const REPORT_OPERATIONS = [
  [
    "reportsGetReportsArAging",
    "ReportsGetReportsArAgingParams",
    "ArAgingResponse",
    "getReportsGetReportsArAgingUrl",
  ],
  [
    "reportsGetReportsRevenue",
    "ReportsGetReportsRevenueParams",
    "RevenueResponse",
    "getReportsGetReportsRevenueUrl",
  ],
  [
    "reportsGetReportsPipeline",
    "ReportsGetReportsPipelineParams",
    "PipelineResponse",
    "getReportsGetReportsPipelineUrl",
  ],
  [
    "reportsGetReportsDaysToPayment",
    "ReportsGetReportsDaysToPaymentParams",
    "DaysToPaymentResponse",
    "getReportsGetReportsDaysToPaymentUrl",
  ],
  [
    "reportsGetReportsJobsByStage",
    "ReportsGetReportsJobsByStageParams",
    "JobsByStageResponse",
    "getReportsGetReportsJobsByStageUrl",
  ],
];

function replaceQueryParamBooleans(source) {
  const markerPattern = /export const \w+QueryParams = zod\.object\(\{/g;
  let result = "";
  let cursor = 0;

  for (
    let match = markerPattern.exec(source);
    match;
    match = markerPattern.exec(source)
  ) {
    const start = match.index;
    const blockStart = markerPattern.lastIndex;
    const end = source.indexOf("\n});", blockStart);
    if (end === -1) break;
    const blockEnd = end + "\n});".length;
    const block = source
      .slice(start, blockEnd)
      .replace(/zod\s*\.\s*boolean\(\)/g, "stringBoolean");

    result += source.slice(cursor, start);
    result += block;
    cursor = blockEnd;
    markerPattern.lastIndex = blockEnd;
  }

  return result + source.slice(cursor);
}

function constrainCentsSchemas(source) {
  return source
    .replace(
      /(\b[A-Za-z0-9_]*Cents:\s*zod\s*\n)(\s*)\.number\(\)(?!\s*\n\s*\.int\(\))/g,
      "$1$2.number()\n$2.int()",
    )
    .replace(/(\b[A-Za-z0-9_]*Cents:\s*zod\.number\(\))(?!\.int\(\))/g, "$1.int()")
    .replace(/(\bamountCents:\s*zod\.number\(\))(?!\.int\(\))/g, "$1.int()");
}

function addReportParamHelpers(source) {
  if (source.includes("type CsvReportParams<TParams>")) {
    return source;
  }

  return source.replace(
    "type SecondParameter<T extends (...args: never) => unknown> = Parameters<T>[1];",
    `type SecondParameter<T extends (...args: never) => unknown> = Parameters<T>[1];

type CsvReportParams<TParams> = Omit<TParams, "format"> & { format: "csv" };

type JsonReportParams<TParams> = Omit<TParams, "format"> & {
  format?: "json";
};`,
  );
}

function addCsvReportOverloads(source) {
  let result = source;

  for (const [functionName, paramsType, responseType, urlFunction] of REPORT_OPERATIONS) {
    const functionPattern = new RegExp(
      `export const ${functionName} = async \\(\\n` +
        `  params\\?: ${paramsType},\\n` +
        `  options\\?: SecondParameter<typeof customFetch>,\\n` +
        `\\): Promise<${responseType}(?: \\| string)?> => \\{\\n` +
        `[\\s\\S]*?\\n` +
        `\\};`,
      "m",
    );

    result = result.replace(
      functionPattern,
      `export function ${functionName}(
  params: ${paramsType} & { format: "csv" },
  options?: SecondParameter<typeof customFetch>,
): Promise<string>;
export function ${functionName}(
  params?: ${paramsType} & { format?: "json" },
  options?: SecondParameter<typeof customFetch>,
): Promise<${responseType}>;
export function ${functionName}(
  params?: ${paramsType},
  options?: SecondParameter<typeof customFetch>,
): Promise<${responseType} | string> {
  return customFetch<${responseType} | string>(${urlFunction}(params), {
    ...options,
    method: "GET",
  });
}`,
    );

    let paramsOccurrence = 0;
    result = result.replace(
      new RegExp(`params\\?: ${paramsType},`, "g"),
      (match) => {
        paramsOccurrence += 1;
        return paramsOccurrence <= 2
          ? match
          : `params?: ${paramsType} & { format?: "json" },`;
      },
    );
  }

  return result;
}

function requireAtLeastOneUserUpdateField(source) {
  const before = source;
  source = source.replace(
    /export const UsersPatchUsersIdBody = zod\s+\.union\(\[zod\.unknown\(\), zod\.unknown\(\), zod\.unknown\(\)\]\)\s+\.and\(\s+zod\.object\(\{\s+fullName: zod\s+\.string\(\)\s+\.min\(usersPatchUsersIdBodyFourFullNameMin\)\s+\.max\(usersPatchUsersIdBodyFourFullNameMax\)\s+\.optional\(\),\s+role: zod\.enum\(\["admin", "project_manager", "crew_member"\]\)\.optional\(\),\s+isActive: zod\.boolean\(\)\.optional\(\),\s+\}\),\s+\)/m,
    `export const UsersPatchUsersIdBody = zod
  .object({
    fullName: zod
      .string()
      .min(usersPatchUsersIdBodyFourFullNameMin)
      .max(usersPatchUsersIdBodyFourFullNameMax)
      .optional(),
    role: zod.enum(["admin", "project_manager", "crew_member"]).optional(),
    isActive: zod.boolean().optional(),
  })
  .refine(
    (value) =>
      value.fullName !== undefined ||
      value.role !== undefined ||
      value.isActive !== undefined,
    { message: "At least one field is required." },
  )`,
  );

  return source === before ? before : source;
}

function normalizeUsersUpdateUserType(source) {
  return source.replace(
    /export type UsersUpdateUserSchema = unknown & \{\n([\s\S]*?)\n\};/m,
    `type UsersUpdateUserSchemaBase = {
$1
};

export type UsersUpdateUserSchema =
  | (UsersUpdateUserSchemaBase & { fullName: string })
  | (UsersUpdateUserSchemaBase & { role: UsersUpdateUserSchemaRole })
  | (UsersUpdateUserSchemaBase & { isActive: boolean });`,
  );
}

function normalizeLeadsContactCreateType(source) {
  return source.replace(
    /export type LeadsContactCreateSchema = unknown & \{\n([\s\S]*?)\n\};/m,
    `type LeadsContactCreateSchemaBase = {
$1
};

export type LeadsContactCreateSchema =
  | (LeadsContactCreateSchemaBase & { sourceContactId: string })
  | (LeadsContactCreateSchemaBase & {
      displayName: string;
      email: string;
    });`,
  );
}

function requireLeadContactCreateFields(source) {
  return source.replace(
    /export const LeadsPostLeadsIdContactsBody = zod\s+\.union\(\[zod\.unknown\(\), zod\.unknown\(\)\]\)\s+\.and\(\s+(zod\.object\(\{[\s\S]*?\n\s+\}\)),\s+\)/m,
    `export const LeadsPostLeadsIdContactsBody = $1
  .refine(
    (value) =>
      Boolean(value.sourceContactId) ||
      (Boolean(value.displayName) && Boolean(value.email)),
    {
      message: "Provide sourceContactId or displayName and email.",
    },
  )`,
  );
}

function normalizeReportParamsTypes(source) {
  let result = source;

  for (const [, paramsType] of REPORT_OPERATIONS) {
    result = result.replace(
      new RegExp(`export type ${paramsType} = \\{[\\s\\S]*?\\n\\};`, "m"),
      `type ${paramsType}Base = {
  format?: ReportFormatParamParameter;
};

export type ${paramsType} =
  | (${paramsType}Base & {
      range?: Exclude<ReportRangeParamParameter, "custom">;
      from?: ReportFromParamParameter;
      to?: ReportToParamParameter;
    })
  | (${paramsType}Base & {
      range: "custom";
      from: ReportFromParamParameter;
      to: ReportToParamParameter;
    });`,
    );
  }

  return result;
}

function normalizeWorkdayExceptionPayloadType(source) {
  return source.replace(
    /export type WorkdayExceptionPayload =\n  \| \{\n([\s\S]*?)\n      \/\*\* When true, applies the exception to every active job\. Admin role required\. \*\/\n      appliesToAllJobs: boolean;\n      \/\*\* @maxItems 0 \*\/\n      jobIds\?: string\[\];\n([\s\S]*?)\n    \}\n  \| \{\n([\s\S]*?)\n      \/\*\* When false or omitted, `jobIds` must contain at least one job\. \*\/\n      appliesToAllJobs\?: boolean;\n      \/\*\* @minItems 1 \*\/\n      jobIds: string\[\];\n([\s\S]*?)\n    \};/m,
    `export type WorkdayExceptionPayload =
  | {
$1
      /** When true, applies the exception to every active job. Admin role required. */
      appliesToAllJobs: true;
      /** @maxItems 0 */
      jobIds?: [];
$2
    }
  | {
$3
      /** When false or omitted, \`jobIds\` must contain at least one job. */
      appliesToAllJobs?: false;
      /** @minItems 1 */
      jobIds: [string, ...string[]];
$4
    };`,
  );
}

const original = await readFile(apiZodFile, "utf8");
let next = original;

for (const [from, to] of RENAMES) {
  // Only the standalone identifier (not part of QueryParams etc.).
  next = next.replace(new RegExp(`\\b${from}\\b(?!Q)`, "g"), to);
}

next = next.replace(
  'import * as zod from "zod";',
  `import * as zod from "zod";

const stringBoolean = zod.preprocess((value) => {
  if (typeof value !== "string") return value;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  return value;
}, zod.boolean());`,
);

next = replaceQueryParamBooleans(next);
next = constrainCentsSchemas(next);
next = requireAtLeastOneUserUpdateField(next);
next = requireLeadContactCreateFields(next);

if (next !== original) {
  await writeFile(apiZodFile, next, "utf8");
  console.log(
    `[post-codegen] Renamed ${RENAMES.length} colliding zod path-param schemas in ${path.relative(process.cwd(), apiZodFile)}`,
  );
} else {
  console.log("[post-codegen] No renames applied.");
}

const usersUpdateUserSchemaFile = path.join(
  apiZodTypesDir,
  "usersUpdateUserSchema.ts",
);
const usersUpdateUserSchemaOriginal = await readFile(
  usersUpdateUserSchemaFile,
  "utf8",
);
const usersUpdateUserSchemaNext = normalizeUsersUpdateUserType(
  usersUpdateUserSchemaOriginal,
);

if (usersUpdateUserSchemaNext !== usersUpdateUserSchemaOriginal) {
  await writeFile(usersUpdateUserSchemaFile, usersUpdateUserSchemaNext, "utf8");
  console.log(
    `[post-codegen] Normalized UsersUpdateUserSchema at-least-one contract in ${path.relative(process.cwd(), usersUpdateUserSchemaFile)}`,
  );
}

const leadsContactCreateSchemaFile = path.join(
  apiZodTypesDir,
  "leadsContactCreateSchema.ts",
);
const leadsContactCreateSchemaOriginal = await readFile(
  leadsContactCreateSchemaFile,
  "utf8",
);
const leadsContactCreateSchemaNext = normalizeLeadsContactCreateType(
  leadsContactCreateSchemaOriginal,
);

if (leadsContactCreateSchemaNext !== leadsContactCreateSchemaOriginal) {
  await writeFile(
    leadsContactCreateSchemaFile,
    leadsContactCreateSchemaNext,
    "utf8",
  );
  console.log(
    `[post-codegen] Normalized LeadsContactCreateSchema conditional contract in ${path.relative(process.cwd(), leadsContactCreateSchemaFile)}`,
  );
}

const workdayExceptionPayloadFile = path.join(
  apiZodTypesDir,
  "workdayExceptionPayload.ts",
);
const workdayExceptionPayloadOriginal = await readFile(
  workdayExceptionPayloadFile,
  "utf8",
);
const workdayExceptionPayloadNext = normalizeWorkdayExceptionPayloadType(
  workdayExceptionPayloadOriginal,
);

if (workdayExceptionPayloadNext !== workdayExceptionPayloadOriginal) {
  await writeFile(
    workdayExceptionPayloadFile,
    workdayExceptionPayloadNext,
    "utf8",
  );
  console.log(
    `[post-codegen] Normalized WorkdayExceptionPayload target contract in ${path.relative(process.cwd(), workdayExceptionPayloadFile)}`,
  );
}

for (const [, paramsType] of REPORT_OPERATIONS) {
  const reportParamsFile = path.join(
    apiZodTypesDir,
    `${paramsType.charAt(0).toLowerCase()}${paramsType.slice(1)}.ts`,
  );
  const reportParamsOriginal = await readFile(reportParamsFile, "utf8");
  const reportParamsNext = normalizeReportParamsTypes(reportParamsOriginal);

  if (reportParamsNext !== reportParamsOriginal) {
    await writeFile(reportParamsFile, reportParamsNext, "utf8");
    console.log(
      `[post-codegen] Normalized custom report range contract in ${path.relative(process.cwd(), reportParamsFile)}`,
    );
  }
}

const clientOriginal = await readFile(apiClientFile, "utf8");
let clientNext = clientOriginal;

clientNext = clientNext.replace(
  'import { customFetch } from "../custom-fetch";',
  'import { customFetch, mergeRequestHeaders } from "../custom-fetch";',
);

clientNext = clientNext.replace(
  /headers: \{ "Content-Type": "application\/json", \.\.\.options\?\.headers \}/g,
  'headers: mergeRequestHeaders({ "Content-Type": "application/json" }, options?.headers)',
);

clientNext = clientNext.replace(
  /if \(value !== undefined\) \{\n\s+normalizedParams\.append\(key, value === null \? "null" : value\.toString\(\)\);\n\s+\}/g,
  `if (value !== undefined && value !== null) {
      normalizedParams.append(key, value.toString());
    }`,
);

clientNext = clientNext.replace(
  /options\?: RequestInit,/g,
  "options?: SecondParameter<typeof customFetch>,",
);

clientNext = addCsvReportOverloads(clientNext);

if (clientNext !== clientOriginal) {
  await writeFile(apiClientFile, clientNext, "utf8");
  console.log(
    `[post-codegen] Normalized generated client request headers/options in ${path.relative(process.cwd(), apiClientFile)}`,
  );
} else {
  console.log("[post-codegen] No generated client rewrites applied.");
}

const clientSchemasOriginal = await readFile(apiClientSchemasFile, "utf8");
const clientSchemasNext = normalizeWorkdayExceptionPayloadType(
  normalizeLeadsContactCreateType(
    normalizeReportParamsTypes(clientSchemasOriginal),
  ),
);

if (clientSchemasNext !== clientSchemasOriginal) {
  await writeFile(apiClientSchemasFile, clientSchemasNext, "utf8");
  console.log(
    `[post-codegen] Normalized generated client report param contracts in ${path.relative(process.cwd(), apiClientSchemasFile)}`,
  );
}
