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
  reassessShopsAtRisk,
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

/*
 * Spec 44 — capturing what a dispute is answered with, at the moment it is
 * knowable. Every one of these runs on a path a buyer or Stripe is waiting on
 * and none of them may throw into it.
 */
export {
  accountHistory,
  awaitingDeliveryConfirmation,
  confirmDelivery,
  latestSnapshot,
  logOrderMessage,
  markMessageStatus,
  messagesForOrder,
  recordAccountEvent,
  snapshotPolicy,
  type AccountEventInput,
  type DeliveryResult,
  type LogMessageInput,
  type SnapshotInput,
} from "./capture";
export {
  PLATFORM_POLICY_PATHS,
  policySnapshotsForOrder,
  readablePolicy,
  snapshotFromUrl,
  snapshotPlatformPolicies,
} from "./policies";
export { arrivalToken, arrivalUrl, readArrivalToken } from "./arrival";

/*
 * Spec 46 — Sailo answering a chargeback against its own subscription revenue.
 * The pure half is `@sailo/core/disputes/platform.ts`; this is the reads, the
 * rollup that keeps them answerable, and the two claims that stop a retried
 * webhook paging the desk twice or downgrading a shop that has not lost yet.
 */
export {
  PLATFORM_CHARGEBACK_LIMIT,
  PLATFORM_STATEMENT_DESCRIPTOR,
  claimStaffNotice,
  enforceCardBillingBlock,
  holdPlanForDispute,
  platformDecision,
  platformHoldingsFor,
  reinstatePlanAfterWin,
  respondToPlatformDispute,
  rollUpPlatformUsage,
  type PlatformRespondResult,
  type UsageRollupResult,
} from "./platform";

/*
 * Spec 45 — the order evidence pack. The pure content assembly is
 * `@sailo/core/disputes/pack.ts`; this is the read that fills it and the rules
 * about which documents fit inside the 4.5 MB the networks accept.
 */
export {
  SAILO_UPLOADER,
  evictGeneratedFor,
  generatedFields,
  latestDisputeForOrder,
  offerablePackDocuments,
  orderForDispute,
  packHoldingsForOrder,
} from "./pack-holdings";
