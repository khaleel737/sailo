/**
 * What a failed environment check should say.
 *
 * `@t3-oss/env-core`'s default handler logs the issues and then throws a bare
 * `Invalid environment variables`. In a terminal those two land together and
 * it reads fine; in a platform log they do not. The thrown message is what
 * surfaces as the deploy's failure reason, and "Invalid environment variables"
 * on a boot crash tells you only that you now have to go and read the log to
 * find out which one — at exactly the moment the site is down.
 *
 * So the keys go in the message. Deliberately the keys and not the values: a
 * schema failure on `STRIPE_SECRET_KEY` must never print what was actually
 * set, because the most likely reason it failed validation is that a real
 * secret was pasted into the wrong variable.
 */

/** The subset of a Standard Schema issue this needs, without the dependency. */
type Issue = { readonly path?: ReadonlyArray<PropertyKey | { key: PropertyKey }> };

const nameOf = (issue: Issue): string =>
  issue.path
    ?.map((segment) =>
      typeof segment === "object" && segment !== null && "key" in segment
        ? String(segment.key)
        : String(segment),
    )
    .join(".") ?? "(unknown)";

/**
 * Throws naming every variable that failed, sorted and deduplicated.
 *
 * Pass as `onValidationError` so a boot failure is self-describing.
 */
export function onInvalidEnv(issues: readonly Issue[]): never {
  const names = [...new Set(issues.map(nameOf))].sort();
  throw new Error(
    `Invalid environment: ${names.join(", ")}. ` +
      "Set or correct these before starting. " +
      "See the log above for what each one expected.",
  );
}
