"use client";

import { createAuthClient } from "better-auth/react";
import { magicLinkClient } from "better-auth/client/plugins";

/**
 * The browser half of this app's auth, and it mirrors the server exactly: one
 * plugin, because there is one way in.
 *
 * apps/web's client carries `twoFactorClient()` as well. That is not an omission
 * here — a staff account holds no password, so it can never enrol in TOTP, and
 * a client method for a flow the server refuses is a type that lies.
 *
 * `baseURL` is this app's own origin, not apps/web's. The two deployments each
 * mint against their own `/api/auth`, and pointing this at sailo.store would
 * send the magic-link request to the seller app — which no longer has a
 * `magicLink` plugin to answer it.
 */
export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_HQ_URL ?? "http://localhost:3001",
  plugins: [magicLinkClient()],
});

export const { signIn, signOut, useSession } = authClient;
