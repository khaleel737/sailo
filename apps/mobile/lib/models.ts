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

/**
 * A row as the list returns it — the order header, without its lines.
 *
 * `["items"]` because the list is keyset-paged: it answers
 * `{ items, nextCursor }` rather than a bare array, so that a page boundary
 * cannot move when an order arrives mid-scroll. The row type is unchanged.
 */
export type Order = RouterOutputs["orders"]["list"]["items"][number];
/** One order with `items`, the authoritative list of what was bought. */
export type OrderDetail = RouterOutputs["orders"]["get"];
export type OrderItem = OrderDetail["items"][number];

export type Product = RouterOutputs["products"]["list"]["items"][number];

/**
 * One payment rail, as the settings screen receives it.
 *
 * Note what is *not* here: the rail's own `fields` are part of this type, and
 * their `label`, `placeholder` and `hint` are English in every locale. They
 * come from `PAYMENT_METHOD_DEFS`, which the web admin also renders raw — so
 * this is parity rather than a gap introduced on the phone. The strings around
 * them are translated.
 */
export type Rail = RouterOutputs["payments"]["rails"]["rails"][number];
export type RailField = Rail["fields"][number];
/** One product with its `images` and `variants`, ordered by position. */
export type ProductDetail = RouterOutputs["products"]["get"];
export type ProductImage = ProductDetail["images"][number];
export type ProductVariant = ProductDetail["variants"][number];

export type { RouterInputs, RouterOutputs };
