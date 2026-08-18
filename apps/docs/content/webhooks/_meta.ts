import type { MetaRecord } from "nextra";

/**
 * Set one up, learn what can arrive, learn what it looks like, prove it is
 * genuine, then understand what happens when your endpoint is down.
 *
 * Signatures before delivery on purpose: an endpoint that retries correctly but
 * verifies nothing is worse than one that does neither, because it looks
 * finished.
 */
export default {
  index: "Overview",
  events: "Events",
  payloads: "Payloads",
  signatures: "Verifying signatures",
  delivery: "Delivery and retries",
} satisfies MetaRecord;
