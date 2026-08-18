/**
 * Chargebacks, as rows.
 *
 * The domain half: recording what Stripe reports, gathering what Sailo holds,
 * measuring a shop against the orders its disputes came from, and applying the
 * one escalation that code is allowed to apply on its own.
 *
 * The decisions are all in `@sailo/core/disputes` and the Stripe calls are all in
 * `@sailo/payments/disputes`. What is left here is the part that needs a database,
 * which is also the part that cannot be tested without one — so the split is
 * drawn so that everything worth arguing about is on the other side of it.
 */

export {
  linkWarningToDispute,
  paymentStatusForDispute,
  recordDispute,
  recordEarlyFraudWarning,
  type DisputeScope,
  type RecordedDispute,
} from "./record";
export {
  ce3CandidatesFor,
  holdingsForOrder,
  identityOf,
} from "./holdings";
export {
  evidenceCoverage,
  platformDisputeMonths,
  shopDisputeStats,
  type PlatformMonth,
  type ShopDisputeStats,
} from "./stats";
export {
  applyEscalation,
  releaseHold,
  riskFor,
  type EscalationOutcome,
} from "./guard";
export {
  attachEvidenceFile,
  detachEvidenceFile,
  evidenceBudget,
  evidenceFileIdsFor,
  evidenceFileLink,
  evidenceFilesFor,
  type AttachResult,
  type EvidenceFileRow,
} from "./files";
export {
  disputeReadiness,
  respondToDispute,
  type DisputeReadiness,
  type RespondResult,
} from "./respond";
