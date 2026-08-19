import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileWarning,
  Fingerprint,
  ShieldCheck,
} from "lucide-react";
import { Alert, Badge, Card, PageHeader } from "@sailo/design-system/web";
import { Detail, Mono, SectionTitle, StripeLink } from "@/app/_components/hq-ui";
import { EvidenceFileRow } from "@sailo/design-system/web/evidence-files";
import {
  RefundInstead,
  SendEvidence,
  StageEvidence,
} from "@/app/_components/dispute-actions";
import { removeDisputeFile } from "@/lib/actions/dispute-files";
import { getDisputeDetail } from "@/lib/platform/disputes";
import { PlatformCase } from "./_components/platform-case";
import { formatMoney } from "@sailo/core/currency";
import {
  EVIDENCE_FILE_ORDER,
  PAGE_GUIDANCE,
  daysToRespond,
  formatBytes,
  isFileField,
  isInquiry,
  playbookFor,
  type EvidenceFileField,
} from "@sailo/core/disputes";

export async function generateMetadata({
  params,
}: PageProps<"/disputes/[id]">): Promise<Metadata> {
  const { id } = await params;
  const detail = await getDisputeDetail(id);
  return {
    title: detail ? `Chargeback · ${detail.dispute.stripeDisputeId}` : "Chargeback",
  };
}

/**
 * One case, and everything that decides it.
 *
 * The queue answers "what is on fire". This answers the question a person
 * actually has to resolve before pressing an irreversible button: **what would
 * be sent, what is missing, and can this be won?**
 *
 * Laid out in the order that question decomposes:
 *
 *   1. The deadline and the money, because they bound every other decision.
 *   2. Whether Stripe will even accept a response right now. A closed window is
 *      worth knowing before reading three screens of evidence.
 *   3. Visa CE3.0 — whether this fraud case can be won by rule rather than by
 *      argument, and if not, exactly which of the rule's conditions failed.
 *   4. Every field of the submission, held or not, in the playbook's own order,
 *      so what is missing is visible beside what is not.
 *   5. The documents, which are the only part a human has to supply.
 *
 * Evidence is never taken from this page. The text is assembled server-side from
 * the order at the moment of sending — a browser that could post a shipping date
 * is a browser that could post a shipping date nobody shipped on, into a document
 * that goes to a bank. Files are the sole exception, and they are bytes rather
 * than claims.
 */
export default async function HqDisputePage({ params }: PageProps<"/disputes/[id]">) {
  const { id } = await params;
  const detail = await getDisputeDetail(id);
  if (!detail) notFound();

  const { dispute, shop, owner, order, files, budget, readiness, platform } = detail;
  const playbook = playbookFor(dispute.reason);
  const inquiry = isInquiry(dispute.status);
  const daysLeft = daysToRespond(dispute, new Date());
  const sent = Boolean(dispute.evidenceSubmittedAt);

  const attached = new Map(files.map((file) => [file.field, file]));
  const evidence = readiness?.evidence ?? null;

  /* Which file fields this reason actually needs, as opposed to merely accepts. */
  const requiredFiles = new Set<EvidenceFileField>(
    (evidence?.fields ?? [])
      .filter((field) => field.required && isFileField(field.field))
      .map((field) => field.field as EvidenceFileField),
  );

  return (
    <>
      <PageHeader
        title={playbook.label}
        description={`${dispute.reason}${
          dispute.networkReasonCode ? ` · ${dispute.networkReasonCode}` : ""
        } — ${dispute.stripeDisputeId}`}
        meta={
          sent ? (
            <Badge tone="green" dot>
              Answered {dispute.evidenceSubmittedAt?.toISOString().slice(0, 10)}
            </Badge>
          ) : daysLeft !== null && daysLeft <= 3 ? (
            <Badge tone="red" dot>
              {daysLeft === 0 ? "Due today" : `${daysLeft} days left`}
            </Badge>
          ) : (
            <Badge tone={inquiry ? "amber" : "red"} dot>
              {inquiry ? "Enquiry" : "Chargeback"}
            </Badge>
          )
        }
      />

      {/* ---------------------------------------------------------------- */}

      <Card className="mt-4 grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <Detail label="Deadline">
          {dispute.dueBy ? (
            <span className={daysLeft !== null && daysLeft <= 3 ? "text-red-600" : ""}>
              {dispute.dueBy.toISOString().slice(0, 10)}
              {daysLeft !== null ? ` · ${daysLeft} days` : ""}
            </span>
          ) : (
            "No deadline"
          )}
        </Detail>
        <Detail label={inquiry ? "At stake" : "Taken from the balance"}>
          {formatMoney(inquiry ? dispute.amountCents : dispute.deductedCents, dispute.currency)}
          {!inquiry && dispute.feeCents > 0 ? (
            <span className="block text-xs text-ink-400">
              {formatMoney(dispute.amountCents, dispute.currency)} plus a{" "}
              {formatMoney(dispute.feeCents, dispute.currency)} fee
            </span>
          ) : null}
        </Detail>
        <Detail label="Reason the bank gave">
          {playbook.label}
          <span className="block text-xs text-ink-400">
            {dispute.reason}
            {dispute.networkReasonCode ? ` · ${dispute.networkReasonCode}` : ""}
            {dispute.network ? ` · ${dispute.network}` : ""}
          </span>
        </Detail>
        <Detail label="Whose">
          {shop ? (
            <Link
              href={`/accounts/${shop.userId}`}
              className="underline underline-offset-4"
            >
              {shop.name}
            </Link>
          ) : (
            "No shop"
          )}
          <span className="block text-xs text-ink-400">
            {dispute.scope === "platform"
              ? "their Sailo subscription"
              : owner?.email ?? "connected account"}
          </span>
        </Detail>
      </Card>

      {dispute.stripeAccountId ? (
        <p className="mt-2 text-xs text-ink-500">
          <StripeLink
            id={dispute.stripeDisputeId}
            account={dispute.stripeAccountId}
            kind="disputes"
          />
        </p>
      ) : null}

      {/* ---------------------------------------------------------------- */}

      {/* ---------------------------------------------------------------- */}

      {/*
        Spec 46 — the platform case, which the panels below cannot render.

        Every field resolver in `assemble.ts` reads an order, a shipment, a
        download log or a duplicate candidate, and a subscription dispute has
        none of those. So a platform dispute gets its own evidence, its own three
        decision questions, and its own submit — and the connected panels are
        skipped entirely rather than shown empty.
      */}
      {platform ? (
        <PlatformCase
          disputeId={dispute.id}
          detail={platform}
          submittable={readiness?.submittable.allowed ?? true}
          sent={sent}
        />
      ) : null}

      {readiness === null && dispute.scope !== "platform" ? (
        <Alert tone="warning" title="Stripe could not be reached" className="mt-4">
          The deadline and amounts above are Sailo&rsquo;s copy of what Stripe last
          told us. The evidence below cannot be assembled without the live dispute,
          so nothing can be sent until Stripe answers again.
        </Alert>
      ) : readiness && !readiness.submittable.allowed && !sent ? (
        <Alert
          tone="warning"
          title="Stripe will not accept a response"
          icon={<Clock className="size-5" />}
          className="mt-4"
        >
          {readiness.submittable.why}
        </Alert>
      ) : null}

      {sent ? (
        <Alert
          tone="success"
          title="The answer has already gone"
          icon={<CheckCircle2 className="size-5" />}
          className="mt-4"
        >
          Stripe accepts one response per dispute. What was sent is recorded below and
          cannot be added to — a second submission is rejected rather than merged.
        </Alert>
      ) : null}

      {/* ---------------------------------------------------------------- */}

      {readiness ? (
        <>
          <SectionTitle>Can this be won by rule?</SectionTitle>
          <Card className="p-4">
            {readiness.ce3.offered ? (
              readiness.ce3.selection?.qualifies ? (
                <p className="flex items-start gap-2 text-sm text-ink-700">
                  <ShieldCheck className="mt-0.5 size-4 shrink-0 text-green-600" />
                  <span>
                    <span className="font-medium">Yes — Visa Compelling Evidence 3.0.</span>{" "}
                    Two prior undisputed transactions by this buyer qualify, matched on{" "}
                    {(readiness.ce3.selection.matched[0] ?? []).join(", ")}. Sending the
                    answer attaches them, and a qualifying CE3.0 response wins a fraud
                    case outright rather than putting it to the issuer&rsquo;s judgement.
                  </span>
                </p>
              ) : (
                <p className="flex items-start gap-2 text-sm text-ink-700">
                  <FileWarning className="mt-0.5 size-4 shrink-0 text-amber-600" />
                  <span>
                    <span className="font-medium">
                      Stripe offered CE3.0, but the buyer&rsquo;s history does not qualify.
                    </span>{" "}
                    {readiness.ce3.selection?.reason}. The ordinary evidence below is
                    still sent, and is still worth sending.
                  </span>
                </p>
              )
            ) : (
              <p className="flex items-start gap-2 text-sm text-ink-600">
                <Fingerprint className="mt-0.5 size-4 shrink-0 text-ink-400" />
                <span>
                  Stripe has not offered CE3.0 for this dispute
                  {playbook.ce3Eligible
                    ? " — it applies only to Visa fraud cases, and only once Visa has assessed the history."
                    : `, and it never applies to a ${playbook.label.toLowerCase()} case. Only fraud disputes qualify.`}
                  {readiness.ce3.selection?.qualifies ? (
                    <>
                      {" "}
                      Sailo does hold two qualifying priors, so if Visa offers the rule
                      later this case can use it.
                    </>
                  ) : null}
                </span>
              </p>
            )}
          </Card>

          {/* ---------------------------------------------------------------- */}

          <SectionTitle>
            What would be sent — {(evidence?.completenessBp ?? 0) / 100}% of what this
            reason needs
          </SectionTitle>
          <p className="-mt-2 mb-3 max-w-prose text-sm leading-relaxed text-ink-500">
            Assembled from the order, in the order the network weighs it. Percentages
            count required fields only: a full bar means nothing the network asks for is
            absent, not that the case will be won.
          </p>

          <Card className="divide-y divide-ink-100 p-0">
            {(evidence?.fields ?? []).map((field) => (
              <div key={field.field} className="flex items-start gap-3 p-3">
                <span className="mt-0.5 shrink-0">
                  {field.status === "held" ? (
                    <CheckCircle2 className="size-4 text-green-600" />
                  ) : field.required ? (
                    <AlertTriangle className="size-4 text-amber-600" />
                  ) : (
                    <span className="block size-4 rounded-full border border-ink-200" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-ink-900">
                    <Mono>{field.field}</Mono>
                    {field.required ? (
                      <span className="ml-2 rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-700">
                        Required
                      </span>
                    ) : null}
                  </p>
                  {field.status === "held" ? (
                    <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-relaxed text-ink-600">
                      {isFileField(field.field)
                        ? (attached.get(field.field as EvidenceFileField)?.filename ??
                          "attached")
                        : field.value}
                    </p>
                  ) : (
                    <p className="mt-1 text-xs text-ink-500">
                      {field.status === "not_applicable"
                        ? "Not applicable to this sale."
                        : (field.ask ??
                          "Not held, and nothing in the order can produce it.")}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </Card>
        </>
      ) : null}

      {/* ---------------------------------------------------------------- */}

      <SectionTitle>Documents</SectionTitle>
      <p className="-mt-2 mb-3 max-w-prose text-sm leading-relaxed text-ink-500">
        The only part of a submission Sailo cannot assemble. Stripe keeps{" "}
        <strong>one document per field</strong> — attaching a second replaces the first
        — and the card networks accept{" "}
        <strong>{formatBytes(budget.remainingBytes + budget.usedBytes)} across them all</strong>,
        under {PAGE_GUIDANCE.allNetworks} pages ({PAGE_GUIDANCE.mastercard} on Mastercard).
      </p>

      {budget.tight ? (
        <Alert tone="warning" title="Close to the size limit" className="mb-3">
          {formatBytes(budget.usedBytes)} of the allowance is used and{" "}
          {formatBytes(budget.remainingBytes)} is left. Compress what is attached before
          adding more — an upload refused at the deadline is evidence not sent.
        </Alert>
      ) : null}

      <Card className="p-4">
        {EVIDENCE_FILE_ORDER.map((field) => (
          <EvidenceFileRow
            key={field}
            disputeId={dispute.id}
            field={field}
            attached={attached.get(field) ?? null}
            required={requiredFiles.has(field)}
            /*
             * Staff review evidence before it goes — that is what staging is for
             * — and nobody can review a `file_1Abc…`. Stripe serves the bytes
             * only through a short-lived FileLink, so the preview is a route
             * that mints one on demand rather than a stored URL.
             */
            previewHref={
              attached.has(field)
                ? `/api/disputes/${dispute.id}/evidence/${field}`
                : null
            }
            as="staff"
            removeAction={removeDisputeFile}
            disabled={sent}
          />
        ))}
      </Card>

      {/* ---------------------------------------------------------------- */}

      {!sent ? (
        <>
          <SectionTitle>Answer</SectionTitle>
          <Card className="p-4">
            <p className="mb-3 max-w-prose text-sm leading-relaxed text-ink-600">
              <strong>Send</strong> is one shot — Stripe reads a single submitted
              response and rejects the next.{" "}
              <strong>Save a draft</strong> stores the same evidence on Stripe without
              answering, which is reversible and is what to press while somebody reads it.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <SendEvidence
                disputeId={dispute.id}
                complete={(evidence?.completenessBp ?? 0) >= 10_000}
              />
              <StageEvidence disputeId={dispute.id} />
              {inquiry ? <RefundInstead disputeId={dispute.id} /> : null}
            </div>
          </Card>
        </>
      ) : null}

      {order ? (
        <p className="mt-4 text-xs text-ink-500">
          Assembled from order{" "}
          <Link
            href={`/orders/${order.id}`}
            className="underline underline-offset-4"
          >
            <Mono>{order.id.slice(0, 8)}</Mono>
          </Link>{" "}
          placed {order.createdAt.toISOString().slice(0, 10)}.
        </p>
      ) : (
        <p className="mt-4 text-xs text-ink-500">
          No Sailo order sits behind this charge, so there is nothing to assemble from.
          Answer it from the Stripe dashboard, or refund it.
        </p>
      )}
    </>
  );
}
