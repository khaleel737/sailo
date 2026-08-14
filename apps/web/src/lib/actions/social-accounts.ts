"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { APIError } from "better-auth/api";
import { auth } from "@/lib/auth";
import { getSession } from "@/lib/session";
import { SOCIAL_PROVIDERS, type SocialProviderId } from "@/lib/queries/linked-accounts";

/**
 * Settings → Security: connecting and disconnecting Apple and Google.
 *
 * Both actions ride better-auth's own endpoints. `/link-social` is the same
 * OAuth round trip a sign-in makes, differing only in that it starts from a
 * session and ends by attaching the provider to *that* account rather than
 * resolving one by email. `/unlink-account` is where the "you cannot remove
 * your last way in" rule actually lives — see `disconnectProvider`.
 */

export type LinkedAccountsActionState = { ok: boolean; error?: string };

/** Where both actions send the seller back to. */
const SECURITY = "/admin/settings/security";

/**
 * Better-auth's refusals are written for developers. The three a seller can
 * actually cause get plain language; everything else falls through verbatim
 * rather than becoming "something went wrong", so a rate-limit message
 * survives — a throttled attempt must read as *unknown*, never as *wrong*.
 */
function refusalMessage(error: unknown): string {
  if (error instanceof APIError) {
    const code = (error.body as { code?: string } | undefined)?.code;
    if (code === "FAILED_TO_UNLINK_LAST_ACCOUNT") {
      return "This is the only way into your account. Add a password or another provider first.";
    }
    if (code === "SESSION_NOT_FRESH") {
      return "For your security, sign out and back in before changing this.";
    }
    if (code === "ACCOUNT_NOT_FOUND") return "That account is already disconnected.";
    if (error.body?.message) return error.body.message;
  }
  return "Something went wrong. Try again.";
}

/** Narrows a form field to a provider this deployment actually offers. */
function providerFrom(formData: FormData): SocialProviderId | null {
  const value = String(formData.get("provider") ?? "");
  return (SOCIAL_PROVIDERS as readonly string[]).includes(value)
    ? (value as SocialProviderId)
    : null;
}

/**
 * Starts the provider's consent screen and sends the seller to it.
 *
 * The account this ends up attached to is the one in the session, decided on
 * the server — the form carries only which provider was clicked. Better-auth
 * additionally refuses a callback whose address differs from the signed-in
 * account's, because `allowDifferentEmails` is off, so a seller cannot attach
 * somebody else's Google account to their own shop by any route this offers.
 */
export async function connectProvider(
  _prev: LinkedAccountsActionState,
  formData: FormData,
): Promise<LinkedAccountsActionState> {
  const session = await getSession();
  if (!session?.user) return { ok: false, error: "Sign in again to continue." };

  const provider = providerFrom(formData);
  if (!provider) return { ok: false, error: "Choose a provider to connect." };

  let url: string | undefined;
  try {
    const result = await auth.api.linkSocialAccount({
      body: { provider, callbackURL: SECURITY },
      headers: await headers(),
    });
    url = result.url;
  } catch (error) {
    return { ok: false, error: refusalMessage(error) };
  }

  // No URL means better-auth had nothing to send us to, which is a
  // configuration fault rather than something the seller did wrong.
  if (!url) return { ok: false, error: "That provider isn't available right now." };

  /*
   * Outside the try on purpose. `redirect` signals by throwing, so catching
   * around it would swallow the navigation and report it as a failure.
   */
  redirect(url);
}

/**
 * Removes one provider from the account.
 *
 * **The last credential is refused, and by the server rather than by the
 * card.** A seller whose only way in is Google, disconnecting it, would have
 * an account nobody could ever sign into again — not by password reset, since
 * there is no password, and not by support, since the address proves nothing
 * on its own. better-auth counts the rows and refuses at zero
 * (`allowUnlinkingAll` is false in `lib/auth.ts`); the card hides the button
 * as well, so the refusal is a backstop and not the seller's first warning.
 */
export async function disconnectProvider(
  _prev: LinkedAccountsActionState,
  formData: FormData,
): Promise<LinkedAccountsActionState> {
  const session = await getSession();
  if (!session?.user) return { ok: false, error: "Sign in again to continue." };

  const provider = providerFrom(formData);
  if (!provider) return { ok: false, error: "Choose a provider to disconnect." };

  try {
    await auth.api.unlinkAccount({
      body: { providerId: provider },
      headers: await headers(),
    });
  } catch (error) {
    return { ok: false, error: refusalMessage(error) };
  }

  revalidatePath(SECURITY);
  return { ok: true };
}
