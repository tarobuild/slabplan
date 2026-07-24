import assert from "node:assert/strict";
import { test } from "node:test";
import {
  formatDateRange,
  formatCurrencyCents,
  formatFileSize,
  formatJobLocation,
  formatPercent,
  formatShortDate,
  formatTime,
  formatWorkDays,
  titleCaseStatus,
} from "../src/lib/format";

test("formatShortDate preserves empty and malformed values safely", () => {
  assert.equal(formatShortDate(null), "Not scheduled");
  assert.equal(formatShortDate("2026-05-21"), "05/21/2026");
  assert.equal(formatShortDate("2026-05-21T18:30:00.000Z"), "05/21/2026");
  assert.equal(formatShortDate("soon"), "soon");
});

test("formatJobLocation composes only available address fields", () => {
  assert.equal(formatJobLocation({ city: "Irvine", state: "CA" }), "Irvine, CA");
  assert.equal(
    formatJobLocation({ streetAddress: "1 Main St", city: "Irvine", state: "CA" }),
    "1 Main St • Irvine, CA",
  );
  assert.equal(formatJobLocation({}), "No address");
});

test("titleCaseStatus turns API status identifiers into readable labels", () => {
  assert.equal(titleCaseStatus("in_progress"), "In Progress");
  assert.equal(titleCaseStatus("pending-review"), "Pending Review");
});

test("field formatting helpers keep schedule and files readable", () => {
  assert.equal(formatDateRange("2026-05-21", "2026-05-23"), "05/21/2026 - 05/23/2026");
  assert.equal(formatDateRange("2026-05-21", "2026-05-21"), "05/21/2026");
  assert.equal(formatTime("13:05:00"), "1:05 PM");
  assert.equal(formatPercent(101), "100%");
  assert.equal(formatPercent(-5), "0%");
  assert.equal(formatFileSize(1536), "1.5 KB");
  assert.equal(formatCurrencyCents(123456), "$1,234.56");
  assert.equal(formatWorkDays(["mon", "wed", "fri"]), "Mon, Wed, Fri");
});
