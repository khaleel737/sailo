/*
 * Mounted on the API origin *and* on apps/web, exactly as `/api/v1` is — a
 * seller ships software today and cannot re-release it because we moved a
 * hostname. The handler is `@sailo/api/license`; there is no second
 * implementation here to drift.
 *
 * No `Authorization` header, and that is the design rather than an omission:
 * the licence key is the credential, because a seller's API key inside every
 * customer's binary is a seller's API key in every customer's hands. Safe to
 * mount twice for the reason the v1 routes are — nothing on this path reads
 * the better-auth session cookie, so a second origin cannot loosen one.
 */

import { handleLicenseValidate } from "@sailo/api/license";

/** `POST /api/license/validate` — see `@sailo/api/license` for the refusal rules. */
export async function POST(request: Request) {
  return handleLicenseValidate(request);
}
