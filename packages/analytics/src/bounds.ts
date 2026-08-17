/**
 * What a dashboard window means.
 *
 * Pure, and its own file for that reason: every figure on every dashboard is scoped by
 * these three functions, and they were the only part of a 607-line module that could be
 * tested without a replica. The rolling-versus-explicit distinction is easy to get subtly
 * wrong in a way that shifts every number on a seller's screen by a day.
 */

import { and, gte, lt } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { utcDayWindow } from "@sailo/core/time";
import type { DateWindow } from "./analytics-window";

/**
 * Every read here accepts either shape: a day-count is the rolling window the
 * presets have always been, an explicit `{since, until}` is a custom range.
 * Passing a number produces byte-for-byte the query it produced before custom
 * ranges existed — no caller changed meaning.
 */
export type Window = number | DateWindow;

/** The window as bounds. `until` stays null on the rolling path. */
export function windowBounds(window: Window): { since: Date; until: Date | null } {
  if (typeof window === "number") {
    return {
      since: new Date(Date.now() - window * 24 * 60 * 60 * 1000),
      until: null,
    };
  }
  return window;
}

/** `col >= since`, plus `col < until` when the window has a far edge. */
export function inWindow(
  column: AnyPgColumn,
  since: Date,
  until: Date | null,
) {
  return until
    ? and(gte(column, since), lt(column, until))
    : gte(column, since);
}

/**
 * Zero-fill keys and bounds for either window shape. A custom window's bounds
 * are already UTC midnights (the resolver made them), so stepping in whole
 * days lands exactly on its edge.
 */
export function seriesWindow(window: Window): {
  since: Date;
  until: Date | null;
  keys: string[];
} {
  if (typeof window === "number") {
    return { ...utcDayWindow(window), until: null };
  }
  const keys: string[] = [];
  for (
    let t = window.since.getTime();
    t < window.until.getTime();
    t += 24 * 60 * 60 * 1000
  ) {
    keys.push(new Date(t).toISOString().slice(0, 10));
  }
  return { since: window.since, until: window.until, keys };
}
