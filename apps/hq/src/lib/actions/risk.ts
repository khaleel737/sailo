"use server";

/**
 * Raising a flag on a shop, and taking one off.
 *
 * The two writes the risk desk makes. Everything else on that screen is
 * arithmetic over rows other parts of the platform wrote — see
 * `lib/platform/risk.ts` for why the measurements are derived and only the
 * decisions are stored.
 *
 * Both are `account:suspend`, which is the capability the `risk` role exists to
 * hold. Deliberately not `notes:write`: a flag is not a note. It puts a shop on
 * a queue that ends in a suspension, and it is visible to everybody who opens
 * the desk — so raising one on a competitor's shop, or clearing one on a
 * friend's, is an act with consequences, and it belongs behind the same
 * capability as the consequence.
 */

import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@sailo/db";
import { riskFlags, shops } from "@sailo/db/schema";
import { isRiskKind, isRiskSeverity } from "@sailo/core/risk";
import { recordStaffAction } from "@sailo/security/audit";
import { requireStaff } from "@/lib/session";
import type { ActionState } from "@sailo/core/action-state";

const raiseInput = z.object({
  shopId: z.uuid("Unknown shop."),
  kind: z.string().refine(isRiskKind, { message: "Unknown kind of finding." }),
  severity: z
    .string()
    .refine(isRiskSeverity, { message: "Pick watch, review or act." }),
  summary: z.string().trim().min(1, "Say what you saw.").max(500),
  evidence: z.string().trim().max(120).optional(),
});

/**
 * Put a shop on the desk, or raise the level on one already there.
 *
 * An upsert on `(shop, kind)` among *open* flags, so pressing the button twice
 * does not produce two identical rows for the next person to work through
 * twice. Re-raising an open flag rewrites its summary and severity and leaves
 * `raisedAt` alone — the flag is the same finding, and moving its timestamp
 * would push it back to the top of a queue somebody is working down.
 */
export async function raiseRiskFlag(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const staff = await requireStaff("account:suspend");

  const parsed = raiseInput.safeParse({
    shopId: formData.get("shopId"),
    kind: formData.get("kind") || "manual",
    severity: formData.get("severity"),
    summary: formData.get("summary"),
    evidence: formData.get("evidence") || undefined,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form." };
  }
  const input = parsed.data;

  const db = getDb();
  const shop = await db.query.shops.findFirst({
    where: eq(shops.id, input.shopId),
    columns: { id: true, name: true, userId: true },
  });
  if (!shop) return { ok: false, error: "That shop no longer exists." };

  const open = await db.query.riskFlags.findFirst({
    where: and(
      eq(riskFlags.shopId, shop.id),
      eq(riskFlags.kind, input.kind),
      isNull(riskFlags.clearedAt),
    ),
    columns: { id: true },
  });

  if (open) {
    await db
      .update(riskFlags)
      .set({
        severity: input.severity,
        summary: input.summary,
        evidence: input.evidence ?? null,
      })
      .where(eq(riskFlags.id, open.id));
  } else {
    await db.insert(riskFlags).values({
      shopId: shop.id,
      kind: input.kind,
      severity: input.severity,
      summary: input.summary,
      evidence: input.evidence ?? null,
      raisedByEmail: staff.email,
    });
  }

  await recordStaffAction({
    actorEmail: staff.email,
    action: "risk.flagged",
    shopId: shop.id,
    summary: `Flagged ${shop.name} as ${input.severity} — ${input.summary.slice(0, 200)}`,
  });

  revalidatePath("/risk");
  revalidatePath(`/accounts/${shop.userId}`);
  return { ok: true, message: "Flagged." };
}

/**
 * Take a flag off the desk.
 *
 * A write, never a delete — see the schema. The reason is required, because the
 * single most useful row in this table a year from now is a flag somebody
 * dismissed in ninety seconds and turned out to be wrong about, and a
 * dismissal with no sentence attached cannot be learned from.
 *
 * `clearedAtValue` carries the evidence forward so the desk can re-raise when
 * things get worse rather than the moment the same arithmetic runs again.
 */
export async function clearRiskFlag(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const staff = await requireStaff("account:suspend");

  const id = String(formData.get("flagId") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 500);
  if (!id) return { ok: false, error: "That flag no longer exists." };
  if (!reason) {
    return {
      ok: false,
      error: "Say why. Whoever reads this after something goes wrong won't remember.",
    };
  }

  const db = getDb();
  const flag = await db.query.riskFlags.findFirst({
    where: eq(riskFlags.id, id),
    columns: { id: true, shopId: true, kind: true, evidence: true, clearedAt: true },
  });
  if (!flag) return { ok: false, error: "That flag no longer exists." };
  if (flag.clearedAt) return { ok: false, error: "That flag is already cleared." };

  const shop = await db.query.shops.findFirst({
    where: eq(shops.id, flag.shopId),
    columns: { userId: true, name: true },
  });

  // Guarded on `cleared_at is null`, so two people clearing the same flag at
  // once audit it once.
  const [cleared] = await db
    .update(riskFlags)
    .set({
      clearedAt: new Date(),
      clearedByEmail: staff.email,
      clearedReason: reason,
      clearedAtValue: flag.evidence,
    })
    .where(and(eq(riskFlags.id, flag.id), isNull(riskFlags.clearedAt)))
    .returning({ id: riskFlags.id });

  if (!cleared) return { ok: false, error: "Somebody else just cleared that one." };

  await recordStaffAction({
    actorEmail: staff.email,
    action: "risk.cleared",
    shopId: flag.shopId,
    summary: `Cleared the ${flag.kind} flag on ${shop?.name ?? "a shop"} — ${reason.slice(0, 200)}`,
  });

  revalidatePath("/risk");
  if (shop) revalidatePath(`/accounts/${shop.userId}`);
  return { ok: true, message: "Cleared." };
}
