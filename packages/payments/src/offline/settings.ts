import "server-only";
import { and, asc, eq, sql } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { paymentMethods, type PaymentConfig } from "@sailo/db/schema";
import { firstRow } from "@sailo/core/invariant";
import {
  isConfigured,
  isPaymentMethodType,
  isRailAvailable,
  isRailUsable,
  PAYMENT_METHOD_DEFS,
  PAYMENT_METHOD_LIST,
  type PaymentMethodType,
} from "./rails";

/**
 * Turning a rail on and off, from either surface.
 *
 * `rails.ts` next door holds what a rail *is* — its fields, which currencies it
 * can settle, whether it is configured. This holds what happens when a seller
 * changes one, and it exists because that decision was previously written into
 * a Next server action: `apps/web/src/lib/actions/payments.ts` parsed a
 * `FormData`, applied the one rule that matters, wrote the row and revalidated
 * three paths, all in one function. The phone can call none of that.
 *
 * So the rule moved and the plumbing stayed. Both callers now run the same
 * refusal, and the refusal is the whole point of the file: **a rail may not be
 * enabled while a field it needs is blank.** A half-configured option is worse
 * than a missing one — it puts a button on the storefront that takes the buyer
 * somewhere broken, and the seller cannot see it because their own admin shows
 * the toggle as on.
 *
 * Written as a returned verdict rather than a thrown error, following
 * `changeOrderStatus`: the web renders a sentence into a form and the phone
 * throws a `TRPCError`, and a shared function that picked one of those would
 * make the other one wrong.
 */

/** What a caller may change about one rail. */
export type SaveRailInput = {
  shopId: string;
  type: string;
  /** Only the keys this rail's own definition names are kept. */
  config: PaymentConfig;
  isEnabled: boolean;
  /** The seller's override for the button text, or null for the default. */
  label: string | null;
};

export type SaveRailResult =
  | { ok: true; type: PaymentMethodType }
  /** A `type` that is not a rail at all. */
  | { ok: false; reason: "unknown" }
  /**
   * Enabling was refused. `missing` names the required fields that were blank,
   * as **field keys, not labels** — the labels in `PAYMENT_METHOD_DEFS` are
   * English literals, and handing them to a caller that renders in 35 languages
   * would be a sentence half-translated. Each surface looks the keys up in its
   * own dictionary.
   */
  | { ok: false; reason: "unconfigured"; missing: string[] };

/** The longest a config value may be. Long enough for a bank IBAN and a note. */
const MAX_FIELD = 500;
/** The longest a seller's own button text may be. */
const MAX_LABEL = 60;

/**
 * Save one rail's settings for one shop.
 *
 * The config is rebuilt from the rail's own field list rather than taken as
 * given, so a caller cannot write a key this rail has no use for — the column
 * is `jsonb`, which would accept anything, and "whatever the client sent"
 * stored under a seller's payment settings is how a storefront ends up
 * rendering a value nobody validated.
 */
export async function saveRail(input: SaveRailInput): Promise<SaveRailResult> {
  if (!isPaymentMethodType(input.type)) return { ok: false, reason: "unknown" };

  const def = PAYMENT_METHOD_DEFS[input.type];

  const config: PaymentConfig = {};
  for (const field of def.fields) {
    const value = input.config[field.key]?.toString().trim();
    if (value) config[field.key] = value.slice(0, MAX_FIELD);
  }

  if (input.isEnabled && !isConfigured(input.type, config)) {
    return {
      ok: false,
      reason: "unconfigured",
      missing: def.fields.filter((f) => f.required && !config[f.key]).map((f) => f.key),
    };
  }

  const label = input.label?.trim().slice(0, MAX_LABEL) || null;
  const db = getDb();

  /*
   * Appended to the end of the seller's existing order. Read rather than
   * assumed because `position` decides the order the buttons appear in on the
   * storefront, and defaulting a new rail to 0 would silently promote it above
   * everything the seller had already arranged.
   */
  const { max } = firstRow(
    await db
      .select({ max: sql<string>`coalesce(max(${paymentMethods.position}), 0)` })
      .from(paymentMethods)
      .where(eq(paymentMethods.shopId, input.shopId)),
    "max aggregate",
  );

  await db
    .insert(paymentMethods)
    .values({
      shopId: input.shopId,
      type: input.type,
      label,
      config,
      isEnabled: input.isEnabled,
      position: Number(max) + 1,
    })
    /* One row per shop per rail — the unique index says so. A second save is an
       edit, not a duplicate, and `position` is deliberately left alone here so
       an edit does not move the button. */
    .onConflictDoUpdate({
      target: [paymentMethods.shopId, paymentMethods.type],
      set: { label, config, isEnabled: input.isEnabled, updatedAt: new Date() },
    });

  return { ok: true, type: input.type };
}

/** A rail as a settings screen needs to show it: the definition, plus this shop's row. */
export type RailSetting = {
  type: PaymentMethodType;
  category: (typeof PAYMENT_METHOD_DEFS)[PaymentMethodType]["category"];
  /** English, from the definition — see the note on `SaveRailResult`. */
  name: string;
  /** What this rail does, in the seller's terms. English, same caveat. */
  description: string;
  /**
   * The currencies this rail can settle, or null for "anywhere".
   *
   * Sent so a screen can *name* them when it refuses. "PayPal settles in 22
   * currencies" reads as trivia; "PayPal settles in EUR, GBP, USD… and your
   * shop is in JOD" reads as the reason, and the seller stops filling in a
   * form that could never have worked.
   */
  currencies: readonly string[] | null;
  fields: (typeof PAYMENT_METHOD_DEFS)[PaymentMethodType]["fields"];
  label: string | null;
  config: PaymentConfig;
  isEnabled: boolean;
  position: number;
  /** Every required field is filled in. */
  configured: boolean;
  /** This rail can settle the shop's currency at all. */
  available: boolean;
  /**
   * A buyer could use it right now.
   *
   * Three different answers a seller needs told apart, which is why all three
   * are here rather than one boolean: "you have not filled this in" is work
   * they can do, "this cannot work in your currency" is not, and "Stripe has
   * not cleared you yet" is waiting.
   */
  usable: boolean;
};

/**
 * Every rail Sailo offers, with this shop's settings merged onto it.
 *
 * The full list rather than the rows that exist: a settings screen has to show
 * a seller the rails they have *not* turned on, and a query over
 * `paymentMethods` only knows about the ones they have. So the definitions lead
 * and the rows are joined onto them.
 */
export async function listRails(shop: {
  id: string;
  currency: string;
  stripeAccountId: string | null;
  stripeChargesEnabled: boolean;
}): Promise<RailSetting[]> {
  const rows = await getDb().query.paymentMethods.findMany({
    where: eq(paymentMethods.shopId, shop.id),
    orderBy: [asc(paymentMethods.position)],
  });
  const byType = new Map(rows.map((row) => [row.type, row]));

  return PAYMENT_METHOD_LIST.map((def) => {
    const row = byType.get(def.type);
    const config = row?.config ?? {};

    return {
      type: def.type,
      category: def.category,
      name: def.name,
      description: def.description,
      currencies: def.availability?.currencies ?? null,
      fields: def.fields,
      label: row?.label ?? null,
      config,
      isEnabled: row?.isEnabled ?? false,
      position: row?.position ?? 0,
      configured: isConfigured(def.type, config),
      available: isRailAvailable(def.type, shop.currency),
      /*
       * `isRailUsable` is asked rather than re-derived, because card is the
       * exception that breaks every shortcut: it has no fields, so
       * `isConfigured` always says yes, and what actually makes it usable is a
       * Stripe account Stripe has cleared for charges.
       */
      usable: isRailUsable(def.type, config, shop),
    };
  });
}

/** Remove a rail's row entirely — different from disabling it. */
export async function deleteRail(shopId: string, type: string): Promise<boolean> {
  if (!isPaymentMethodType(type)) return false;
  const rows = await getDb()
    .delete(paymentMethods)
    .where(and(eq(paymentMethods.shopId, shopId), eq(paymentMethods.type, type)))
    .returning({ type: paymentMethods.type });
  return rows.length > 0;
}
