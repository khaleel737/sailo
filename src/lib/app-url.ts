/**
 * Where this deployment lives.
 *
 * Deliberately not behind `server-only`, and deliberately not in `stripe.ts`.
 * It reads a `NEXT_PUBLIC_` variable — there is nothing here to leak — and the
 * pre-deploy check scripts build Stripe redirect URLs from it while running as
 * plain Node, where importing `server-only` throws.
 */
export function appUrl() {
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}
