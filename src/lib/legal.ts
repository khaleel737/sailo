/**
 * The facts the legal pages are built from.
 *
 * One place, because the same address, the same trading name and the same
 * effective date appear across the privacy policy, the terms and the refund
 * policy, and three copies of a legal detail is three chances to have an
 * out-of-date one.
 *
 * ── BEFORE THIS GOES LIVE ────────────────────────────────────────────────
 * These documents were written against what the code actually does, not from a
 * template, and they are careful. They are not legal advice, and nobody here is
 * a lawyer. Have counsel read them before you take real money, particularly
 * the CCPA/CPRA and GDPR sections, which turn on facts about your business
 * rather than about the software.
 * ─────────────────────────────────────────────────────────────────────────
 */

export const LEGAL = {
  /** The service. */
  product: "Sailo",
  domain: "sailo.store",

  /**
   * The operator. A sole proprietor, not a company: there is no separate legal
   * entity, so the documents name the individual and say so plainly rather
   * than implying a corporate veil that does not exist.
   */
  operator: "Khaleel Musleh",
  operatorForm: "a sole proprietor",

  /** Postal address, as it must appear on a legal notice. */
  street: "920 Masson Ave",
  city: "San Bruno",
  state: "California",
  postalCode: "94066",
  country: "United States",

  /** Where privacy requests, refund requests and legal notices land. */
  contactEmail: "hello@sailo.store",
  privacyEmail: "privacy@sailo.store",
  supportEmail: "support@sailo.store",
  /** Refund requests go to one address so none of them gets lost in a thread. */
  refundEmail: "refund@sailo.store",

  /**
   * Governing law. California, because that is where the operator is and where
   * the business is carried on.
   */
  governingLaw: "the State of California, United States",
  venue: "San Mateo County, California",

  /** Shown at the top of each document, and the date the current text took effect. */
  effective: "5 September 2026",

  /**
   * The authoritative language.
   *
   * The rest of the product ships in thirty-five languages. These three do not,
   * and that is deliberate: a mistranslated clause in a binding document is a
   * worse outcome than an English one a reader can machine-translate. Stated
   * on the page so nobody is surprised.
   */
  language: "English",
} as const;

/** Single-line postal address, for the contact blocks. */
export const postalAddress = [
  LEGAL.operator,
  LEGAL.street,
  `${LEGAL.city}, ${LEGAL.state} ${LEGAL.postalCode}`,
  LEGAL.country,
];

/**
 * Everyone who touches personal data on Sailo's behalf.
 *
 * This list is the whole of it. Sailo sells nothing, rents nothing and hands
 * nothing to advertisers or data brokers; every party below is a vendor that
 * runs part of the service and may use what it processes only to deliver that
 * service back to us. Adding a vendor means adding a row here and updating the
 * effective date, not quietly widening a sentence somewhere.
 */
export const SUBPROCESSORS = [
  {
    name: "Vercel",
    purpose: "Application hosting, content delivery, and file storage for uploaded images",
    data: "Requests to the site, and any product photo or file a seller uploads",
    region: "United States, with a global edge network",
  },
  {
    name: "Neon",
    purpose: "The managed Postgres database the service runs on",
    data: "Everything stored: accounts, shops, catalogues, orders and analytics",
    region: "United States",
  },
  {
    name: "Stripe",
    purpose:
      "Subscription billing for paid Sailo plans, and card payments a seller chooses to accept through their own connected Stripe account",
    data: "Billing contact details, and payment details the payer enters on Stripe’s own pages",
    region: "United States, with global processing",
  },
  {
    name: "Resend",
    purpose: "Sending transactional email: order notifications, password resets, invoices",
    data: "Recipient email address and the contents of that message",
    region: "United States",
  },
  {
    name: "Upstash Redis",
    purpose:
      "Short-lived rate-limit counters that keep the service from being flooded. Optional, and the service runs without it",
    data: "A hashed request key and a count. No account or order data",
    region: "United States",
  },
] as const;

/**
 * Every cookie the product sets, and why. There are three, all first-party,
 * and none of them is an advertising or cross-site tracking cookie.
 */
export const COOKIES = [
  {
    name: "sailo_session",
    purpose: "Keeps a seller signed in to their own admin",
    life: "Until sign-out, or 30 days",
    kind: "Strictly necessary",
  },
  {
    name: "_ga, _ga_*",
    purpose:
      "Google Analytics, on Sailo's own pages only — never on a seller's shop. Set only after you agree to it, and not at all if you decline",
    life: "Up to 2 years",
    kind: "Analytics, with consent",
  },
  {
    name: "sailo_locale",
    purpose: "Remembers the language a visitor chose, so the choice survives a reload",
    life: "1 year",
    kind: "Preference",
  },
] as const;
