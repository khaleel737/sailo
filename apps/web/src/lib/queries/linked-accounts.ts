import "server-only";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";

/** The ways into an account, shown in Settings → Security. */

export const SOCIAL_PROVIDERS = ["apple", "google"] as const;
export type SocialProviderId = (typeof SOCIAL_PROVIDERS)[number];

export type LinkedAccounts = {
  /** Whether a password is one of the ways in. */
  password: boolean;
  /** Which providers this seller has connected. */
  linked: Record<SocialProviderId, boolean>;
  /**
   * Which providers this deployment can actually offer.
   *
   * Read from the auth config rather than from the environment, so the card
   * and the server agree by construction: a provider whose credentials are
   * missing — or whose Apple identifiers were crossed — is not registered, and
   * offering its button would produce a dead end rather than a sign-in.
   */
  configured: SocialProviderId[];
  /**
   * How many credentials the account has in total, password included.
   *
   * One means the next disconnect would be the last, and better-auth refuses
   * it (`allowUnlinkingAll` is false). The card uses this to say so *before*
   * the seller clicks, rather than surfacing a refusal after the fact.
   */
  total: number;
};

/**
 * Every credential on the signed-in account.
 *
 * Goes through `auth.api` rather than reading the `account` table directly, so
 * the row shape and the "credential" provider id stay better-auth's business.
 * Access tokens live on those rows and are deliberately not in the returned
 * type: the page has no use for them, and a page that never holds them cannot
 * leak them into markup or a client component's props.
 */
export async function listLinkedAccounts(): Promise<LinkedAccounts> {
  const accounts = await auth.api.listUserAccounts({ headers: await headers() });
  const present = new Set(accounts.map((row) => row.providerId));
  const registered = auth.options.socialProviders ?? {};

  return {
    // better-auth stores a password as an ordinary account row under this
    // provider id, which is also why it counts toward `total` below.
    password: present.has("credential"),
    linked: { apple: present.has("apple"), google: present.has("google") },
    configured: SOCIAL_PROVIDERS.filter((id) => id in registered),
    total: accounts.length,
  };
}
