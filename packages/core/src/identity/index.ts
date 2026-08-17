/**
 * Turning what somebody typed into something addressable.
 *
 * A slug, a shop handle, a uuid, a phone number, a badge — each one is a string
 * that becomes part of a URL, a database key or a stored contact, and each has
 * exactly one right normalisation. Two of them disagreeing is how a product
 * gets two addresses or a buyer gets stored twice.
 *
 * `handle` carries the reserved list: a handle that shadows a live route
 * validates, saves, and then the storefront silently never renders.
 */
export * from "./slug";
export * from "./handle";
export * from "./badge";
export * from "./uuid";
export * from "./phone";
