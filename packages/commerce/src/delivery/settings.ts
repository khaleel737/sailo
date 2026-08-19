import "server-only";
import { and, asc, eq, sql } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { deliveryMethods, type CurrencyPrices, type DeliveryConfig } from "@sailo/db/schema";
import { firstRow } from "@sailo/core/invariant";
import {
  DELIVERY_METHOD_DEFS,
  isDeliveryConfigured,
  isDeliveryMethodType,
  parseCountries,
} from "./delivery";

/**
 * Creating and changing the ways a shop gets an order to a buyer.
 *
 * `delivery.ts` next door holds what a delivery option *is* — its fields,
 * whether it is configured, and where it reaches. This holds what happens when
 * a seller edits one, and it exists for the reason `rail-settings.ts` does:
 * the rules were inside a `"use server"` function that parses a `FormData`, and
 * the phone posts JSON.
 *
 * TWO REFUSALS, AND THE SECOND ONE IS THE SUBTLE ONE
 *
 * The first is familiar: an option may not be enabled while a field it needs is
 * blank, because a collection point with no address is a checkout choice that
 * strands the buyer.
 *
 * The second is about a zone, and it is a refusal rather than a save because
 * the honest storage of the mistake means the *opposite* of what the seller
 * asked. An empty `countries` array means "anywhere". So a seller who picks
 * "selected countries" and then ticks none of them would have their intent —
 * ship to a specific short list — stored as ship to the entire world. There is
 * no value that can represent "somewhere, but I have not said where", so the
 * save is refused and they are asked.
 */

/** Long enough for a pickup address with directions. */
const MAX_FIELD = 500;
/** A name a phone can render in a row without truncating mid-word. */
const MAX_NAME = 60;

export type SaveDeliveryInput = {
  shopId: string;
  /** Null creates; an id updates, and is scoped to `shopId` in the WHERE. */
  id: string | null;
  type: string;
  name: string;
  /** Minor units, already parsed by whoever read the seller's keyboard. */
  feeCents: number;
  /** Free above this, or null for never. */
  freeOverCents: number | null;
  /**
   * The same fee in each other currency the shop quotes — spec 53.
   *
   * A rate with no entry for a currency is one that currency cannot be
   * offered with, and `liveCurrencies` holds the whole currency back rather
   * than quoting a euro basket a dollar postage fee.
   */
  currencyPrices?: CurrencyPrices;
  config: DeliveryConfig;
  isEnabled: boolean;
  /**
   * Where this option reaches.
   *
   * `"anywhere"` ignores `countries` entirely. `"selected"` requires at least
   * one that survives normalisation — see the header.
   */
  zone: "anywhere" | "selected";
  countries: string[];
};

export type SaveDeliveryResult =
  | { ok: true; id: string; created: boolean }
  | { ok: false; reason: "unknown_type" }
  | { ok: false; reason: "no_name" }
  | { ok: false; reason: "unconfigured" }
  | { ok: false; reason: "empty_zone" }
  | { ok: false; reason: "not_found" };

export async function saveDelivery(input: SaveDeliveryInput): Promise<SaveDeliveryResult> {
  if (!isDeliveryMethodType(input.type)) return { ok: false, reason: "unknown_type" };

  const name = input.name.trim().slice(0, MAX_NAME);
  if (!name) return { ok: false, reason: "no_name" };

  const def = DELIVERY_METHOD_DEFS[input.type];

  /* Rebuilt from the option's own field list rather than taken as given: the
     column is `jsonb` and would accept anything a client sent. */
  const config: DeliveryConfig = {};
  for (const field of def.fields) {
    const value = input.config[field.key]?.toString().trim();
    if (value) config[field.key] = value.slice(0, MAX_FIELD);
  }

  if (input.isEnabled && !isDeliveryConfigured(input.type, config)) {
    return { ok: false, reason: "unconfigured" };
  }

  /*
   * Collection never carries a zone, whatever was sent. A pickup happens at
   * the seller's own address, so filtering it by where the buyer lives would be
   * a rule about the buyer rather than about the delivery — and a shop that
   * accidentally set one would stop offering collection to the neighbours.
   */
  const wantsZone = input.type === "shipping" && input.zone === "selected";
  const countries = wantsZone ? parseCountries(input.countries) : [];
  if (wantsZone && countries.length === 0) return { ok: false, reason: "empty_zone" };

  const values = {
    type: input.type,
    name,
    feeCents: Math.max(0, Math.round(input.feeCents)),
    freeOverCents:
      input.freeOverCents === null ? null : Math.max(0, Math.round(input.freeOverCents)),
    /* Written whole rather than merged, for the reason the product's is:
       clearing a field must stop the currency being offered, and a merge
       would leave a fee a seller deliberately removed still being charged. */
    currencyPrices: input.currencyPrices ?? {},
    config,
    countries,
    isEnabled: input.isEnabled,
    updatedAt: new Date(),
  };

  const db = getDb();

  if (input.id) {
    const rows = await db
      .update(deliveryMethods)
      .set(values)
      .where(and(eq(deliveryMethods.id, input.id), eq(deliveryMethods.shopId, input.shopId)))
      .returning({ id: deliveryMethods.id });

    const row = rows[0];
    if (!row) return { ok: false, reason: "not_found" };
    return { ok: true, id: row.id, created: false };
  }

  /* Appended, so a new option does not jump ahead of the arrangement the
     seller already chose at checkout. */
  const { max } = firstRow(
    await db
      .select({ max: sql<string>`coalesce(max(${deliveryMethods.position}), 0)` })
      .from(deliveryMethods)
      .where(eq(deliveryMethods.shopId, input.shopId)),
    "max aggregate",
  );

  const rows = await db
    .insert(deliveryMethods)
    .values({ ...values, shopId: input.shopId, position: Number(max) + 1 })
    .returning({ id: deliveryMethods.id });

  return { ok: true, id: rows[0]?.id ?? "", created: true };
}

/** The shop's delivery options, in the order a buyer sees them. */
export function listDelivery(shopId: string) {
  return getDb().query.deliveryMethods.findMany({
    where: eq(deliveryMethods.shopId, shopId),
    orderBy: [asc(deliveryMethods.position)],
  });
}

/**
 * Switch one on or off.
 *
 * Turning *on* re-checks that it is configured, and that is not redundant with
 * `saveDelivery`: a collection point can be saved complete, have its address
 * cleared by a later edit that left it disabled, and then be toggled from a
 * stale screen. Returns null when there is no such row, and false when the
 * toggle was refused — two different things a screen has to say differently.
 */
export async function toggleDelivery(
  shopId: string,
  id: string,
): Promise<{ isEnabled: boolean } | "unconfigured" | null> {
  const db = getDb();
  const method = await db.query.deliveryMethods.findFirst({
    where: and(eq(deliveryMethods.id, id), eq(deliveryMethods.shopId, shopId)),
  });
  if (!method) return null;

  if (!method.isEnabled && !isDeliveryConfigured(method.type, method.config)) {
    return "unconfigured";
  }

  const isEnabled = !method.isEnabled;
  await db
    .update(deliveryMethods)
    .set({ isEnabled, updatedAt: new Date() })
    .where(and(eq(deliveryMethods.id, id), eq(deliveryMethods.shopId, shopId)));

  return { isEnabled };
}

export async function deleteDelivery(shopId: string, id: string): Promise<boolean> {
  const rows = await getDb()
    .delete(deliveryMethods)
    .where(and(eq(deliveryMethods.id, id), eq(deliveryMethods.shopId, shopId)))
    .returning({ id: deliveryMethods.id });
  return rows.length > 0;
}
