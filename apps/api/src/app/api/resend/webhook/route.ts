/*
 * Mounted on the API origin as well as on apps/web. The delivery URL lives in the
 * Resend dashboard — configuration only a human can change — so both answer until
 * you switch it, and `docs/api-cutover.md` records the order. Delivering to both
 * at once is harmless: the handler is idempotent per event id.
 *
 * Safe to mount twice for the reason `partner/events` is: it authenticates from a
 * Svix signature over the raw body, never from a session cookie.
 */
import { handleResendWebhook } from "@sailo/api/webhooks";

/**
 * `POST /api/resend/webhook` — bounces, complaints and delivery failures.
 *
 * The handler, including the Svix signature check, is `@sailo/api/webhooks`. This
 * endpoint answers on two origins during the cutover, and a signature verifier
 * that exists twice is one that can be fixed in one place and left broken in the
 * other — on a URL that is still live in the Resend dashboard.
 */
export function POST(request: Request) {
  return handleResendWebhook(request);
}
