/**
 * The Stripe half of chargebacks.
 *
 * `@sailo/core/disputes` decides things; this submits them. The split is the
 * usual one for this package — a capability behind a seam, no business rules —
 * and it earns its keep here more than anywhere: every function below takes the
 * connected account explicitly, because a dispute retrieved without one comes
 * back "No such dispute" and reads exactly like a bad id.
 */

export { deductionOf, normalizeDispute, type NormalizedDispute } from "./normalize";
export {
  evidenceFileUrl,
  uploadEvidenceFile,
  type UploadedEvidenceFile,
  type UploadResult,
} from "./files";
export {
  acknowledgeComplianceFee,
  canSubmit,
  ce3Eligibility,
  chargeIdForIntent,
  retrieveDispute,
  submitEvidence,
  type SubmitResult,
} from "./submit";
export {
  holdPayouts,
  payoutStateOf,
  readBalance,
  readPayoutState,
  releasePayouts,
  type ConnectedBalance,
  type PayoutHoldResult,
  type PayoutInterval,
  type PayoutState,
} from "./payouts";
