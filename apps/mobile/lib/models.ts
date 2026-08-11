/**
 * The shared domain types, imported straight from the web backend's schema.
 *
 * These are `import type` only — they erase at compile, so nothing of the
 * server-only db runtime reaches the React Native bundle. The point of the
 * whole extraction: a Shop or an Order is defined once, in @sailo/db, and the
 * mobile screens render against the exact same shape the API returns.
 */
export type { Shop, Product, Order, Client } from "@sailo/db/schema";
