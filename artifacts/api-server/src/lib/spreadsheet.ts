import { HttpError } from "./http";

export interface ParsedSheet {
  name: string;
  csv: string;
}

export interface ParsedSpreadsheet {
  sheets: ParsedSheet[];
}

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  let str: string;
  if (value instanceof Date) {
    str = value.toISOString();
  } else if (typeof value === "object") {
    const v = value as {
      richText?: Array<{ text?: string }>;
      text?: string;
      result?: unknown;
      hyperlink?: string;
      formula?: string;
      error?: string;
    };
    if (v.error) {
      str = String(v.error);
    } else if (Array.isArray(v.richText)) {
      str = v.richText.map((rt) => rt?.text ?? "").join("");
    } else if (v.result !== undefined && v.result !== null) {
      str = csvEscape(v.result);
      return str;
    } else if (typeof v.text === "string") {
      str = v.text;
    } else if (typeof v.hyperlink === "string") {
      str = v.hyperlink;
    } else {
      str = "";
    }
  } else {
    str = String(value);
  }
  if (str.includes(",") || str.includes("\n") || str.includes('"')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Parse an .xlsx workbook from a Buffer into per-sheet CSV strings.
 * Replaces the abandoned `xlsx` (SheetJS Community) package — which had
 * two HIGH CVEs (CVE-2023-30533 prototype pollution and CVE-2024-22363
 * ReDoS) and shipped fixes only via a private registry — with the
 * actively-maintained `exceljs` library.
 *
 * Throws an HttpError(400) on unparseable input so callers don't have to
 * translate library-specific exceptions into client errors.
 */
export async function parseXlsxToSheets(
  bytes: Buffer,
): Promise<ParsedSpreadsheet> {
  // Dynamic import keeps `exceljs` out of the static import graph that
  // esbuild bundles into dist/index.mjs (see build-smoke.test.ts).
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  try {
    // exceljs ships its own outdated @types/node, which makes the
    // Buffer type collide with this project's newer @types/node. The
    // runtime accepts either Buffer or Uint8Array.
    await workbook.xlsx.load(bytes as unknown as ArrayBuffer);
  } catch (err) {
    throw new HttpError(
      400,
      "Could not read this spreadsheet. The file may be corrupt or " +
        "password-protected — try re-saving it as .xlsx and uploading again.",
      {
        code: "SPREADSHEET_PARSE_FAILED",
        detail: err instanceof Error ? err.message : String(err),
      },
    );
  }
  const sheets: ParsedSheet[] = [];
  workbook.eachSheet((sheet) => {
    const rows: string[] = [];
    let maxCol = 0;
    sheet.eachRow({ includeEmpty: false }, (row) => {
      if (row.cellCount > maxCol) maxCol = row.cellCount;
    });
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const cells: string[] = [];
      for (let c = 1; c <= maxCol; c++) {
        const cell = row.getCell(c);
        cells.push(csvEscape(cell.value));
      }
      rows.push(cells.join(","));
    });
    sheets.push({ name: sheet.name, csv: rows.join("\n") });
  });
  return { sheets };
}
