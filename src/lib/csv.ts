/**
 * CSV helpers following the conventions Shopify's importers use, so files move
 * between the two without hand-editing: UTF-8, LF line endings, no currency
 * symbols or thousand separators, and a `Handle` as the product's stable key.
 */

import { moneyToCents } from "@/lib/utils";

/** Formats minor units as a bare decimal — `29.99`, never `$29.99`. */
export function money(cents: number | null | undefined) {
  if (cents === null || cents === undefined) return "";
  return (cents / 100).toFixed(2);
}

export function bool(value: boolean) {
  return value ? "TRUE" : "FALSE";
}

export function date(value: Date | null | undefined) {
  return value ? value.toISOString() : "";
}

/**
 * Escapes one field. A leading =, +, - or @ is prefixed with a quote so
 * spreadsheets treat it as text rather than a formula — otherwise an exported
 * product title could execute in the seller's Excel.
 */
export function escapeField(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text = String(value);

  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;

  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function toCsv(headers: string[], rows: unknown[][]) {
  const lines = [headers.map(escapeField).join(",")];
  for (const row of rows) lines.push(row.map(escapeField).join(","));
  // Trailing newline keeps POSIX tools happy.
  return lines.join("\n") + "\n";
}

/** Byte-order mark so Excel opens UTF-8 exports without mangling accents. */
export const UTF8_BOM = "﻿";

export function csvResponse(filename: string, body: string) {
  return new Response(UTF8_BOM + body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

/* -------------------------------------------------------------------------- */
/*  Parsing helpers used by the importers                                      */
/* -------------------------------------------------------------------------- */

/** Reads a column case-insensitively and tolerant of surrounding spaces. */
export function field(
  row: Record<string, string>,
  ...names: string[]
): string {
  for (const name of names) {
    const key = Object.keys(row).find(
      (k) => k.trim().toLowerCase() === name.trim().toLowerCase(),
    );
    if (key && row[key] !== undefined && row[key] !== null) {
      const value = String(row[key]).trim();
      // Undo the anti-formula quote if the file came from one of our exports.
      if (/^'[=+\-@]/.test(value)) return value.slice(1);
      if (value) return value;
    }
  }
  return "";
}

export function parseBool(value: string, fallback = false) {
  const v = value.trim().toLowerCase();
  if (!v) return fallback;
  return ["true", "yes", "y", "1", "active"].includes(v);
}

/**
 * Accepts `29.99`, `$29.99`, `1,299.99`, `1.299,99`, `12,5` and blank.
 * Returns minor units, or null for blank — which is not zero: an empty price
 * column means "inherit from the product", and zero means free.
 *
 * Defers to `moneyToCents` so an imported CSV and a typed form field read the
 * same string the same way. This had its own convention, which stripped every
 * comma and turned a European seller's "12,5" into 1250 cents.
 *
 * `moneyToCents` and not `parseMoneyToCents`: the latter answers 0 for text
 * that is not a number, which a form field needs and an importer must not
 * have. A cell holding a stray "-" as a same-as-product placeholder would
 * otherwise price that variant at zero and sell it free.
 */
export function parseMoneyField(value: string, currency = "USD"): number | null {
  return moneyToCents(value, currency);
}
