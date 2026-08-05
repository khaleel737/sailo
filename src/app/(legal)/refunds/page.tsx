import type { Metadata } from "next";
import {
  Callout,
  Clause,
  ContactBlock,
  List,
  Mail,
  P,
  Ref,
} from "@/components/legal/legal-kit";
import { LEGAL } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Refund Policy",
  description:
    "How to request a refund of a Sailo subscription, what we look at when deciding, how long it takes, and who to contact about an order placed with a shop.",
  alternates: { canonical: "/refunds" },
};

export default function RefundsPage() {
  return (
    <article>
      <h1 className="display text-[clamp(2.25rem,5vw,3rem)] text-[var(--ink)]">
        Refund Policy
      </h1>
      <p className="mt-4 text-[0.8125rem] text-[var(--mute-400)]">
        Effective {LEGAL.effective}
      </p>
      <p className="mt-8 text-[1.0625rem] leading-[1.7] text-[var(--mute-600)]">
        This policy covers money paid to {LEGAL.product} for a subscription. It is
        written to be read once and understood, because a refund policy that needs
        interpreting is doing its job badly.
      </p>

      <div className="mt-14 space-y-12">
        <Clause id="scope" n={1} title="Which payment are you asking about?">
          <Callout>
            Two different kinds of payment happen around {LEGAL.product}, and only one
            of them is ours to refund.
          </Callout>
          <P>
            <strong className="font-medium text-[var(--ink)]">
              A Sailo subscription
            </strong>{" "}
            is money you paid us for a Pro or Business plan. That is what this policy
            governs. Email <Mail address={LEGAL.refundEmail} />.
          </P>
          <P>
            <strong className="font-medium text-[var(--ink)]">
              An order placed with a shop
            </strong>{" "}
            is money you paid a seller for their goods or services. That is between
            you and them, and their refund terms apply, not ours. Sailo is the
            software the shop runs on; we are not the merchant, we take no commission
            on any sale, and the payment never passes through us. Card payments go
            straight into the seller&rsquo;s own Stripe account; bank transfers and
            cash never touch the platform at all.
          </P>
          <P>
            So a refund for an order has to come from the seller. Their contact
            details are on their shop page. Section&nbsp;
            <a href="#orders" className="focus-line underline">
              6
            </a>{" "}
            explains what to do if they will not answer.
          </P>
        </Clause>

        <Clause id="how" n={2} title="How to ask for a subscription refund">
          <P>
            Email <Mail address={LEGAL.refundEmail} /> from the address on the
            account. Requests are read by a person, not a form.
          </P>
          <P>Tell us:</P>
          <List
            ordered
            items={[
              <>The email address on the Sailo account.</>,
              <>
                Which charge you mean — the date and amount, or the invoice number
                from your billing settings.
              </>,
              <>
                What happened. A sentence is enough; you do not need to make a case.
              </>,
            ]}
          />
          <P>
            We acknowledge every request within two business days and decide within
            five. If we need something else from you, we will ask once and clearly.
          </P>
        </Clause>

        <Clause id="circumstances" n={3} title="What we look at">
          <P>
            Requests are considered on their circumstances rather than against a rigid
            rule, because the situations are genuinely different and a blanket policy
            would be unfair in one direction or the other. These are the cases we see,
            and how we handle each.
          </P>
          <P>
            <strong className="font-medium text-[var(--ink)]">
              Refunded in full, as a matter of course:
            </strong>
          </P>
          <List
            items={[
              <>
                You were charged after cancelling, or charged twice for the same
                period.
              </>,
              <>
                A billing error on our side, whatever form it took.
              </>,
              <>
                A prolonged outage or a defect that made the plan&rsquo;s paid
                features unusable for a meaningful part of the period, and we could not
                fix it in reasonable time.
              </>,
              <>
                You upgraded within the last 14 days, have not used the paid features,
                and want to go back.
              </>,
              <>
                A payment you did not authorise, once we have confirmed it with you.
              </>,
              <>
                The law where you live gives you a cancellation right — for example
                the EU and UK distance-selling withdrawal period — and you exercise it
                in time. This policy never overrides a right you already have.
              </>,
            ]}
          />
          <P>
            <strong className="font-medium text-[var(--ink)]">
              Considered case by case, and often granted:
            </strong>
          </P>
          <List
            items={[
              <>
                An annual plan renewed and you had genuinely stopped using Sailo. We
                will usually refund the unused months.
              </>,
              <>
                You subscribed by mistake, or a plan auto-renewed while you were away
                and you tell us soon after.
              </>,
              <>
                Serious personal or business circumstances. Say as much or as little as
                you want; we will not ask for proof.
              </>,
              <>
                The plan did not do what you understood it to do and our own
                description was part of the confusion.
              </>,
            ]}
          />
          <P>
            <strong className="font-medium text-[var(--ink)]">
              Normally declined:
            </strong>
          </P>
          <List
            items={[
              <>
                A period you used the paid features throughout, where the service
                worked as described. Cancel instead and you will not be billed again.
              </>,
              <>
                An account closed for breaching the{" "}
                <Ref href="/terms">Terms of Service</Ref>, in particular for selling
                something the terms prohibit.
              </>,
              <>Repeated refund requests across successive billing periods.</>,
              <>
                Requests about an order placed with a shop, which we have no money to
                return. See section&nbsp;
                <a href="#orders" className="focus-line underline">
                  6
                </a>
                .
              </>,
            ]}
          />
          <P>
            &ldquo;Normally&rdquo; means what it says. If your situation does not fit
            any of the above, ask anyway and explain it. We would rather look at it
            than have you charge it back.
          </P>
        </Clause>

        <Clause id="paid" n={4} title="How the money comes back">
          <P>
            Approved refunds go to the original payment method through Stripe. We
            cannot send one anywhere else, which is a fraud-prevention rule rather
            than a preference.
          </P>
          <List
            items={[
              <>We issue the refund within 5 business days of approving it.</>,
              <>
                Your bank then takes its own time, typically 5 to 10 business days.
                That part is outside anyone&rsquo;s control but your bank&rsquo;s.
              </>,
              <>
                Refunds are made in the original currency. If your card was billed in
                another one, your bank&rsquo;s exchange rate on the day decides what
                lands, and it may differ slightly from what you paid.
              </>,
              <>
                No fee is deducted. You get back what you paid us.
              </>,
            ]}
          />
        </Clause>

        <Clause id="cancel" n={5} title="Cancelling instead">
          <P>
            You can cancel a paid plan at any time in your billing settings. It takes
            effect at the end of the period you have already paid for, you keep the
            paid features until then, and you are not billed again. No refund is
            needed for cancelling, and nothing is deleted: the shop drops to the free
            plan and stays online.
          </P>
        </Clause>

        <Clause id="orders" n={6} title="If a shop will not refund you">
          <P>
            Contact the seller first, through the details on their shop page. Most
            problems are a slow reply rather than a refusal.
          </P>
          <P>
            If they will not engage, or you believe they are breaking our terms, write
            to <Mail address={LEGAL.supportEmail} /> with the shop link, the order
            details and what you have already tried. We will look into it and can act
            against the shop, including suspending it.
          </P>
          <Callout>
            We have to be straight with you about the limit here: we cannot refund a
            payment we never received. The money went to the seller, and only they or
            their payment provider can return it.
          </Callout>
          <P>
            If you paid that seller by card, your own card issuer&rsquo;s dispute
            process is open to you and is usually the fastest route. If you paid by
            bank transfer or in cash, there is no chargeback mechanism, and your
            options are the seller and your local consumer protection body.
          </P>
        </Clause>

        <Clause id="chargebacks" n={7} title="Chargebacks">
          <P>
            If you dispute a Sailo charge with your bank before speaking to us, the
            account is suspended while the dispute runs, because we are required to
            respond to it and cannot keep billing in the meantime.
          </P>
          <P>
            Please email <Mail address={LEGAL.refundEmail} /> first. We have never
            refused to look at a request, it is faster than a chargeback, and it does
            not put your shop offline for a month.
          </P>
        </Clause>

        <Clause id="changes" n={8} title="Changes">
          <P>
            If this policy changes, the effective date at the top changes with it. The
            version in force when you were charged is the one that applies to that
            charge.
          </P>
        </Clause>

        <Clause id="contact" n={9} title="Contact">
          <P>
            Refund requests: <Mail address={LEGAL.refundEmail} />. Anything else about
            an account or a shop: <Mail address={LEGAL.supportEmail} />.
          </P>
          <ContactBlock email={LEGAL.refundEmail} />
        </Clause>
      </div>
    </article>
  );
}
