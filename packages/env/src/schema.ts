import { z } from "zod";

/**
 * A URL of a particular kind, because `z.string().url()` is not one.
 *
 * WHATWG URL parsing is far more permissive than it looks: `localhost:6379`
 * parses cleanly, with `localhost:` as its protocol and `6379` as its path. So
 * a `REDIS_URL` that is missing its scheme — the single most common way to get
 * that variable wrong — passes `.url()` and then fails to connect, which
 * `withRedis` swallows as a fallback. The symptom is that nothing is ever
 * cached, and nothing anywhere says why.
 *
 * Checking the protocol is what makes the validation mean something. It is
 * also what catches the other paste error: a Postgres URL in `REDIS_URL`.
 */
export function urlWithProtocol(protocols: readonly string[], label: string) {
  const expected = protocols.map((p) => `${p}//`).join(" or ");
  return z.string().refine(
    (value) => {
      try {
        return protocols.includes(new URL(value).protocol);
      } catch {
        return false;
      }
    },
    { message: `must be a ${label} URL beginning ${expected}` },
  );
}
