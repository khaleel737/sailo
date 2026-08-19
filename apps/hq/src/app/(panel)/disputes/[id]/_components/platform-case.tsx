import { CheckCircle2, CircleAlert, CircleHelp, HandCoins } from "lucide-react";
import { Alert, Badge, Card } from "@sailo/design-system/web";
import { SectionTitle } from "@/app/_components/hq-ui";
import { SendPlatformEvidence } from "@/app/_components/dispute-actions";
import type {
  AssembledPlatformEvidence,
  ContestDecision,
  PlatformHoldings,
} from "@sailo/core/disputes";

/**
 * A chargeback against Sailo's own subscription revenue. Spec 46.
 *
 * Three blocks, in the order the decision decomposes:
 *
 *   1. **Should we fight this at all.** The three questions, answered, and a
 *      headline that says plainly when the answer is no. *"If the seller is
 *      right, refund"* is the rule spec 46 calls the one that matters most, and
 *      a desk that offered a submit button beside a case we are going to lose
 *      would teach the person on shift to press it anyway.
 *   2. **What we hold.** Signup, terms acceptance, sign-in history, real usage —
 *      the record that makes a SaaS subscription among the most defensible
 *      things there is.
 *   3. **What would be sent**, field by field, as the connected side shows it.
 *
 * The submit button is absent, not disabled, when the verdict is `refund`. A
 * disabled button is an invitation to look for the way round it.
 */
export function PlatformCase({
  disputeId,
  detail,
  submittable,
  sent,
}: {
  disputeId: string;
  detail: {
    holdings: PlatformHoldings;
    evidence: AssembledPlatformEvidence;
    decision: ContestDecision;
  };
  submittable: boolean;
  sent: boolean;
}) {
  const { holdings, evidence, decision } = detail;

  return (
    <>
      <SectionTitle>Should we fight this?</SectionTitle>

      <Alert
        tone={
          decision.verdict === "refund"
            ? "warning"
            : decision.verdict === "inquiry_only"
              ? "info"
              : "success"
        }
        icon={
          decision.verdict === "refund" ? (
            <HandCoins className="size-5" />
          ) : (
            <CheckCircle2 className="size-5" />
          )
        }
        title={
          decision.verdict === "refund"
            ? "Refund, do not contest"
            : decision.verdict === "inquiry_only"
              ? "An enquiry — answer it, and do not downgrade"
              : "Worth contesting"
        }
      >
        {decision.headline}
      </Alert>

      <Card className="mt-3 divide-y divide-ink-100 p-0">
        {decision.questions.map((question) => (
          <div key={question.question} className="flex items-start gap-3 p-3">
            <span className="mt-0.5 shrink-0">
              {question.favours === "us" ? (
                <CheckCircle2 className="size-4 text-green-600" />
              ) : question.favours === "them" ? (
                <CircleAlert className="size-4 text-amber-600" />
              ) : (
                /*
                 * Grey, not red. "We did not measure" is not "they did not use
                 * it", and colouring the two the same is how a desk talks
                 * itself out of a case it should have made.
                 */
                <CircleHelp className="size-4 text-ink-400" />
              )}
            </span>
            <div className="min-w-0">
              <p className="text-sm font-medium text-ink-900">{question.question}</p>
              <p className="mt-0.5 text-sm text-ink-600">{question.answer}</p>
            </div>
          </div>
        ))}
      </Card>

      {/* ------------------------------------------------------------------ */}

      <SectionTitle>What we hold about this account</SectionTitle>
      <Card className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <Fact label="Signed up">
          {holdings.signupAt ? holdings.signupAt.toISOString().slice(0, 10) : "not on record"}
          {holdings.signupIp ? (
            <span className="block text-xs text-ink-400">
              {holdings.signupIp}
              {holdings.signupCountry ? ` · ${holdings.signupCountry}` : ""}
            </span>
          ) : null}
        </Fact>
        <Fact label="Accepted Sailo's terms">
          {holdings.termsAcceptedAt
            ? holdings.termsAcceptedAt.toISOString().slice(0, 10)
            : "not on record"}
          {holdings.termsText ? (
            <span className="block text-xs text-ink-400">
              text snapshotted{" "}
              {holdings.termsCapturedAt?.toISOString().slice(0, 10) ?? ""}
            </span>
          ) : (
            /*
             * Named rather than left blank. Without a platform snapshot the
             * cancellation-policy disclosure is a link to a page that has since
             * changed — the same weakness spec 44 fixes for sellers, and it
             * applies to us. `deploy:post` is what fills it.
             */
            <span className="block text-xs text-amber-600">
              no platform snapshot — run deploy:post
            </span>
          )}
        </Fact>
        <Fact label="Sign-ins on record">
          {holdings.signins.length}
          <span className="block text-xs text-ink-400">
            account_events, kept 400 days
          </span>
        </Fact>
        <Fact label="Usage days">
          {holdings.usage.length}
          {holdings.usageGaps.length > 0 ? (
            /*
             * Gaps stated, on the desk as well as in the submission. A day the
             * rollup never ran is not a day the seller did not use Sailo, and a
             * false zero argues our own case against us.
             */
            <span className="block text-xs text-amber-600">
              {holdings.usageGaps.length} day(s) with no rollup — printed as gaps,
              never as zeroes
            </span>
          ) : (
            <span className="block text-xs text-ink-400">no gaps in the window</span>
          )}
        </Fact>
      </Card>

      {/* ------------------------------------------------------------------ */}

      <SectionTitle>
        What would be sent — {evidence.completenessBp / 100}% of what this reason needs
      </SectionTitle>
      <p className="-mt-2 mb-3 max-w-prose text-sm leading-relaxed text-ink-500">
        Assembled from the account rather than from an order: there is no parcel and
        no download here. Percentages count required fields only.
      </p>

      <Card className="divide-y divide-ink-100 p-0">
        {evidence.fields.map((field) => (
          <div key={field.field} className="flex items-start gap-3 p-3">
            <span className="mt-0.5 shrink-0">
              {field.status === "held" ? (
                <CheckCircle2 className="size-4 text-green-600" />
              ) : (
                <CircleAlert className="size-4 text-amber-600" />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-mono text-xs text-ink-700">{field.field}</p>
                {field.required ? <Badge tone="neutral">required</Badge> : null}
              </div>
              {field.value ? (
                <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words text-xs text-ink-600">
                  {field.value}
                </pre>
              ) : (
                <p className="mt-1 text-xs text-ink-500">Not on record.</p>
              )}
            </div>
          </div>
        ))}
      </Card>

      {/* ------------------------------------------------------------------ */}

      {sent ? (
        <Alert tone="success" title="The answer has already gone" className="mt-4">
          Stripe accepts one response per dispute. A second submission is rejected
          rather than merged.
        </Alert>
      ) : decision.verdict === "refund" ? (
        /*
         * No submit button at all, rather than a disabled one. A disabled
         * control is an invitation to look for the way round it, and the
         * decision here is not "you may not" but "we should not".
         */
        <Alert tone="warning" title="No submission offered" className="mt-4">
          {decision.headline} Refund it from the actions above.
        </Alert>
      ) : submittable ? (
        <div className="mt-4">
          <SendPlatformEvidence disputeId={disputeId} />
        </div>
      ) : (
        <Alert tone="warning" title="Stripe will not accept a response" className="mt-4">
          The window has closed or an answer has already been recorded on Stripe&rsquo;s
          side.
        </Alert>
      )}
    </>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-medium uppercase tracking-wide text-ink-400">{label}</p>
      <p className="mt-1 text-sm text-ink-900">{children}</p>
    </div>
  );
}
