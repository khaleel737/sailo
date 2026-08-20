import { centsToAmount } from "../money/parse";

/** Per-field ceiling, so one long product description cannot eat the budget. */
export const EVIDENCE_FIELD_MAX = 4_000;

/**
 * An amount as issuer-facing text — "100000 JPY", "12.500 KWD", "19.99 USD".
 *
 * Through `centsToAmount`, never a flat `/100`: this file's callers write the
 * narrative that goes to the card networks, and the flat divisor stated a
 * ¥100,000 dispute as "1000.00 JPY" — the same ×100/×10 corruption the money
 * layer exists to prevent, recopied into the one document arguing our case.
 */
export function evidenceMoney(cents: number, currency: string): string {
  return `${centsToAmount(cents, currency)} ${currency.toUpperCase()}`;
}

/** A calendar date, or null when it is not on record. */
export function evidenceDate(value: Date | null | undefined): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

/** Clamp to the per-field ceiling, with the truncation visible. */
export function clampEvidence(text: string): string {
  return text.length <= EVIDENCE_FIELD_MAX
    ? text
    : `${text.slice(0, EVIDENCE_FIELD_MAX - 1)}…`;
}
