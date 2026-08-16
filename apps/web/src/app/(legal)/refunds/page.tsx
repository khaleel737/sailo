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
import { PLATFORM_FEE_RANGE_LABEL } from "@sailo/core/plans";

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
            software the shop runs on; we are not the merchant and the payment
            never passes through us. Card payments go straight into the
            seller&rsquo;s own Stripe account; bank transfers and cash never touch
            the platform at all. We do take {PLATFORM_FEE_RANGE_LABEL} of the goods on
            a card sale as a fee from the seller — it comes out of their side of
            the sale, never out of what you paid, and it is refunded with the
            order if they refund you.
          </P>
          <P>
            So a refund for an order has to come from the seller. Their contact
            details are on their shop page. Section&nbsp;
            <a href="#orders" className="focus-line underline">
              7
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
                  7
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

        <Clause id="statutory" n={6} title="Rights this policy cannot take away">
          <P>
            Everything above is what we do voluntarily. None of it replaces a
            right the law already gives you, and where the two differ the law
            wins.
          </P>
          <List
            items={[
              <>
                <strong>In the EU and the UK</strong>, a consumer buying a service
                at a distance normally has 14 days to withdraw. Ask inside that
                window and we refund, whatever the rest of this policy says. The
                one exception is where you asked us to start immediately and the
                service was fully performed — and even then we will look at it.
              </>,
              <>
                <strong>Wherever you live</strong>, a local consumer protection
                law that gives you more than this policy does applies instead of
                it, and we will not ask you to waive it.
              </>,
              <>
                <strong>An order from a shop</strong> carries the buyer rights of
                the seller&rsquo;s country, not ours. The{" "}
                <Ref href="/terms">Terms</Ref> require every seller to honour
                them, and a seller who refuses is breaking their agreement with
                us — tell us and we will act on the shop even though we cannot
                refund you.
              </>,
            ]}
          />
          <Callout>
            Nothing in this policy is a condition of getting your money back. You
            never have to accept a credit instead of a refund, waive a right, or
            agree to anything in writing to be refunded something you are owed.
          </Callout>
        </Clause>

        <Clause id="orders" n={7} title="If a shop will not refund you">
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
            We have to be straight with you about the limit here: we cannot
            refund a payment we never received. A card payment to a shop is
            created on that seller&rsquo;s own Stripe account, settles into their
            balance, and is theirs to return. {LEGAL.product} never holds it and
            cannot send it back for them.
          </Callout>
          <P>
            The one part that is ours is our fee. {LEGAL.product} takes{" "}
            {PLATFORM_FEE_RANGE_LABEL} of the goods on a card sale, and when a seller
            refunds an order that fee is refunded with it, in proportion to the
            amount returned. You are never left paying our share of a sale that
            was undone.
          </P>
          <P>
            If you paid that seller by card, your own card issuer&rsquo;s dispute
            process is open to you and is usually the fastest route. If you paid by
            bank transfer or in cash, there is no chargeback mechanism, and your
            options are the seller and your local consumer protection body.
          </P>
        </Clause>

        <Clause id="chargebacks" n={8} title="Chargebacks">
          <P>
            <strong>A charge from a shop.</strong> The seller is the merchant of
            record, so the dispute is theirs. Stripe debits their account for the
            amount and for its dispute fee, whether or not they contest it and
            whether or not they have already shipped. {LEGAL.product} is not a
            party to it and cannot decide it either way. If a seller&rsquo;s
            disputes run high enough to threaten their card acceptance or ours,
            we may stop card payments on that shop — the{" "}
            <Ref href="/terms">Terms</Ref> set out when.
          </P>
          <P>
            <strong>A charge from {LEGAL.product}.</strong> If you dispute one of
            our own subscription charges with your bank before speaking to us,
            the account is suspended while the dispute runs, because we are
            required to respond to it and cannot keep billing in the meantime.
          </P>
          <P>
            Please email <Mail address={LEGAL.refundEmail} /> first. We have never
            refused to look at a request, it is faster than a chargeback, and it does
            not put your shop offline for a month.
          </P>
        </Clause>

        <Clause id="changes" n={9} title="Changes">
          <P>
            If this policy changes, the effective date at the top changes with it. The
            version in force when you were charged is the one that applies to that
            charge.
          </P>
        </Clause>

        <Clause id="contact" n={10} title="Contact">
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
