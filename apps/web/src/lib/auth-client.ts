"use client";

import { createAuthClient } from "better-auth/react";
import { twoFactorClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  plugins: [
    /*
     * `magicLinkClient()` is gone, with the plugin it mirrored. Magic links
     * only ever served the staff panel, which is apps/hq now and mints its own
     * — so this server has no `/sign-in/magic-link` to call, and a client
     * method for an endpoint that 404s is a type that lies.
     */
    // Mirrors the server's twoFactor plugin. The redirect to /verify-2fa is
    // handled where sign-in happens (`auth-form.tsx`), which can use the
    // router instead of a hard navigation — so no callback here.
    twoFactorClient(),
  ],
});

export const { signIn, signUp, signOut, useSession } = authClient;
