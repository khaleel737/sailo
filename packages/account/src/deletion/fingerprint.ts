import { createHmac } from "node:crypto";

/**
 * Recognising a returning seller without keeping their address.
 *
 * A closure record has to answer one question at signup — "is the person
 * registering today the person who closed that shop?" — and it has to answer it
 * about accounts whose owner asked to be forgotten. Those two are only
 * compatible if the thing we keep is not the address.
 *
 * ─── WHY AN HMAC AND NOT A HASH ──────────────────────────────────────────────
 * `sha256(email)` is not anonymisation of an email address, it is an encoding
 * of one. The input space is small and public: anybody holding a copy of this
 * table and a list of a hundred million addresses recovers most of the column
 * in an afternoon, which is the whole reason the ICO and EDPB treat an unsalted
 * hash of an identifier as still being personal data. Keying it with a secret
 * we hold is what makes the digest useless to anyone who has the table and not
 * the key — and a leaked database and a leaked application secret are different
 * incidents with different blast radii.
 *
 * ─── WHY IT DERIVES FROM BETTER_AUTH_SECRET RATHER THAN ADDING A VARIABLE ────
 * A dedicated `SAILO_CLOSURE_SALT` would be one more required secret to
 * provision, and the failure mode of forgetting it is silent: fingerprints
 * computed under a missing or default salt do not error, they simply stop
 * matching the ones computed before, and the feature quietly reports that
 * nobody has ever closed a shop. `BETTER_AUTH_SECRET` is already required in
 * every environment — nothing runs without it — so deriving from it removes the
 * failure rather than handling it.
 *
 * Reusing a secret for two purposes is only safe with domain separation, so the
 * label below is part of the message and is versioned. Changing it changes every
 * digest, which is deliberate: it is the rotation lever, and rotating means
 * accepting that closures recorded before the change stop matching signups after
 * it. There is no way to have both, since the whole point is that the input
 * cannot be recovered and re-hashed.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * The domain separator. Part of the message, and versioned so that changing the
 * scheme is a visible edit rather than a silent one.
 */
const LABEL = "sailo:closure-fingerprint:v1";

/**
 * A keyed digest of an email address.
 *
 * Pure, and takes the secret rather than reading it, so it can be asserted
 * without an environment: the properties worth pinning are that it is stable,
 * that it ignores the case and whitespace a form leaves behind, that a
 * different key produces a different digest, and that Gmail's dot and plus
 * aliasing are *not* normalised — `a.da@gmail.com` reaches the same inbox as
 * `ada@gmail.com` and is a different account to register with, exactly as
 * `isStaffEmail` argues on the other side of the same question.
 *
 * Returns null for an address there is nothing to fingerprint — an already
 * tombstoned `@sailo.invalid` owner, or an empty string — because a digest of a
 * placeholder would match every other closure that had the same placeholder.
 */
export function closureFingerprint(
  email: string | null | undefined,
  secret: string,
): string | null {
  if (!email) return null;
  const address = email.trim().toLowerCase();
  if (!address || address.endsWith("@sailo.invalid")) return null;

  return createHmac("sha256", secret).update(`${LABEL}:${address}`).digest("hex");
}
