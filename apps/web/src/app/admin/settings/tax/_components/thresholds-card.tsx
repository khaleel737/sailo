import { Badge, Card, Table, Td, Th, Tr, EmptyRow } from "@sailo/design-system/web";
import { getAdminT } from "@/i18n/server";
import { interpolate } from "@sailo/i18n";
import { formatMoney } from "@sailo/core/currency";
import { countryName } from "@sailo/core/countries";
import type { ShopThresholds } from "@sailo/commerce/tax/server";
import type { ThresholdWatch, WatchState } from "@sailo/commerce/tax";

/**
 * Revenue against the published figure for each place, and nothing more.
 *
 * The bar is the whole point and so is what it does not say. A row reads "you
 * have taken €7,100 of a €10,000 figure last checked on 2026-08-19" — it never
 * reads "you must register in Germany", which is a legal claim Sailo is not
 * qualified to make. The seller draws the conclusion.
 *
 * Rendered on the server: every figure comes from `shopThresholds`, which is
 * the same function the nightly monitor mails from, so a tile and an email can
 * never disagree about a percentage.
 */

const TONE: Record<WatchState, "neutral" | "amber" | "red" | "green"> = {
  crossed: "red",
  near: "red",
  approaching: "amber",
  immediate: "amber",
  under: "green",
  untracked: "neutral",
  uncomparable: "neutral",
};

export async function ThresholdsCard({ thresholds }: { thresholds: ShopThresholds }) {
  const { a, locale } = await getAdminT();

  const label: Record<WatchState, string> = {
    crossed: a.tax.stateCrossed,
    near: a.tax.stateNear,
    approaching: a.tax.stateApproaching,
    immediate: a.tax.stateImmediate,
    under: a.tax.stateUnder,
    untracked: a.tax.stateUntracked,
    uncomparable: a.tax.stateUncomparable,
  };

  const name = (watch: ThresholdWatch) => {
    if (watch.scope === "eu") return a.tax.euRow;
    if (!watch.country) return a.tax.notRecorded;
    const country = countryName(watch.country, locale);
    return watch.region ? `${watch.region}, ${country}` : country;
  };

  // A place whose figures came through an indicative rate says so on the card,
  // once, rather than on every row.
  const anyConverted = thresholds.watches.some(
    (w) =>
      w.threshold !== null &&
      w.thresholdMinor !== null &&
      w.threshold.currency.toUpperCase() !== w.currency.toUpperCase(),
  );

  return (
    <Card className="space-y-4 p-5">
      <div>
        <h2 className="text-sm font-semibold text-ink-900">{a.tax.thresholdsTitle}</h2>
        <p className="mt-0.5 text-xs text-ink-500">
          {interpolate(a.tax.thresholdsBody, { year: String(thresholds.year) })}
        </p>
        <p className="mt-1 text-xs text-ink-500">
          {interpolate(a.tax.reviewedOn, { date: thresholds.thresholdsReviewedOn })}
        </p>
        {anyConverted ? (
          <p className="mt-1 text-xs text-ink-500">
            {interpolate(a.tax.convertedNote, { date: thresholds.ratesReviewedOn })}
          </p>
        ) : null}
      </div>

      <Table
        minWidth="44rem"
        head={
          <>
            <Th>{a.tax.place}</Th>
            <Th align="end">{a.tax.taken}</Th>
            <Th align="end">{a.tax.threshold}</Th>
            <Th align="end">{a.tax.remaining}</Th>
            <Th align="end">{a.tax.b2bColumn}</Th>
            <Th align="end">{a.tax.ordersColumn}</Th>
            <Th align="end">{a.tax.taxColumn}</Th>
            <Th align="end" />
          </>
        }
      >
        {thresholds.watches.length === 0 ? (
          <EmptyRow colSpan={8}>{a.tax.thresholdsEmpty}</EmptyRow>
        ) : (
          thresholds.watches.map((watch) => (
            <Tr key={watch.key}>
              <Td>
                <span className="font-medium text-ink-900">{name(watch)}</span>
                {watch.scope === "eu" ? (
                  <span className="mt-0.5 block text-xs text-ink-500">
                    {a.tax.euBody}
                  </span>
                ) : null}
                {watch.crossedOnTransactions ? (
                  <span className="mt-0.5 block text-xs text-ink-500">
                    {a.tax.crossedOnCount}
                  </span>
                ) : null}
              </Td>
              <Td align="end" label={a.tax.taken}>
                {formatMoney(watch.netB2cMinor, watch.currency)}
              </Td>
              <Td align="end" label={a.tax.threshold}>
                {watch.thresholdMinor === null
                  ? "—"
                  : formatMoney(watch.thresholdMinor, watch.currency)}
              </Td>
              <Td align="end" label={a.tax.remaining}>
                {watch.remainingMinor === null
                  ? "—"
                  : formatMoney(watch.remainingMinor, watch.currency)}
              </Td>
              <Td align="end" label={a.tax.b2bColumn}>
                {formatMoney(watch.netB2bMinor, watch.currency)}
              </Td>
              <Td align="end" label={a.tax.ordersColumn}>
                {watch.orderCount}
              </Td>
              <Td align="end" label={a.tax.taxColumn}>
                {formatMoney(watch.taxMinor, watch.currency)}
              </Td>
              <Td align="end">
                {watch.registered ? (
                  <Badge tone="neutral">{a.tax.registeredHere}</Badge>
                ) : (
                  <Badge tone={TONE[watch.state]} dot>
                    {label[watch.state]}
                  </Badge>
                )}
              </Td>
            </Tr>
          ))
        )}
      </Table>
    </Card>
  );
}
