/**
 * The line a buyer sees on their card statement, and the rules it has to obey.
 *
 * `unrecognized` — Visa 10.4, Mastercard 4837 — is a cardholder looking at a
 * statement, not recognising a line, and charging it back. `docs/chargebacks.md`
 * calls it *"usually a statement-descriptor problem"*, and until spec 44 Sailo
 * could not answer it at all: nothing set a descriptor, nothing recorded one,
 * and whatever the seller's connected account happened to default to is what
 * appeared. For a link-in-bio shop that is frequently a registered company name
 * the buyer has never heard of.
 *
 * ## Why validation is not optional here
 *
 * **Stripe silently ignores an invalid descriptor.** Not an error, not a warning
 * — the charge succeeds and the account default is used instead. That is the
 * worst available failure mode, because the seller's settings screen says
 * "SPECKLED CERAMICS" and their buyers' statements say something else, and the
 * only way anyone finds out is a chargeback that the descriptor was supposed to
 * prevent. So the rules are enforced here, on the way in, where they can be
 * explained.
 *
 * The rules themselves come from the card networks via Stripe's documented
 * constraints, and they are unusually fiddly:
 *
 *   - 5 to 22 characters, after trimming.
 *   - At least one letter. `12345` is rejected — a statement line of digits is
 *     indistinguishable from a reference number.
 *   - None of `< > \ " '`. These are the characters that break the downstream
 *     systems the descriptor is printed by.
 *   - Not only whitespace and punctuation.
 *
 * A **suffix** is the per-transaction half, appended by Stripe to the account's
 * own prefix. It has the same character rules and a tighter length, because the
 * prefix and suffix together must still fit in 22.
 */

/** The card networks' hard limit on the whole line. */
export const DESCRIPTOR_MAX = 22;

/**
 * The shortest useful descriptor.
 *
 * Not a network rule — Stripe accepts shorter — but a two-character statement
 * line identifies nobody, and the entire purpose of this field is to be
 * recognised. Refusing it is more useful than accepting it.
 */
export const DESCRIPTOR_MIN = 5;

/** `< > \ " '` — the five the networks reject. */
const FORBIDDEN = /[<>\\"']/;

export type DescriptorProblem =
  | "empty"
  | "too_short"
  | "too_long"
  | "no_letter"
  | "forbidden_character";

export type DescriptorVerdict =
  | { ok: true; value: string }
  | { ok: false; problem: DescriptorProblem };

/**
 * Validate and normalise a descriptor.
 *
 * Normalisation is part of the check, not a convenience: runs of whitespace
 * collapse to one space, because a statement line renders them unpredictably and
 * two sellers who typed visually identical descriptors should get identical
 * results.
 */
export function checkDescriptor(input: string | null | undefined): DescriptorVerdict {
  const value = (input ?? "").replace(/\s+/g, " ").trim();

  if (!value) return { ok: false, problem: "empty" };
  if (FORBIDDEN.test(value)) return { ok: false, problem: "forbidden_character" };
  if (!/\p{L}/u.test(value)) return { ok: false, problem: "no_letter" };
  if (value.length < DESCRIPTOR_MIN) return { ok: false, problem: "too_short" };
  if (value.length > DESCRIPTOR_MAX) return { ok: false, problem: "too_long" };

  return { ok: true, value };
}

/**
 * A descriptor derived from a shop's name, for a shop that has not set one.
 *
 * The default matters more than it looks. An unconfigured shop shows its
 * connected account's own default — usually a legal entity — and a buyer who
 * bought from "Speckled Ceramics" seeing "ANDERSON HOLDINGS LTD" is the exact
 * `unrecognized` case. A shop name is not always a *valid* descriptor, so this
 * repairs what it can and refuses what it cannot rather than producing something
 * Stripe will silently drop.
 *
 * Returns null when nothing usable can be made, and a null descriptor is
 * honest: it means the account default applies, which is what the seller has
 * today.
 */
export function descriptorFromName(name: string | null | undefined): string | null {
  const cleaned = (name ?? "")
    .replace(FORBIDDEN, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, DESCRIPTOR_MAX)
    .trim();

  const verdict = checkDescriptor(cleaned);
  return verdict.ok ? verdict.value : null;
}

/**
 * What the buyer will actually see, given a shop's two fields.
 *
 * Stripe joins the account's prefix and the transaction's suffix with a space
 * and truncates to 22. Computed here rather than guessed at render time so the
 * checkout preview — *"this will appear on your statement as …"* — shows the
 * same string that is sent.
 *
 * That preview is worth more than everything else in this file: it prevents the
 * dispute rather than answering it.
 */
export function descriptorPreview(
  descriptor: string | null | undefined,
  suffix: string | null | undefined,
): string | null {
  const base = checkDescriptor(descriptor);
  if (!base.ok) return null;

  const tail = (suffix ?? "").replace(/\s+/g, " ").trim();
  if (!tail || FORBIDDEN.test(tail)) return base.value;

  return `${base.value} ${tail}`.slice(0, DESCRIPTOR_MAX).trim();
}
