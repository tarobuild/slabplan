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
  ["FoldersGetJobsJobIdFolderTreeParams", "FoldersGetJobsJobIdFolderTreePathParams"],
  ["FilesGetFoldersIdFilesDuplicatesParams", "FilesGetFoldersIdFilesDuplicatesPathParams"],
  ["ScheduleGetJobsJobIdScheduleParams", "ScheduleGetJobsJobIdSchedulePathParams"],
  ["DailyLogsGetJobsJobIdDailyLogsParams", "DailyLogsGetJobsJobIdDailyLogsPathParams"],
  // Multipart body schemas: orval emits both a zod runtime schema (in
  // api.ts) AND a TS type alias (in types/) under the same name, which
  // collide when re-exported via `export *`. Suffix the zod schema so
  // the TS body type retains the orval-canonical name.
  [
    "FinancialsPostJobsJobidFinancialsChangeOrdersParseBody",
    "FinancialsPostJobsJobidFinancialsChangeOrdersParseBodySchema",
  ],
];

const STRICT_BODY_EXPORTS = [
  "UsersPutUsersMeBody",
  "UsersPostUsersMePasswordBody",
  "FoldersPostJobsJobIdFoldersBody",
  "FoldersPutFoldersIdBody",
  "FoldersPutFoldersIdMoveBody",
  "FilesPutFilesIdBody",
];

const here = path.dirname(fileURLToPath(import.meta.url));
// Mirrors orval.config.ts — read the staging dir name from env so the codegen
// wrapper script can run post-codegen against its staging output before swap.
const outDir = process.env.CODEGEN_OUTPUT_DIR ?? "generated";
const apiClientFile = path.resolve(here, "..", "..", "api-client-react", "src", outDir, "api.ts");
const apiClientSchemasFile = path.resolve(here, "..", "..", "api-client-react", "src", outDir, "api.schemas.ts");
const apiZodFile = path.resolve(here, "..", "..", "api-zod", "src", outDir, "api.ts");
const apiZodTypesDir = path.resolve(here, "..", "..", "api-zod", "src", outDir, "types");

const atLeastOneHelper = `type AtLeastOne<T, Keys extends keyof T = keyof T> = Pick<T, Exclude<keyof T, Keys>> &
  {
    [K in Keys]-?: Required<Pick<T, K>> & Partial<Pick<T, Exclude<Keys, K>>>;
  }[Keys];`;

function tightenUsersUpdateType(source) {
  return source.replace(
    /export interface UsersUpdateUserSchema \{\n([\s\S]*?)\n\}/,
    `${atLeastOneHelper}

type UsersUpdateUserSchemaFields = {
$1
};

export type UsersUpdateUserSchema = AtLeastOne<UsersUpdateUserSchemaFields>;`,
  );
}

function tightenWorkdayExceptionPayloadType(source) {
  return source.replace(
    /export interface WorkdayExceptionPayload \{\n([\s\S]*?)\n  \/\*\* When true, applies the exception to every active job\. Admin role required\. \*\/\n  appliesToAllJobs\?: boolean;\n  jobIds\?: string\[\];\n  notes\?: string \| null;\n\}/,
    `type WorkdayExceptionPayloadBase = {
$1
  notes?: string | null;
};

type WorkdayExceptionPayloadAllJobs = WorkdayExceptionPayloadBase & {
  /** When true, applies the exception to every active job. Admin role required. */
  appliesToAllJobs: true;
  jobIds?: string[];
};

type WorkdayExceptionPayloadJobIds = WorkdayExceptionPayloadBase & {
  appliesToAllJobs?: false;
  jobIds: [string, ...string[]];
};

export type WorkdayExceptionPayload =
  | WorkdayExceptionPayloadAllJobs
  | WorkdayExceptionPayloadJobIds;`,
  );
}

function tightenLeadConvertToJobBodyType(source) {
  return source.replace(
    /\/\*\*\n \* Optional payload for `POST \/leads\/\{id\}\/convert-to-job`\.[\s\S]*?\*\/\nexport interface LeadConvertToJobBody \{\n  \/\*\* Existing client to associate with the new job\. \*\/\n  clientId\?: string;\n  \/\*\* Inline client to create as part of the conversion\. Mutually exclusive with `clientId`\. \*\/\n  newClient\?: LeadConvertToJobBodyNewClient;\n  \/\*\* Overrides for the job that will be created\. Anything omitted falls back to the lead's value\. \*\/\n  job\?: LeadConvertToJobBodyJob;\n\}/,
    `/**
 * Optional payload for \`POST /leads/{id}/convert-to-job\`. \`clientId\` attaches the new job to an existing client; \`newClient\` creates a client inline. The endpoint also accepts an omitted client choice for backwards compatibility, but \`clientId\` and \`newClient\` are mutually exclusive. \`job\` carries optional overrides applied on top of the lead's pre-fill values.
 */
type LeadConvertToJobBodyBase = {
  /** Overrides for the job that will be created. Anything omitted falls back to the lead's value. */
  job?: LeadConvertToJobBodyJob;
};

export type LeadConvertToJobBody =
  | (LeadConvertToJobBodyBase & {
      /** Existing client to associate with the new job. */
      clientId: string;
      newClient?: never;
    })
  | (LeadConvertToJobBodyBase & {
      clientId?: never;
      /** Inline client to create as part of the conversion. Mutually exclusive with \`clientId\`. */
      newClient: LeadConvertToJobBodyNewClient;
    })
  | (LeadConvertToJobBodyBase & {
      clientId?: undefined;
      newClient?: undefined;
    });`,
  );
}

const REPORT_PARAM_TYPE_NAMES = [
  "ReportsGetReportsArAgingParams",
  "ReportsGetReportsRevenueParams",
  "ReportsGetReportsPipelineParams",
  "ReportsGetReportsDaysToPaymentParams",
  "ReportsGetReportsJobsByStageParams",
];

function tightenReportParamsType(source, typeName) {
  const pattern = new RegExp(
    `export type ${typeName} = \\{\\n` +
      `([\\s\\S]*?)` +
      `  /\\*\\*\\n` +
      `   \\* Response format\\. JSON \\(default\\) or CSV download\\.\\n` +
      `   \\*/\\n` +
      `  format\\?: ReportFormatParamParameter;\\n` +
      `\\};`,
  );

  return source.replace(
    pattern,
    `type ${typeName}Base = {
  /**
   * Response format. JSON (default) or CSV download.
   */
  format?: ReportFormatParamParameter;
};

type ${typeName}Preset = ${typeName}Base & {
  /**
   * Preset date range. Use \`custom\` together with \`from\` and \`to\`.
   */
  range?: Exclude<ReportRangeParamParameter, "custom">;
  from?: never;
  to?: never;
};

type ${typeName}Custom = ${typeName}Base & {
  range: "custom";
  /**
   * Inclusive start date (YYYY-MM-DD). Required when \`range=custom\`.
   * @pattern ^\\d{4}-\\d{2}-\\d{2}$
   */
  from: ReportFromParamParameter;
  /**
   * Inclusive end date (YYYY-MM-DD). Required when \`range=custom\`.
   * @pattern ^\\d{4}-\\d{2}-\\d{2}$
   */
  to: ReportToParamParameter;
};

export type ${typeName} = ${typeName}Preset | ${typeName}Custom;`,
  );
}

function tightenReportParamsTypes(source) {
  return REPORT_PARAM_TYPE_NAMES.reduce(
    (next, typeName) => tightenReportParamsType(next, typeName),
    source,
  );
}

const apiClientOriginal = await readFile(apiClientFile, "utf8");
let apiClientNext = apiClientOriginal;

const jsonHeaderSource = `headers: { "Content-Type": "application/json", ...options?.headers },`;
const jsonHeaderPattern = /headers: \{ "Content-Type": "application\/json", \.\.\.options\?\.headers \},/g;
if (apiClientNext.includes(jsonHeaderSource)) {
  apiClientNext = apiClientNext.replace(
    /import \{ customFetch \} from "\.\.\/custom-fetch";/,
    `import { customFetch, jsonContentTypeHeaders } from "../custom-fetch";`,
  );
  apiClientNext = apiClientNext.replace(
    jsonHeaderPattern,
    "headers: jsonContentTypeHeaders(options?.headers),",
  );
}

apiClientNext = apiClientNext.replace(
  /if \(value !== undefined\) \{\n\s+normalizedParams\.append\(key, value === null \? "null" : value\.toString\(\)\);\n\s+\}/g,
  `if (value != null) {
      normalizedParams.append(key, value.toString());
    }`,
);

if (apiClientNext !== apiClientOriginal) {
  await writeFile(apiClientFile, apiClientNext, "utf8");
  console.log(`[post-codegen] Applied generated API client fixes in ${path.relative(process.cwd(), apiClientFile)}`);
} else {
  console.log("[post-codegen] No generated API client fixes applied.");
}

const apiClientSchemasOriginal = await readFile(apiClientSchemasFile, "utf8");
let apiClientSchemasNext = tightenUsersUpdateType(apiClientSchemasOriginal);
apiClientSchemasNext = tightenWorkdayExceptionPayloadType(apiClientSchemasNext);
apiClientSchemasNext = tightenLeadConvertToJobBodyType(apiClientSchemasNext);
apiClientSchemasNext = tightenReportParamsTypes(apiClientSchemasNext);

if (apiClientSchemasNext !== apiClientSchemasOriginal) {
  await writeFile(apiClientSchemasFile, apiClientSchemasNext, "utf8");
  console.log(`[post-codegen] Applied generated API schema type fixes in ${path.relative(process.cwd(), apiClientSchemasFile)}`);
} else {
  console.log("[post-codegen] No generated API schema type fixes applied.");
}

const original = await readFile(apiZodFile, "utf8");
let next = original;

for (const [from, to] of RENAMES) {
  // Only the standalone identifier (not part of QueryParams etc.).
  next = next.replace(new RegExp(`\\b${from}\\b(?!Q)`, "g"), to);
}

if (next.includes("zod.coerce\n    .boolean()") || next.includes("zod.coerce.boolean()")) {
  next = next.replace(
    'import * as zod from "zod";',
    `import * as zod from "zod";

const booleanQueryParam = zod.preprocess((value) => {
  if (typeof value !== "string") return value;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  return value;
}, zod.boolean());`,
  );
  next = next.replace(/zod\.coerce\n\s+\.boolean\(\)/g, "booleanQueryParam");
  next = next.replace(/zod\.coerce\.boolean\(\)/g, "booleanQueryParam");
}

// Orval currently emits integer schemas as plain z.number(), so runtime client
// validation accepts fractional values even when OpenAPI says `type: integer`.
// Keep whole-cent money fields aligned with the server handler and generated
// TypeScript types by restoring z.int() for generated cents schemas.
next = next.replace(
  /(zod\n)(\s+)(\.number\(\))\n(\s+\.min\([^\n]*CentsMin\)\n\s+\.max\([^\n]*CentsMax\))/g,
  "$1$2$3\n$2.int()\n$4",
);

for (const exportName of STRICT_BODY_EXPORTS) {
  const objectDescribePattern = new RegExp(
    `(export const ${exportName} = zod\\n  \\.object\\(\\{[\\s\\S]*?\\n  \\}\\))\\n  (\\.describe\\()`,
  );
  next = next.replace(objectDescribePattern, "$1\n  .strict()\n  $2");
}

next = next.replace(
  /(export const UsersPatchUsersIdBody = zod\n  \.object\(\{[\s\S]*?\n  \}\)(?:\n  \.strict\(\))?)\n  (\.describe\()/,
  `$1
  .refine(
    (value) =>
      value.fullName !== undefined ||
      value.role !== undefined ||
      value.isActive !== undefined,
    { message: "At least one field is required." },
  )
  $2`,
);

next = next.replace(
  /(export const SchedulePostJobsJobIdWorkdayExceptionsBody = zod\n  \.object\(\{[\s\S]*?\n  \}\))\n  (\.describe\()/,
  `$1
  .superRefine((value, ctx) => {
    if (!value.appliesToAllJobs && value.jobIds.length === 0) {
      ctx.addIssue({
        code: zod.ZodIssueCode.custom,
        message: "Select at least one job.",
        path: ["jobIds"],
      });
    }

    if (value.endDate < value.startDate) {
      ctx.addIssue({
        code: zod.ZodIssueCode.custom,
        message: "End date must be on or after the start date.",
        path: ["endDate"],
      });
    }
  })
  $2`,
);

next = next.replace(
  /(export const LeadsPostLeadsIdConvertToJobBody = zod\n  \.object\(\{[\s\S]*?\n  \}\))\n  (\.describe\()/,
  `$1
  .refine((value) => !(value.clientId && value.newClient), {
    message: "Provide either clientId or newClient, not both.",
    path: ["clientId"],
  })
  $2`,
);

for (const opName of [
  "ReportsGetReportsArAging",
  "ReportsGetReportsRevenue",
  "ReportsGetReportsPipeline",
  "ReportsGetReportsDaysToPayment",
  "ReportsGetReportsJobsByStage",
]) {
  next = next.replace(
    new RegExp(`(export const ${opName}QueryParams = zod\\.object\\(\\{[\\s\\S]*?\\n\\}\\))\\;`),
    `$1
  .superRefine((value, ctx) => {
    if (value.range === "custom" && (!value.from || !value.to)) {
      ctx.addIssue({
        code: zod.ZodIssueCode.custom,
        message: "from and to are required when range=custom.",
        path: ["from"],
      });
    }
  });`,
  );
}

if (next !== original) {
  await writeFile(apiZodFile, next, "utf8");
  console.log(`[post-codegen] Applied generated zod fixes in ${path.relative(process.cwd(), apiZodFile)}`);
} else {
  console.log("[post-codegen] No generated zod fixes applied.");
}

const apiZodUserTypeFile = path.join(apiZodTypesDir, "usersUpdateUserSchema.ts");
const apiZodUserTypeOriginal = await readFile(apiZodUserTypeFile, "utf8");
const apiZodUserTypeNext = tightenUsersUpdateType(apiZodUserTypeOriginal);
if (apiZodUserTypeNext !== apiZodUserTypeOriginal) {
  await writeFile(apiZodUserTypeFile, apiZodUserTypeNext, "utf8");
  console.log(`[post-codegen] Applied generated api-zod user type fixes in ${path.relative(process.cwd(), apiZodUserTypeFile)}`);
}

const apiZodWorkdayTypeFile = path.join(apiZodTypesDir, "workdayExceptionPayload.ts");
const apiZodWorkdayTypeOriginal = await readFile(apiZodWorkdayTypeFile, "utf8");
const apiZodWorkdayTypeNext = tightenWorkdayExceptionPayloadType(apiZodWorkdayTypeOriginal);
if (apiZodWorkdayTypeNext !== apiZodWorkdayTypeOriginal) {
  await writeFile(apiZodWorkdayTypeFile, apiZodWorkdayTypeNext, "utf8");
  console.log(`[post-codegen] Applied generated api-zod workday type fixes in ${path.relative(process.cwd(), apiZodWorkdayTypeFile)}`);
}

const apiZodLeadConvertTypeFile = path.join(apiZodTypesDir, "leadConvertToJobBody.ts");
const apiZodLeadConvertTypeOriginal = await readFile(apiZodLeadConvertTypeFile, "utf8");
const apiZodLeadConvertTypeNext = tightenLeadConvertToJobBodyType(apiZodLeadConvertTypeOriginal);
if (apiZodLeadConvertTypeNext !== apiZodLeadConvertTypeOriginal) {
  await writeFile(apiZodLeadConvertTypeFile, apiZodLeadConvertTypeNext, "utf8");
  console.log(`[post-codegen] Applied generated api-zod lead conversion type fixes in ${path.relative(process.cwd(), apiZodLeadConvertTypeFile)}`);
}

for (const typeName of REPORT_PARAM_TYPE_NAMES) {
  const fileName = `${typeName.charAt(0).toLowerCase()}${typeName.slice(1)}.ts`;
  const filePath = path.join(apiZodTypesDir, fileName);
  const originalSource = await readFile(filePath, "utf8");
  const nextSource = tightenReportParamsType(originalSource, typeName);
  if (nextSource !== originalSource) {
    await writeFile(filePath, nextSource, "utf8");
    console.log(`[post-codegen] Applied generated api-zod report params type fixes in ${path.relative(process.cwd(), filePath)}`);
  }
}
