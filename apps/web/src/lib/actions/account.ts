"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { APIError } from "better-auth/api";
import { auth } from "@/lib/auth";
import { requireShop } from "@/lib/session";
import { rateLimit } from "@sailo/rate-limit";
import { deleteAccountFor } from "@/lib/account-deletion";

/**
 * Self-serve account deletion — the authentication half. The work itself is
 * in `lib/account-deletion.ts`, which knows nothing about sessions and can
 * therefore be driven by a test.
 */

export type DeleteAccountState = { ok: boolean; error?: string };

export async function deleteAccount(
  _prev: DeleteAccountState,
  formData: FormData,
): Promise<DeleteAccountState> {
  const { user, shop } = await requireShop("settings:write");

  /*
   * Three a day. Deleting is once-per-account by definition, so anything
   * above a couple of attempts is either a script or someone who has already
   * been told no — and every attempt costs a password check.
   */
  const gate = await rateLimit(`delete-account:${user.id}`, 3, 86_400);
  if (!gate.allowed) {
    return { ok: false, error: "Too many attempts. Try again later." };
  }

  const password = String(formData.get("password") ?? "");
  const confirmation = String(formData.get("handle") ?? "").trim();

  if (confirmation.toLowerCase() !== shop.handle.toLowerCase()) {
    return { ok: false, error: `Type ${shop.handle} exactly to confirm.` };
  }
  if (!password) return { ok: false, error: "Enter your password." };

  /*
   * The password, checked by signing in with it rather than by comparing a
   * hash here. Better-auth owns the hashing, and a second implementation of
   * "is this the right password" is a second place to get it wrong.
   */
  try {
    await auth.api.signInEmail({
      body: { email: user.email, password },
      headers: await headers(),
    });
  } catch (error) {
    if (error instanceof APIError) {
      return { ok: false, error: "That password isn't right." };
    }
    throw error;
  }

  const result = await deleteAccountFor(user.id);

  if (!result.ok) {
    if (result.reason === "obligations") {
      /*
       * Three refusals, in the order the seller can act on them. Undelivered
       * orders are theirs to fix today; a dispute resolves on the card
       * network's clock; a payout hold needs us. Saying "you can't delete yet"
       * for all three would send everyone to support to find out which.
       */
      if (result.count > 0) {
        return {
          ok: false,
          error:
            `You have ${result.count} paid order${result.count === 1 ? "" : "s"} still to fulfil. ` +
            `Deliver or refund them first.`,
        };
      }
      if (result.openDisputes > 0) {
        return {
          ok: false,
          error:
            `A buyer's bank is still deciding on ${result.openDisputes === 1 ? "a payment" : `${result.openDisputes} payments`} to your shop. ` +
            `Deleting now would erase the records we need to answer it. This clears itself once the bank decides.`,
        };
      }
      return {
        ok: false,
        error:
          "Payouts from your shop are on hold while we look at recent disputes. " +
          "That has to be lifted before the account can be deleted — write to us and we'll tell you where it stands.",
      };
    }
    return { ok: false, error: "Something went wrong. Try again." };
  }

  revalidatePath("/", "layout");
  // Their session died with the account; there is nothing left to render.
  redirect("/?deleted=1");
}
