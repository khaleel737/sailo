/**
 * What a logged message may contain before it is stored.
 *
 * `order_messages.bodyText` keeps every message Sailo sent a buyer, as sent, so
 * that Stripe's `customer_communication` slot can be filled with something real
 * rather than asking the seller to dig through their sent folder. That is the
 * right design and it has one consequence worth handling deliberately: **those
 * emails contain bearer tokens.**
 *
 * A confirmation carries a download link. An invoice mail carries an invoice
 * token. A membership mail carries a portal token. Each is a URL that grants
 * access to the thing it names, with no login — that is what makes them work for
 * a buyer who has no account, and it is what makes storing them a liability that
 * the message log would otherwise create by itself.
 *
 * The row is read by staff answering a dispute and printed into an evidence pack
 * that goes to a card network. Neither of those needs the live token, and both
 * are places a token should never end up.
 *
 * So the token is replaced and the *shape* is kept. `…/download/[redacted]` still
 * proves a download link was sent, on that date, to that address — which is the
 * entire evidentiary value — while granting nobody anything.
 */

/**
 * Path segments whose next component is a bearer token.
 *
 * Matched by path rather than by looking for token-shaped strings, because
 * "token-shaped" catches order references, invoice numbers and product slugs
 * too, and redacting those would destroy the evidence this row exists to be.
 */
const TOKEN_PATHS = [
  "download",
  "invoice",
  "unsubscribe",
  "u",
  "portal",
  "verify",
  "reset-password",
  "magic-link",
] as const;

/** What replaces a token. Deliberately visible: a redaction should announce itself. */
export const REDACTED = "[redacted]";

/**
 * Remove bearer tokens from a message body, keeping everything else.
 *
 * Handles the two shapes a token arrives in:
 *
 *   - **A path segment** after one of `TOKEN_PATHS` — `/download/abc123` becomes
 *     `/download/[redacted]`. The trailing `/fileId` of a download URL is left
 *     alone; it is an ordinary identifier and grants nothing on its own.
 *   - **A query parameter** named `token`, `t`, `key` or `secret`.
 *
 * Everything else is preserved byte for byte. This is evidence, and a redactor
 * that quietly rewrote prose would make the row unusable for the thing it is
 * for.
 */
export function redactTokens(body: string): string {
  let out = body;

  for (const segment of TOKEN_PATHS) {
    /*
     * The token is the segment immediately after the marker. Bounded by `[^/\s?#"'<>]+`
     * rather than `.*` so a URL at the end of a sentence does not swallow the
     * sentence, and so the `/fileId` after a download token survives.
     */
    out = out.replace(
      new RegExp(`(/${segment}/)[^/\\s?#"'<>)\\]]+`, "gi"),
      `$1${REDACTED}`,
    );
  }

  out = out.replace(
    /([?&](?:token|t|key|secret)=)[^&\s"'<>)\]]+/gi,
    `$1${REDACTED}`,
  );

  return out;
}

/** The kinds of message a row can record. */
export const MESSAGE_KINDS = [
  "confirmation",
  "invoice",
  "shipped",
  "refund",
  "download",
  "reminder",
  "renewal",
  "seller_note",
] as const;
export type MessageKind = (typeof MESSAGE_KINDS)[number];

export function isMessageKind(value: unknown): value is MessageKind {
  return typeof value === "string" && (MESSAGE_KINDS as readonly string[]).includes(value);
}

/**
 * `sent` at the moment of sending; the rest arrive from the Resend webhook.
 *
 * `bounced` is worth calling out as evidence in its own right rather than as a
 * failure: it explains why a buyer says they never heard anything, and
 * disclosing it is honest in a way that quietly omitting it is not.
 */
export const MESSAGE_STATUSES = ["sent", "delivered", "bounced", "complained"] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

/**
 * How long a message log is kept.
 *
 * 400 days: a dispute can arrive 120 days after the sale, a compliance case
 * later than that, and a chargeback's own arbitration runs months beyond it. The
 * number is here rather than in the sweep so that the sweep has to name it.
 */
export const EVIDENCE_RETENTION_DAYS = 400;

/**
 * Who says a parcel arrived, weakest first.
 *
 * The order is the point. An evidence pack prints the source beside the date
 * because these are not equally persuasive, and presenting a seller's own tick
 * as though a carrier had confirmed it would be a false claim to a bank made on
 * that seller's behalf — the failure mode specs 45 and 46 are written against.
 */
export const DELIVERY_SOURCES = ["seller", "buyer_confirmed", "carrier"] as const;
export type DeliverySource = (typeof DELIVERY_SOURCES)[number];

export function isDeliverySource(value: unknown): value is DeliverySource {
  return typeof value === "string" && (DELIVERY_SOURCES as readonly string[]).includes(value);
}

/** Kinds of thing recorded against an account, for spec 46. */
export const ACCOUNT_EVENT_KINDS = [
  "signin",
  "signup",
  "plan_change",
  "subscription_paid",
  "terms_accepted",
] as const;
export type AccountEventKind = (typeof ACCOUNT_EVENT_KINDS)[number];
