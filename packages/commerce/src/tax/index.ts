/**
 * The tax jurisdiction feature's browser-safe half.
 *
 * `country-rules` is here rather than behind `./server` because both sides need
 * it: the storefront builds its country picker from the gate and the checkout
 * refuses with the same predicate. Everything that reads a row is in
 * `./server`.
 */
export * from "./country-rules";
export {
  TAX_THRESHOLDS_REVIEWED_ON,
  INDICATIVE_RATES_REVIEWED_ON,
  EU_MEMBER_STATES,
  EU_DISTANCE_SELLING,
  US_NEXUS,
  IMMEDIATE_OBLIGATION,
  APPROACHING_RATIO,
  NEAR_RATIO,
  alertRung,
  convertMinor,
  indicativeRate,
  isEuMemberState,
  placeKey,
  thresholdFor,
  thresholdMinorIn,
  watchJurisdictions,
  type PlaceRevenue,
  type TaxThreshold,
  type ThresholdWatch,
  type WatchState,
} from "@sailo/core/tax-thresholds";
