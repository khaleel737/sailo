/**
 * Support tickets, the parts every surface agrees on: the admin form that
 * files one, the email that carries it, and the HQ list that answers it.
 */

export const SUPPORT_TOPICS = [
  "technical",
  "billing",
  "payments",
  "orders",
  "account",
  "other",
] as const;

export type SupportTopic = (typeof SUPPORT_TOPICS)[number];

export function isSupportTopic(value: string): value is SupportTopic {
  return (SUPPORT_TOPICS as readonly string[]).includes(value);
}

/**
 * English labels for the email and HQ, which are staff-facing and unlocalized.
 * The seller-facing form reads the admin dictionary instead.
 */
export const SUPPORT_TOPIC_LABELS: Record<SupportTopic, string> = {
  technical: "Technical problem",
  billing: "Plan & billing",
  payments: "Payments & payouts",
  orders: "Orders & delivery",
  account: "Account & login",
  other: "Something else",
};

/** Screenshots per ticket. Three is enough to show a bug; ten is a gallery. */
export const MAX_TICKET_IMAGES = 3;

export const MAX_SUBJECT_LENGTH = 140;
export const MAX_MESSAGE_LENGTH = 5000;
