"use client";

import { createAuthClient } from "better-auth/react";
import { magicLinkClient, twoFactorClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  plugins: [
    // Mirrors the server's magicLink plugin — the staff sign-in on /hq/login.
    magicLinkClient(),
    // Mirrors the server's twoFactor plugin. The redirect to /verify-2fa is
    // handled where sign-in happens (`auth-form.tsx`), which can use the
    // router instead of a hard navigation — so no callback here.
    twoFactorClient(),
  ],
});

export const { signIn, signUp, signOut, useSession } = authClient;
