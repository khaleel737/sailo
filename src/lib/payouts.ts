/**
 * How an affiliate gets paid.
 *
 * Three ways, deliberately: a bank account, a PayPal address, or a free-text
 * "other" for everything the first two aren't. The seller pays out by hand —
 * there is no money movement here — so the shape only has to be good enough
 * for a human to act on, and small enough that the portal form stays one
 * select and one input.
 */

export const PAYOUT_METHOD_TYPES = ["bank", "paypal", "other"] as const;

export type PayoutMethodType = (typeof PAYOUT_METHOD_TYPES)[number];

export function isPayoutMethodType(value: string): value is PayoutMethodType {
  return (PAYOUT_METHOD_TYPES as readonly string[]).includes(value);
}

/** English names, for the seller's admin and for email — both English surfaces. */
export const PAYOUT_METHOD_LABELS: Record<PayoutMethodType, string> = {
  bank: "Bank transfer",
  paypal: "PayPal",
  other: "Other",
};

/**
 * What the portal shows of the details on file.
 *
 * The portal is opened by a bare link, and links leak — chats get forwarded,
 * screens get watched. Whoever is looking should be able to confirm *which*
 * account is on file without being handed the account itself, which is the
 * same trade every card-on-file UI makes. The seller's admin shows the full
 * value; they are the one who has to send the money.
 */
export function maskPayoutDetails(details: string): string {
  const trimmed = details.trim();

  // An email keeps its first letter and its domain: enough to say "yes,
  // that's my PayPal", nothing a stranger can log in with.
  const at = trimmed.indexOf("@");
  if (at > 0) return `${trimmed.slice(0, 1)}…${trimmed.slice(at)}`;

  // Anything else keeps its last four characters, the way a card does. Too
  // short to have a masked part means too short to show any of it.
  const compact = trimmed.replace(/\s+/g, "");
  if (compact.length <= 4) return "…";
  return `…${compact.slice(-4)}`;
}
