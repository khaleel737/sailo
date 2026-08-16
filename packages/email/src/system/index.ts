/**
 * Mail about an account rather than about a shop: address confirmation,
 * password reset, two-factor changes, deletion, support, staff sign-in.
 *
 * Never batched, never throttled, never subject to a preference — a password
 * reset that does not arrive locks somebody out of their business.
 */
export * from "./messages";
