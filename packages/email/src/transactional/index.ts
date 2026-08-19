/**
 * A buyer's record of what they bought — every message addressed to whoever
 * paid.
 *
 * Transactional in the sense that matters legally as well as structurally:
 * none of these is subject to a marketing preference, and none may carry an
 * unsubscribe link. A buyer cannot opt out of being told their order shipped.
 */
export * from "./messages";
export * from "../orders";
export * from "./privacy";
