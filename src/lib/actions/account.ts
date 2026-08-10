"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { APIError } from "better-auth/api";
import { auth } from "@/lib/auth";
import { requireShop } from "@/lib/session";
import { rateLimit } from "@/lib/redis";
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
  const { user, shop } = await requireShop();

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
      return {
        ok: false,
        error:
          `You have ${result.count} paid order${result.count === 1 ? "" : "s"} still to fulfil. ` +
          `Deliver or refund them first.`,
      };
    }
    return { ok: false, error: "Something went wrong. Try again." };
  }

  revalidatePath("/", "layout");
  // Their session died with the account; there is nothing left to render.
  redirect("/?deleted=1");
}
