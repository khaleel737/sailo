/**
 * The schema, as one import.
 *
 * Split by domain across this folder — `@/db/schema` still resolves here, so
 * every existing import keeps working and Drizzle still receives one object
 * containing every table and relation.
 */

export * from "./json-types";

export * from "./auth";
export * from "./shop";
export * from "./catalog";
export * from "./commerce";
export * from "./orders";
export * from "./memberships";
export * from "./audience";
export * from "./lifecycle";
export * from "./analytics";
export * from "./growth";
export * from "./integrations";
export * from "./support";
export * from "./push";

export * from "./relations";
export * from "./types";
export type { OpeningWindow, WeeklyHours } from "./hours";
