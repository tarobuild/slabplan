import assert from "node:assert/strict";
import { test } from "node:test";
import ExcelJS from "exceljs";
import { parseXlsxToSheets } from "../src/lib/spreadsheet";
import { HttpError } from "../src/lib/http";

// Regression coverage for #286: replacing the abandoned `xlsx`
// (SheetJS Community) package — which had two HIGH CVEs — with
// `exceljs`. The shape we feed to the AI prompt must remain
// `{ name, csv }[]` per sheet, and corrupt input must surface a clean
// HttpError rather than a prototype-pollution / ReDoS crash.

async function buildXlsxBuffer(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const s1 = wb.addWorksheet("Estimate");
  s1.addRow(["Item", "Qty", "Unit Price"]);
  s1.addRow(["Granite slab, 3cm", 4, 250.5]);
  s1.addRow(["Sealant, gallon", 2, 38]);
  // Force a cell with a comma + quote to exercise CSV escaping.
  s1.addRow(['Edge profile "ogee", custom', 1, 120]);
  const s2 = wb.addWorksheet("Notes");
  s2.addRow(["Lead time", "2 weeks"]);
  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}

test("parseXlsxToSheets: round-trips real xlsx contents into per-sheet CSV", async () => {
  const buf = await buildXlsxBuffer();
  const parsed = await parseXlsxToSheets(buf);
  assert.equal(parsed.sheets.length, 2);

  const estimate = parsed.sheets.find((s) => s.name === "Estimate");
  assert.ok(estimate, "Estimate sheet present");
  const lines = estimate!.csv.split("\n");
  assert.equal(lines[0], "Item,Qty,Unit Price");
  assert.equal(lines[1], "Granite slab, 3cm,4,250.5".replace(
    "Granite slab, 3cm",
    '"Granite slab, 3cm"',
  ));
  assert.equal(lines[2], "Sealant, gallon,2,38".replace(
    "Sealant, gallon",
    '"Sealant, gallon"',
  ));
  // Embedded quote round-trips with CSV-standard "" escaping.
  assert.equal(
    lines[3],
    '"Edge profile ""ogee"", custom",1,120',
  );

  const notes = parsed.sheets.find((s) => s.name === "Notes");
  assert.ok(notes);
  assert.equal(notes!.csv, "Lead time,2 weeks");
});

test("parseXlsxToSheets: corrupt input throws an HttpError(400), not a runtime crash", async () => {
  const garbage = Buffer.from("this is definitely not a valid xlsx zip");
  await assert.rejects(
    () => parseXlsxToSheets(garbage),
    (err: unknown) => {
      assert.ok(err instanceof HttpError, "expected HttpError");
      assert.equal((err as HttpError).statusCode, 400);
      return true;
    },
  );
});
