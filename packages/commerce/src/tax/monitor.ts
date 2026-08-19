import "server-only";
import { eq, sql } from "drizzle-orm";
import { getDb } from "@sailo/db";
import {
  shops,
  taxJurisdictions,
  user,
  type Shop,
} from "@sailo/db/schema";
import { countryName } from "@sailo/core/countries";
import {
  INDICATIVE_RATES_REVIEWED_ON,
  TAX_THRESHOLDS_REVIEWED_ON,
  alertRung,
  placeKey,
  watchJurisdictions,
  type ThresholdWatch,
} from "@sailo/core/tax-thresholds";
import { wantsNotification } from "@sailo/notifications/prefs";
import { sendSellerTaxThreshold } from "@sailo/email/shop";
import { autoDisableCandidates } from "./country-rules";
import { placeRevenueFor } from "./report";

/**
 * Watching a shop's revenue against published registration thresholds, and
 * telling the seller before they cross one.
 *
 * Two rungs, 70% and 90%, each sent once per place per calendar year. "Once"
 * is a claim taken in a conditional UPDATE with the rung in the WHERE — never
 * a read followed by a write, which two overlapping cron ticks both pass and
 * which is the third bug shape on the recurring list.
 *
 * Nothing in here decides anybody's tax position. It counts stored minor units
 * and compares them to a dated published figure; the mail says so, the tab says
 * so, and the conclusion is the seller's.
 */

/** The window a threshold is measured over. Every figure here is one year. */
export function calendarYearWindow(now: Date): { from: Date; to: Date; year: number } {
  const year = now.getUTCFullYear();
  return {
    year,
    from: new Date(Date.UTC(year, 0, 1)),
    to: new Date(Date.UTC(year, 11, 31)),
  };
}

export type ShopThresholds = {
  year: number;
  watches: ThresholdWatch[];
  /** The dates behind the numbers, carried to every screen that shows one. */
  thresholdsReviewedOn: string;
  ratesReviewedOn: string;
};

/**
 * Where this shop stands, for the tab and for the monitor both.
 *
 * One function rather than two so the mail and the screen can never disagree
 * about a percentage — the half-updated function pair is the first of the six
 * recurring bug shapes, and "the seller was mailed at 90% and the tab said 62%"
 * is exactly its shape.
 */
export async function shopThresholds(
  shop: Pick<Shop, "id" | "invoiceCountry" | "stripeCountry" | "taxOssRegistered">,
  now = new Date(),
): Promise<ShopThresholds> {
  const { from, to, year } = calendarYearWindow(now);
  const db = getDb();

  const [rows, registrations] = await Promise.all([
    placeRevenueFor({ shopId: shop.id, from, to }),
    db
      .select({
        country: taxJurisdictions.country,
        region: taxJurisdictions.region,
      })
      .from(taxJurisdictions)
      .where(eq(taxJurisdictions.shopId, shop.id)),
  ]);

  return {
    year,
    watches: watchJurisdictions({
      rows,
      /*
       * The seller's own country, from the invoicing identity first and the
       * Stripe account second. It decides one thing and it matters: a sale at
       * home is not distance selling, so counting it toward the EU's combined
       * €10,000 would consume the whole allowance with domestic revenue and
       * warn a German seller about Germany.
       */
      homeCountry: shop.invoiceCountry ?? shop.stripeCountry ?? null,
      registeredKeys: registrations.map((r) => placeKey(r.country, r.region)),
      ossRegistered: shop.taxOssRegistered,
    }),
    thresholdsReviewedOn: TAX_THRESHOLDS_REVIEWED_ON,
    ratesReviewedOn: INDICATIVE_RATES_REVIEWED_ON,
  };
}

/**
 * A place's name in the seller's words, for a subject line.
 *
 * `Intl.DisplayNames` already ships every country translated, so nothing here
 * carries names. A US state is shown as its code beside the country — "US-CA"
 * reads worse than "California" and better than a wrong name, and there is no
 * subdivision list in this tree to look one up in.
 */
export function watchLabel(watch: ThresholdWatch, locale = "en"): string {
  if (watch.scope === "eu") return "the EU";
  if (!watch.country) return watch.key;
  const country = countryName(watch.country, locale);
  return watch.region ? `${watch.region}, ${country}` : country;
}

export type MonitorResult = {
  shops: number;
  alerts: number;
  disabled: number;
};

/**
 * The nightly pass: mail the rungs nobody has been told about, and switch off
 * the countries the seller asked to have switched off.
 */
export async function runTaxMonitor(
  opts: { shopId?: string; now?: Date } = {},
): Promise<MonitorResult> {
  const db = getDb();
  const now = opts.now ?? new Date();
  const { year } = calendarYearWindow(now);

  /*
   * Only shops that have something to watch. A shop with no fold rows this year
   * has taken nothing anywhere and cannot be near any threshold, and reading
   * every shop on the platform to discover that is the kind of nightly job that
   * quietly becomes the reason the cron times out.
   */
  const candidates = await db
    .select({
      id: shops.id,
      name: shops.name,
      currency: shops.currency,
      timeZone: shops.timeZone,
      invoiceCountry: shops.invoiceCountry,
      stripeCountry: shops.stripeCountry,
      taxOssRegistered: shops.taxOssRegistered,
      taxDisableOnThreshold: shops.taxDisableOnThreshold,
      notificationPrefs: shops.notificationPrefs,
      notificationEmail: shops.notificationEmail,
      contactEmail: shops.contactEmail,
      userId: shops.userId,
    })
    .from(shops)
    .where(
      opts.shopId
        ? eq(shops.id, opts.shopId)
        : sql`exists (select 1 from tax_revenue_daily t
                      where t.shop_id = ${shops.id}
                        and t.day >= make_date(${year}, 1, 1))`,
    );

  let alerts = 0;
  let disabled = 0;

  for (const shop of candidates) {
    const { watches } = await shopThresholds(shop, now);

    for (const watch of watches) {
      const rung = alertRung(watch.state);
      /*
       * Nothing to say about a place the seller is already registered in, and
       * nothing to say about one with no published figure — a mail that reads
       * "you are at an unknown percentage of an unknown number" is worse than
       * silence.
       */
      if (!rung || watch.registered || watch.thresholdMinor === null) continue;

      const country = watch.scope === "eu" ? "EU" : watch.country;
      if (!country) continue;

      const claimed = await claimRung({
        shopId: shop.id,
        // `EU` is the one non-ISO key this column holds; see the schema note.
        country,
        rung: watch.region ? `${watch.region}:${rung}` : rung,
        year,
      });
      if (!claimed) continue;

      alerts++;
      if (!wantsNotification(shop.notificationPrefs, "taxThreshold")) continue;

      const to = await sellerAddress(shop);
      if (!to) continue;

      /*
       * Swallowed, like every other seller notification: the mail reports on a
       * number that is already true, and a provider having a bad afternoon must
       * not fail the job that computed it. The claim above has already been
       * taken, which means a failed send is a warning the seller does not get
       * this year — the tab still shows it, and re-claiming on a transport
       * error would re-mail every shop on every retry.
       */
      try {
        await sendSellerTaxThreshold({
          shopName: shop.name,
          to,
          place: watchLabel(watch),
          rung,
          netCents: watch.netB2cMinor,
          thresholdCents: watch.thresholdMinor,
          currency: watch.currency,
          reviewedOn: TAX_THRESHOLDS_REVIEWED_ON,
          converted:
            watch.threshold !== null &&
            watch.threshold.currency.toUpperCase() !== watch.currency.toUpperCase(),
        });
      } catch (error) {
        console.error(`[sailo] tax threshold mail failed for ${shop.id}`, error);
      }
    }

    if (shop.taxDisableOnThreshold) {
      disabled += await autoDisable(
        shop.id,
        watches.filter((w) => w.state === "crossed" || w.state === "near"),
      );
    }
  }

  return { shops: candidates.length, alerts, disabled };
}

/**
 * Takes the rung, or finds it already taken.
 *
 * The whole of the once-only guarantee, and it is one statement. The `WHERE` on
 * the `DO UPDATE` is the ceiling: a row whose year already lists this rung
 * updates nothing and returns nothing, so the caller learns it lost. A read
 * followed by a write would have both of two concurrent ticks see "not sent".
 *
 * A new calendar year replaces the list rather than appending to it — the
 * thresholds are annual, so last year's 90% must not silence this year's 70%.
 */
async function claimRung(opts: {
  shopId: string;
  country: string;
  rung: string;
  year: number;
}): Promise<boolean> {
  const db = getDb();
  const result = await db.execute(sql`
    insert into tax_country_rules (shop_id, country, alerted_rungs, alerted_year)
    values (${opts.shopId}::uuid, ${opts.country}, array[${opts.rung}]::text[], ${opts.year})
    on conflict (shop_id, country) do update set
      alerted_rungs = case
        when tax_country_rules.alerted_year is distinct from ${opts.year}
          then array[${opts.rung}]::text[]
        else array_append(tax_country_rules.alerted_rungs, ${opts.rung})
      end,
      alerted_year = ${opts.year},
      updated_at = now()
    where tax_country_rules.alerted_year is distinct from ${opts.year}
       or not (${opts.rung} = any(tax_country_rules.alerted_rungs))
    returning shop_id
  `);
  return (result.rows ?? []).length > 0;
}

/**
 * Switches off the countries a crossed threshold implicates.
 *
 * Only where the seller asked for it, only where they are not already
 * registered, and never for the EU group — crossing €10,000 does not make
 * selling into the EU unlawful, it changes which rate applies, and closing
 * twenty-seven markets overnight is a far larger decision than the switch the
 * seller flipped.
 *
 * `auto_disabled_reason` is written because a seller who finds Germany missing
 * from their own checkout with no explanation cannot tell the panel from a bug,
 * and their first move would be to turn it back on without reading anything.
 */
async function autoDisable(
  shopId: string,
  crossed: ThresholdWatch[],
): Promise<number> {
  const db = getDb();
  let n = 0;

  for (const watch of crossed) {
    const [country] = autoDisableCandidates([watch]);
    if (!country) continue;

    const reason =
      `Sales reached ${Math.round((watch.ratio ?? 1) * 100)}% of the ` +
      `registration threshold published for ${watchLabel(watch)} ` +
      `(figure reviewed ${TAX_THRESHOLDS_REVIEWED_ON}).`;

    /*
     * Conditional, like the rung claim: only a row that is still enabled is
     * turned off. Without the `where`, a seller who deliberately re-enabled a
     * country would have it closed again on the next tick, for ever, and the
     * timestamp would keep moving so it would never look stuck.
     */
    const result = await db.execute(sql`
      insert into tax_country_rules
        (shop_id, country, sales_enabled, auto_disabled_at, auto_disabled_reason)
      values (${shopId}::uuid, ${country}, false, now(), ${reason})
      on conflict (shop_id, country) do update set
        sales_enabled = false,
        auto_disabled_at = now(),
        auto_disabled_reason = ${reason},
        updated_at = now()
      where tax_country_rules.sales_enabled
        and tax_country_rules.auto_disabled_at is null
      returning shop_id
    `);
    n += (result.rows ?? []).length;
  }

  return n;
}

/** `notificationEmail`, then `contactEmail`, then the account's own address. */
async function sellerAddress(shop: {
  notificationEmail: string | null;
  contactEmail: string | null;
  userId: string;
}): Promise<string | null> {
  if (shop.notificationEmail) return shop.notificationEmail;
  if (shop.contactEmail) return shop.contactEmail;
  const owner = await getDb().query.user.findFirst({
    where: eq(user.id, shop.userId),
    columns: { email: true },
  });
  return owner?.email ?? null;
}
