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
