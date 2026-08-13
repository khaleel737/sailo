import type { RouterInputs, RouterOutputs } from "@sailo/api/client";

/**
 * The shared domain types, as the screens actually receive them.
 *
 * These used to be re-exported straight from `@sailo/db/schema`, which was
 * right about the columns and wrong about the wire: there is no transformer on
 * this client, so a `timestamp` that is a `Date` in Postgres and a `Date` on
 * the server arrives here as an ISO string. Screens compiled happily against
 * `createdAt: Date` and would have thrown on a device.
 *
 * Inferred from the router instead, so the type a screen renders against is
 * the type the server sends — including the `with:` relations, which the raw
 * table types do not carry at all. Still type-only, so nothing of the
 * server-only db runtime reaches the React Native bundle; that was always the
 * point of the extraction and it is unchanged.
 *
 * Dates are strings here. `new Date(order.createdAt)` when you need one.
 */

/** `undefined` when the seller's session resolved to no shop row. */
export type Shop = RouterOutputs["shop"]["get"];

/** A row as the list returns it — the order header, without its lines. */
export type Order = RouterOutputs["orders"]["list"][number];
/** One order with `items`, the authoritative list of what was bought. */
export type OrderDetail = RouterOutputs["orders"]["get"];
export type OrderItem = OrderDetail["items"][number];

export type Product = RouterOutputs["products"]["list"][number];
/** One product with its `images` and `variants`, ordered by position. */
export type ProductDetail = RouterOutputs["products"]["get"];
export type ProductImage = ProductDetail["images"][number];
export type ProductVariant = ProductDetail["variants"][number];

export type { RouterInputs, RouterOutputs };
