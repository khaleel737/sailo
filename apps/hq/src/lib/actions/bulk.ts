"use server";

/**
 * Doing the same thing to many shops at once.
 *
 * ─── WHY THIS IS NOT A LOOP OVER THE SINGLE ACTIONS ──────────────────────────
 * It could have been, and the first version was. Calling `setSuspended` forty
 * times gets forty audit rows, forty cache busts and forty seller-panel pings,
 * which is correct — and it also gets forty round trips, forty chances to fail
 * halfway, and no record anywhere that these forty were *one decision*. That
 * last part is the one that matters: a fraud ring taken down in a single sweep
 * and forty unrelated suspensions look identical in the audit log, and only one
 * of them is a thing somebody should be able to review as a unit.
 *
 * So the writes are batched into one statement per operation, the audit is one
 * row per shop *plus* a batch line naming the whole sweep, and the cache work
 * happens once per shop in `after()` rather than blocking the response.
 *
 * ─── THE THREE RULES ─────────────────────────────────────────────────────────
 *  1. **A cap.** `BULK_LIMIT` shops per call, refused rather than truncated. A
 *     bulk action that silently does 100 of the 340 you selected is worse than
 *     one that refuses, because you will believe it finished.
 *  2. **A reason, always.** Not only on the destructive half. The whole risk of
 *     a bulk tool is that it makes a large act feel like a small one, and being
 *     made to type why is the cheapest available brake.
 *  3. **Capabilities per operation**, the same ones the single-shop actions
 *     use. A bulk endpoint that checked one broad capability would be a way to
 *     do by forty what you are not allowed to do by one.
 *
 * ─── ONE EXPORT, AND IT HAS TO STAY THAT WAY ─────────────────────────────────
 * A `"use server"` module may export async functions and nothing else: every
 * export becomes a callable HTTP endpoint, so a `const` cannot be one. Adding
 * a single non-function export here does not just fail to export that value —
 * it invalidates the module, and `bulkAccountAction` disappears with it. `tsc`
 * is perfectly happy; the build is where it surfaces, as "the module has no
 * exports at all". The cap, the operation table and the type guard therefore
 * live in `@/lib/bulk-operations`, which both this and the client import.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@sailo/db";
import { shops, staffActions } from "@sailo/db/schema";
import { publishShopEvent } from "@sailo/events";
import { isPlanId, PLANS } from "@sailo/core/plans";
import type { ActionState } from "@sailo/core/action-state";
import { requireStaff } from "@/lib/session";
import {
  BULK_LIMIT,
  BULK_OPERATIONS,
  isBulkOperation,
  type BulkOperation,
} from "@/lib/bulk-operations";
import { revalidateShopOnWeb } from "@/lib/web-cache";

const input = z.object({
  operation: z.string().refine(isBulkOperation, { message: "Pick what to do." }),
  reason: z
    .string()
    .trim()
    .min(1, "Say why. A sweep with no reason on it cannot be reviewed later.")
    .max(500),
  /** Only read by `comp`. Ignored, not rejected, by everything else. */
  plan: z.string().optional(),
});

/**
 * Apply one operation to a set of shops.
 *
 * The shop ids come from repeated `shopId` fields — which is what a form full
 * of checkboxes posts — rather than from a JSON blob, so the browser's own
 * encoding is the wire format and there is nothing to parse.
 */
export async function bulkAccountAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = input.safeParse({
    operation: formData.get("operation"),
    reason: formData.get("reason"),
    plan: formData.get("plan") || undefined,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form." };
  }
  const { operation, reason, plan } = parsed.data;
  const { capability, verb } = BULK_OPERATIONS[operation];

  // Before anything is read, and with the operation's own capability rather
  // than a blanket one.
  const staff = await requireStaff(capability);

  const ids = formData
    .getAll("shopId")
    .map((value) => String(value).trim())
    .filter(Boolean);

  if (ids.length === 0) return { ok: false, error: "Nothing selected." };
  if (ids.length > BULK_LIMIT) {
    return {
      ok: false,
      error: `That is ${ids.length} shops. ${BULK_LIMIT} at a time — narrow the filter and go again.`,
    };
  }

  if (operation === "comp" && (!plan || !isPlanId(plan) || plan === "free")) {
    return { ok: false, error: "Pick a paid plan to comp." };
  }

  const db = getDb();

  /*
   * Read first, and only the shops that the operation would actually change.
   *
   * Two reasons. The report has to be honest — "suspended 40" when 12 were
   * already suspended is a number somebody will quote in a meeting — and the
   * audit rows have to name real shops, so a stale id from a page that was
   * loaded ten minutes ago drops out here rather than producing a row about
   * nothing.
   */
  const targets = await db
    .select({
      id: shops.id,
      userId: shops.userId,
      name: shops.name,
      handle: shops.handle,
      staffNote: shops.staffNote,
    })
    .from(shops)
    .where(applicable(operation, ids));

  if (targets.length === 0) {
    return {
      ok: false,
      error: "Nothing to do — every shop you picked is already in that state.",
    };
  }

  const targetIds = targets.map((t) => t.id);
  const now = new Date();

  switch (operation) {
    case "suspend":
      await db
        .update(shops)
        .set({ suspendedAt: now, suspendedReason: reason, updatedAt: now })
        .where(inArray(shops.id, targetIds));
      break;
    case "unsuspend":
      await db
        .update(shops)
        .set({ suspendedAt: null, suspendedReason: null, updatedAt: now })
        .where(inArray(shops.id, targetIds));
      break;
    case "pause_marketing":
      await db
        .update(shops)
        .set({ marketingPausedAt: now, marketingPausedReason: reason, updatedAt: now })
        .where(inArray(shops.id, targetIds));
      break;
    case "resume_marketing":
      await db
        .update(shops)
        .set({ marketingPausedAt: null, marketingPausedReason: null, updatedAt: now })
        .where(inArray(shops.id, targetIds));
      break;
    case "comp":
      await db
        .update(shops)
        .set({ compPlan: plan as string, compNote: reason, updatedAt: now })
        .where(inArray(shops.id, targetIds));
      break;
    case "clear_comp":
      await db
        .update(shops)
        .set({ compPlan: null, compNote: null, updatedAt: now })
        .where(inArray(shops.id, targetIds));
      break;
    case "note":
      /*
       * One statement per shop, and the only operation that needs it: a note is
       * appended to whatever is already there, so the new value depends on the
       * old one and there is no single SET that expresses forty different
       * concatenations. Bounded by `BULK_LIMIT`, which is why that cap is what
       * it is.
       */
      await Promise.all(
        targets.map((target) =>
          db
            .update(shops)
            .set({
              staffNote: [target.staffNote, `[${staff.email}] ${reason}`]
                .filter(Boolean)
                .join("\n")
                .slice(0, 2000),
              updatedAt: now,
            })
            .where(eq(shops.id, target.id)),
        ),
      );
      break;
  }

  /*
   * One audit row per shop, so an account's own timeline shows what happened to
   * it — somebody reading one shop must not have to know a sweep existed to
   * find out why it went offline.
   */
  await db.insert(staffActions).values(
    targets.map((target) => ({
      actorEmail: staff.email,
      action: `bulk.${operation}`,
      shopId: target.id,
      summary: `${verb} ${target.name} as part of a ${targets.length}-shop sweep — ${reason}`.slice(
        0,
        500,
      ),
    })),
  );

  /*
   * And one more with no `shopId`, which is the batch itself.
   *
   * The per-shop rows above answer "why is this shop suspended". This one
   * answers "what did we do on Tuesday", and it is the row that makes a sweep
   * reviewable as a decision rather than as forty coincidences. `shopId` is
   * null because the act was not about any one of them — the same reason a
   * partner decision writes a null there.
   */
  await db.insert(staffActions).values({
    actorEmail: staff.email,
    action: `bulk.${operation}.batch`,
    shopId: null,
    summary:
      `${verb} ${targets.length} shops in one sweep — ${reason}. ` +
      `Handles: ${targets.map((t) => t.handle).join(", ")}`.slice(0, 400),
  });

  revalidatePath("/accounts");
  revalidatePath("/risk");
  revalidatePath("/");

  /*
   * The cache work, after the response.
   *
   * The single-shop `record()` awaits `revalidateShopOnWeb` deliberately — a
   * suspension that has not reached the storefront cache has not taken effect,
   * and the person clicking it should not be told it is done before it is. That
   * argument does not survive being multiplied by a hundred: a hundred
   * sequential HTTP calls to the other deployment would time the request out
   * and leave the operator staring at an error after every write had succeeded.
   *
   * So the writes are committed, the response is honest about them, and the
   * cache catches up in `after()`. The window is seconds and the direction of
   * the error is the safe one — a suspended storefront serving one more cached
   * page — against a bulk tool that appears to fail every time it works.
   */
  after(async () => {
    /*
     * Sequential, and the linter is right that it could be `Promise.all` —
     * this is the case where it should not be. Each iteration is an HTTP
     * request to the *other deployment*, and firing a hundred of them at once
     * at apps/web's revalidation route is a self-inflicted burst on a path
     * whose whole job is to make the storefront correct. Nobody is waiting on
     * this; it runs after the response, and taking a second longer costs
     * nothing while taking apps/web down costs everything.
     */
    for (const target of targets) {
      // eslint-disable-next-line no-await-in-loop -- deliberate; see above.
      await revalidateShopOnWeb({ id: target.id, handle: target.handle }).catch(
        (error: unknown) => {
          console.warn(`[sailo] bulk cache bust failed for ${target.handle}`, error);
        },
      );
      publishShopEvent(target.id, "account");
    }
  });

  const skipped = ids.length - targets.length;
  return {
    ok: true,
    message:
      `${verb.toLowerCase()} ${targets.length} shop${targets.length === 1 ? "" : "s"}` +
      (operation === "comp" && plan && isPlanId(plan) ? ` on ${PLANS[plan].name}` : "") +
      (skipped > 0 ? `. ${skipped} were already in that state and were left alone.` : "."),
  };
}

/**
 * The selected shops that this operation would actually change.
 *
 * Every clause here is what makes the count in the report true. Suspending
 * shops that are already suspended is not an error, it is a no-op — and
 * reporting it as forty successes is how a tool starts being trusted for
 * something it did not do.
 */
function applicable(operation: BulkOperation, ids: string[]) {
  const selected = inArray(shops.id, ids);

  switch (operation) {
    case "suspend":
      return and(selected, isNull(shops.suspendedAt));
    case "unsuspend":
      return and(selected, isNotNull(shops.suspendedAt));
    case "pause_marketing":
      return and(selected, isNull(shops.marketingPausedAt));
    case "resume_marketing":
      return and(selected, isNotNull(shops.marketingPausedAt));
    case "clear_comp":
      return and(selected, isNotNull(shops.compPlan));
    /*
     * `comp` and `note` have no "already in that state": re-comping onto a
     * different plan and appending a second note are both meaningful, so every
     * selected shop is a target.
     */
    default:
      return selected;
  }
}
