import Papa from "papaparse";

/** Turning an uploaded file into rows, with a ceiling. */

export const MAX_ROWS = 5000;

export function parse(csv: string) {
  const result = Papa.parse<Record<string, string>>(csv.replace(/^﻿/, ""), {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim(),
  });
  return result.data.slice(0, MAX_ROWS);
}

/* -------------------------------------------------------------------------- */
/*  Products                                                                   */
/* -------------------------------------------------------------------------- */

export type Row = { line: number; raw: Record<string, string> };
