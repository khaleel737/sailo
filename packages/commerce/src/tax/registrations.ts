import "server-only";
import { and, asc, eq, sql } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { taxCountryRules, taxJurisdictions } from "@sailo/db/schema";
import { isCountryCode } from "@sailo/core/countries";
import { OPEN_GATE, type CountryGate } from "./country-rules";

/**
 * The seller's own record of where they are registered, and which countries
 * they will sell into.
 *
 * Both are ordinary settings writes, scoped to the shop in the WHERE like every
 * other one — a jurisdiction id arrives from a form and is never trusted to
 * belong to whoever posted it.
 */

export type JurisdictionInput = {
  country: string;
  region: string | null;
  registrationNumber: string | null;
  registeredOn: string | null;
  expiresOn: string | null;
  /** Basis points, or null for "use the shop's flat rate". */
  rateBp: number | null;
};

export type JurisdictionResult =
  | { ok: true; id: string }
  | { ok: false; error: "country" | "rate" | "dates" };

const MAX_RATE_BP = 10_000;

/**
 * Add or update one registration.
 *
 * `rateBp` null and `rateBp` zero are different instructions and the reader has
 * to keep them apart: null means "use the shop's flat rate here", zero means
 * "this place is zero-rated". Blank is not zero — rule 6, and this is the exact
 * shape it warns about.
 */
export async function saveJurisdiction(
  shopId: string,
  id: string | null,
  input: JurisdictionInput,
): Promise<JurisdictionResult> {
  const country = input.country.trim().toUpperCase();
  if (!isCountryCode(country)) return { ok: false, error: "country" };

  const region = input.region?.trim().toUpperCase() || null;
  if (
    input.rateBp !== null &&
    (!Number.isInteger(input.rateBp) || input.rateBp < 0 || input.rateBp > MAX_RATE_BP)
  ) {
    return { ok: false, error: "rate" };
  }
  if (
    input.registeredOn &&
    input.expiresOn &&
    input.expiresOn < input.registeredOn
  ) {
    return { ok: false, error: "dates" };
  }

  const db = getDb();
  const values = {
    country,
    region,
    registrationNumber: input.registrationNumber?.trim() || null,
    registeredOn: input.registeredOn || null,
    expiresOn: input.expiresOn || null,
    rateBp: input.rateBp,
    updatedAt: new Date(),
  };

  if (id) {
    const [row] = await db
      .update(taxJurisdictions)
      .set(values)
      .where(and(eq(taxJurisdictions.id, id), eq(taxJurisdictions.shopId, shopId)))
      .returning({ id: taxJurisdictions.id });
    // A missing row is somebody else's id, and the answer is the same either
    // way: nothing changed, and nothing is said about whose it was.
    return row ? { ok: true, id: row.id } : { ok: false, error: "country" };
  }

  /*
   * Raw, because the uniqueness this upserts against is an *expression* index —
   * `coalesce(region, '')`, which exists so that two national registrations for
   * the same country collide. Postgres cannot infer an expression index from a
   * list of columns, and the query builder's conflict target only takes
   * columns, so naming the expression is the only way to say what is meant.
   * The alternative is a read followed by an insert, which is check-then-act
   * and races with the seller's own double-click.
   */
  const inserted = await db.execute(sql`
    insert into tax_jurisdictions
      (shop_id, country, region, registration_number,
       registered_on, expires_on, rate_bp, updated_at)
    values (
      ${shopId}::uuid, ${country}, ${region}, ${values.registrationNumber},
      ${values.registeredOn}::date, ${values.expiresOn}::date,
      ${values.rateBp}, now()
    )
    on conflict (shop_id, country, coalesce(region, '')) do update set
      registration_number = excluded.registration_number,
      registered_on       = excluded.registered_on,
      expires_on          = excluded.expires_on,
      rate_bp             = excluded.rate_bp,
      updated_at          = now()
    returning id
  `);
  const row = ((inserted.rows ?? []) as { id: string }[])[0];

  return row ? { ok: true, id: row.id } : { ok: false, error: "country" };
}

export async function deleteJurisdiction(shopId: string, id: string): Promise<void> {
  await getDb()
    .delete(taxJurisdictions)
    .where(and(eq(taxJurisdictions.id, id), eq(taxJurisdictions.shopId, shopId)));
}

export async function jurisdictionsFor(shopId: string) {
  return getDb()
    .select()
    .from(taxJurisdictions)
    .where(eq(taxJurisdictions.shopId, shopId))
    .orderBy(asc(taxJurisdictions.country), asc(taxJurisdictions.region));
}

/**
 * The seller turning a country on or off by hand.
 *
 * Turning one back *on* clears nothing but the switch: `auto_disabled_at` and
 * its reason stay, because they are the record of why it went off, and because
 * the monitor reads that timestamp to decide it has already had its say. Losing
 * it would have the next nightly tick close the country again, for ever.
 */
export async function setCountrySales(
  shopId: string,
  country: string,
  enabled: boolean,
): Promise<void> {
  const code = country.trim().toUpperCase();
  if (!isCountryCode(code)) return;

  await getDb()
    .insert(taxCountryRules)
    .values({ shopId, country: code, salesEnabled: enabled })
    .onConflictDoUpdate({
      target: [taxCountryRules.shopId, taxCountryRules.country],
      set: { salesEnabled: enabled, updatedAt: new Date() },
    });
}

export async function countryRulesFor(shopId: string) {
  return getDb()
    .select()
    .from(taxCountryRules)
    .where(eq(taxCountryRules.shopId, shopId))
    .orderBy(asc(taxCountryRules.country));
}

/**
 * The gate the storefront and the checkout both read.
 *
 * One read, two consumers, on purpose. A picker built from one source and a
 * refusal built from another is the "guard at one sink and not its twin" shape,
 * and here the consequence is a country a buyer can select and then be refused
 * at the last step — or worse, the reverse.
 */
export async function countryGateFor(shop: {
  id: string;
  taxDisableImmediateObligation: boolean;
}): Promise<CountryGate> {
  const rows = await getDb()
    .select({
      country: taxCountryRules.country,
      salesEnabled: taxCountryRules.salesEnabled,
    })
    .from(taxCountryRules)
    .where(
      and(
        eq(taxCountryRules.shopId, shop.id),
        eq(taxCountryRules.salesEnabled, false),
      ),
    );

  if (rows.length === 0 && !shop.taxDisableImmediateObligation) return OPEN_GATE;

  return {
    disabled: new Set(rows.map((r) => r.country.toUpperCase())),
    refuseImmediate: shop.taxDisableImmediateObligation,
  };
}
