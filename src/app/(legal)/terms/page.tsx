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
import { PLATFORM_FEE_LABEL } from "@/lib/plans";

export const metadata: Metadata = {
  title: "Terms of Service",
  description:
    "The agreement between Sailo and the people who use it: what the platform does, what sellers are responsible for, how card payments and fees work, and where each side's liability ends.",
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  return (
    <article>
      <h1 className="display text-[clamp(2.25rem,5vw,3rem)] text-[var(--ink)]">
        Terms of Service
      </h1>
      <p className="mt-4 text-[0.8125rem] text-[var(--mute-400)]">
        Effective {LEGAL.effective}
      </p>
      <p className="mt-8 text-[1.0625rem] leading-[1.7] text-[var(--mute-600)]">
        These terms are the agreement between you and {LEGAL.operator},{" "}
        {LEGAL.operatorForm} trading as {LEGAL.product}. By opening an account or
        using the service you accept them. If you do not, do not use{" "}
        {LEGAL.product}.
      </p>

      <div className="mt-14 space-y-12">
        <Clause id="summary" n={1} title="What this says, in short">
          <Callout>
            {LEGAL.product} is software you run your shop on. It is not a shop, a
            marketplace, a bank or a payment processor. Buyers buy from you, not
            from us.
          </Callout>
          <List
            items={[
              <>
                <strong>Your shop is yours.</strong> What you sell, who you sell
                it to, and what you promise them is your decision and your
                responsibility.
              </>,
              <>
                <strong>Money does not pass through us.</strong> Card payments
                are created on your own Stripe account. Chat, bank-transfer and
                cash orders never touch a payment system of ours at all.
              </>,
              <>
                <strong>Our fee is {PLATFORM_FEE_LABEL} of the goods on card
                sales.</strong> Nothing on chat, bank-transfer or cash orders,
                and never on delivery or tax.
              </>,
              <>
                <strong>You carry the chargebacks.</strong> You are the merchant
                of record on card sales, so a disputed payment is debited from
                your account, not ours.
              </>,
              <>
                <strong>Fraud ends the account.</strong> Immediately, and without
                notice where we reasonably believe it is happening.
              </>,
            ]}
          />
          <P>
            This summary is here to be read. It is not a substitute for the
            clauses below, and where the two differ, the clauses govern.
          </P>
        </Clause>

        <Clause id="what" n={2} title="What Sailo is, and what it is not">
          <P>
            {LEGAL.product} gives you a page at{" "}
            {LEGAL.domain}/your-handle, a catalogue behind it, and the tools to
            take orders through chat apps, bank transfer, cash on delivery, or a
            card checkout run on your own Stripe account.
          </P>
          <P>
            We are the software, not the counterparty. We do not stock, ship,
            inspect, insure or guarantee anything sold through a shop, we are not
            party to the contract between a seller and a buyer, and we do not act
            as agent for either of them. We are not a bank, a money transmitter,
            an escrow service or a payment institution, and we do not hold client
            money.
          </P>
          <P>
            You need to be old enough to enter a contract where you live, and at
            least 16. The service is not offered to anyone barred from it under
            the sanctions or export laws that apply to us.
          </P>
        </Clause>

        <Clause id="accounts" n={3} title="Your account">
          <P>
            One account, one shop, real details. You are responsible for
            everything done under your login, so keep the password to yourself
            and tell us at <Mail address={LEGAL.supportEmail} /> the moment you
            think someone else has it.
          </P>
          <List
            items={[
              <>
                Give accurate registration details and keep them current. We may
                suspend an account whose details we cannot verify.
              </>,
              <>
                Do not share, sell or transfer your account. Handles are lent,
                not owned: we may reclaim one that impersonates someone, infringes
                a mark, or sits unused on a free plan for twelve months.
              </>,
              <>
                Do not use the service to build a competing product, scrape it,
                probe it, or work around its limits.
              </>,
            ]}
          />
        </Clause>

        <Clause id="seller" n={4} title="If you sell on Sailo">
          <P>
            The shop is yours, and so is the responsibility for it. By listing
            anything you confirm that:
          </P>
          <List
            items={[
              <>
                You have the right to sell it, and selling it is lawful where you
                are and where your buyers are.
              </>,
              <>
                Your descriptions, prices, photos and stock levels are accurate,
                and your delivery and returns terms are stated plainly to the
                buyer before they order.
              </>,
              <>
                You will fulfil orders you accept, or refund them promptly if you
                cannot.
              </>,
              <>
                You will handle your buyers&rsquo; personal data lawfully. For
                that data you are the controller and {LEGAL.product} is your
                processor; the <Ref href="/privacy">Privacy Policy</Ref> sets out
                what that means.
              </>,
              <>
                You will register for, collect and remit whatever tax applies to
                your sales. {LEGAL.product} does not calculate, collect or remit
                sales tax, VAT or GST on your behalf, and the tax fields in the
                product are a calculator you configure, not advice.
              </>,
              <>
                You own or are licensed to use everything you upload, and it does
                not infringe anyone&rsquo;s rights.
              </>,
              <>
                You hold every licence, permit and authorisation your trade
                needs — before you list, not after a complaint — and you keep
                them current for as long as you sell. Food, alcohol, cosmetics,
                supplements, electronics and regulated services all carry them,
                and none of them is our licence to hold.
              </>,
              <>
                Any message you send through {LEGAL.product} to your buyers
                complies with the anti-spam law that applies to them — CAN-SPAM
                in the United States, CASL in Canada, the ePrivacy rules in the
                EU and UK. You send to people who agreed to hear from you, you
                identify yourself, and you honour an unsubscribe. Our email
                reputation is shared across every seller here, so this one is
                not a formality.
              </>,
              <>
                You do not create fake, duplicated, automated or impersonating
                accounts, shops or referral links, and you do not manufacture
                referral activity that did not happen. Promoting your own shop
                is the point; inventing traffic to earn commission on it is
                fraud, and clause 7 applies.
              </>,
              <>
                Where the law gives your buyers rights — a distance-selling
                withdrawal period, a statutory guarantee, a right to a written
                receipt — you will honour them. Nothing you write in your own
                shop terms can take those away, and nothing in these terms
                purports to.
              </>,
            ]}
          />
        </Clause>

        <Clause id="cards" n={5} title="Card payments, fees and chargebacks">
          <P>
            Card payments run on Stripe Connect. When you switch them on, a
            Stripe Express connected account is created in your name and you
            enter into Stripe&rsquo;s own{" "}
            <Ref href="https://stripe.com/legal/connect-account">
              Connected Account Agreement
            </Ref>{" "}
            directly with Stripe. That agreement governs the payment itself.
            These terms govern your use of {LEGAL.product}. Where the two speak
            to the same thing, Stripe&rsquo;s agreement governs the money.
          </P>
          <P>
            Charges are created on your connected account, not on ours. You are
            the merchant of record for every card sale: the funds settle into
            your own Stripe balance, {LEGAL.product} never holds them, and we can
            neither pay them out to you nor withhold them from you.
          </P>

          <Callout>
            Because you are the merchant of record, the chargeback is yours. If a
            buyer disputes a card payment, Stripe debits your connected account
            for the disputed amount and for its dispute fee — whether or not you
            contest it, and whether or not you have already shipped.
          </Callout>

          <List
            items={[
              <>
                <strong>Our fee.</strong> {LEGAL.product} takes{" "}
                {PLATFORM_FEE_LABEL} of the goods on each card sale, collected as
                a Stripe application fee at the moment of the charge. It is
                calculated on the price of the goods after any discount, and
                never on delivery or tax: money you hand to a courier, or collect
                for a government, was never yours and is not something we charge
                on. Chat, bank-transfer and cash orders carry no fee at all.
              </>,
              <>
                <strong>Stripe&rsquo;s fees are separate.</strong> Stripe sets its
                own processing fees, deducts them from your account, and they are
                not received by {LEGAL.product}. We neither set them nor control
                them, and we do not quote them here because they depend on your
                country and the card used. Stripe states them to you.
              </>,
              <>
                <strong>Refunds.</strong> When you refund a card order, our fee on
                it is refunded with it, in proportion to the amount returned. You
                are never left paying our share of a sale that was undone.
              </>,
              <>
                <strong>If your account cannot cover a dispute.</strong> A
                chargeback, refund or reversal can leave your Stripe balance
                negative. Recovering that is between you and Stripe under your
                agreement with them — Stripe may take it from later sales or
                debit your bank account, depending on your country and settings.
                To the extent {LEGAL.product} is charged for any shortfall on your
                account, you owe us that amount, and we may set it off against
                anything we hold for you, invoice you for it, or both.
              </>,
              <>
                <strong>Excessive disputes.</strong> The card networks monitor
                dispute rates, and a shop above their thresholds puts its own and
                our access at risk. We may stop card payments on a shop whose
                disputes reach that level, and will tell you when we do.
              </>,
              <>
                <strong>Changes.</strong> We may change our fee on 30 days&rsquo;
                notice by email. A change applies to sales made after it takes
                effect and never to sales already completed. If you do not accept
                it, stop taking card payments or close the account before it
                starts.
              </>,
            ]}
          />
        </Clause>

        <Clause id="prohibited" n={6} title="What may not be sold or done">
          <P>
            Some of this is our choice and some of it is required by the payment
            networks we and our sellers depend on. Either way it is not
            negotiable, and a shop that breaks it can be suspended without
            notice.
          </P>
          <List
            items={[
              <>
                Anything illegal where you are or where your buyer is, and
                anything you are not licensed to sell.
              </>,
              <>
                Weapons, ammunition, explosives, controlled drugs, drug
                paraphernalia, prescription medicines and tobacco or vaping
                products.
              </>,
              <>
                Counterfeits, replicas, and anything infringing a trademark,
                copyright or design right.
              </>,
              <>
                Sexual services, sexual content involving minors or non-consenting
                adults, and content that sexualises anyone under 18.
              </>,
              <>
                Stolen goods, hacked accounts, credentials, personal data sold as
                a product, and services designed to defraud.
              </>,
              <>
                Financial products, investments, lending, gambling, lotteries,
                cryptocurrency exchange, and anything requiring a licence we have
                not seen.
              </>,
              <>
                Human parts, live animals, endangered species and products made
                from them.
              </>,
              <>
                Multi-level marketing, pyramid schemes, get-rich-quick offers, and
                unsolicited bulk messaging of any kind.
              </>,
              <>
                Using a shop to process payments for a business other than the one
                the account describes — the practice card networks call
                transaction laundering, and the single fastest way to lose the
                account.
              </>,
            ]}
          />
        </Clause>

        <Clause id="fraud" n={7} title="Fraud, risk and enforcement">
          <P>
            Card acceptance is a shared privilege. One shop laundering payments or
            running stolen cards puts every other seller on the platform at risk,
            so this clause is deliberately blunt.
          </P>
          <P>
            Where we reasonably believe an account is being used for fraud, for
            money laundering, to process payments for an undisclosed business, or
            in a way that threatens our own or our sellers&rsquo; access to the
            card networks, we may — immediately and without prior notice — suspend
            the shop, stop its card payments, withhold or reverse our own fee,
            reject or close the connected account with Stripe, and terminate the
            agreement.
          </P>
          <Callout>
            We act on reasonable belief rather than proof. Waiting for certainty
            while a scheme runs is not a risk we are willing to carry on behalf of
            every other seller here.
          </Callout>
          <P>
            Where the law allows us to say why, we will. Where a suspension turns
            out to be wrong, we will restore the account. Nothing in this clause
            gives us a right to your money: any funds in your Stripe balance
            remain governed by your agreement with Stripe, and are not ours to
            take. We may report suspected criminal conduct to the police, to
            Stripe, and to anyone else the law requires.
          </P>
        </Clause>

        <Clause id="plans" n={8} title="Plans, billing and cancellation">
          <P>
            Free is free and stays free. Paid plans are billed in advance, monthly
            or yearly, through Stripe, and renew automatically until cancelled.
          </P>
          <List
            items={[
              <>
                Cancel any time from your billing settings. Cancellation takes
                effect at the end of the period you have already paid for; we do
                not cut a plan short on the day you cancel.
              </>,
              <>
                Prices may change on 30 days&rsquo; notice by email, effective at
                your next renewal. Carrying on past that date is acceptance;
                cancelling before it is the alternative.
              </>,
              <>
                A failed renewal does not take your shop down on the first
                attempt. Stripe retries for several days, and paid features stay
                on while it does. If it never succeeds the account returns to the
                free plan.
              </>,
              <>
                Downgrading never deletes anything you have made. Products over
                the free limit stop being visible until you are under it again;
                they are not erased.
              </>,
              <>
                Query a charge within 60 days of it appearing. After that we may
                not be able to reconstruct what happened well enough to put it
                right, and Stripe&rsquo;s own records age out too.
              </>,
              <>
                Refunds of subscription payments are governed by the{" "}
                <Ref href="/refunds">Refund Policy</Ref>, which forms part of these
                terms.
              </>,
            ]}
          />
        </Clause>

        <Clause id="buyers" n={9} title="If you buy from a shop on Sailo">
          <P>
            Your contract is with the seller. They take your money, they owe you
            the goods, and their refund and delivery terms apply — not ours.
          </P>
          <P>
            {LEGAL.product} is not the merchant, does not hold your payment, and
            cannot refund it. If a seller will not resolve something, the{" "}
            <Ref href="/refunds">Refund Policy</Ref> explains the routes that are
            actually open to you, including your card issuer&rsquo;s dispute
            process. Tell us at <Mail address={LEGAL.supportEmail} /> anyway: we
            cannot return your money, but we can act on the shop, and a pattern of
            complaints is how we find the shops that should not be here.
          </P>
        </Clause>

        <Clause id="content" n={10} title="Who owns what">
          <P>
            You keep everything you upload. You grant us a non-exclusive,
            worldwide, royalty-free licence to host, store, resize, cache and
            display it — the operations required to run your shop and nothing
            else. It ends when you delete the content or close the account, except
            for copies in backups until they age out.
          </P>
          <P>
            We keep the software, the brand and the design. Nothing here gives you
            a right to use the {LEGAL.product} name or mark beyond the badge we
            place on free shops, which you may not remove, alter or obscure while
            you are on a free plan.
          </P>
          <P>
            If you believe something on a shop infringes your rights, write to{" "}
            <Mail address={LEGAL.contactEmail} /> with the URL, what it infringes,
            and enough for us to act. We remove infringing material and terminate
            repeat infringers.
          </P>
        </Clause>

        <Clause id="availability" n={11} title="Availability">
          <P>
            We aim to keep {LEGAL.product} running and we work at it, but the
            service is provided as it is. We do not promise it will be
            uninterrupted, error-free, or that it will keep working with every
            third party it currently works with.
          </P>
          <P>
            We may change, add or remove features. Where a change materially
            reduces what a paid plan does, we will give notice and you may cancel
            and have the unused part of the period back. Planned maintenance is
            announced where we can; emergency maintenance sometimes cannot be.
          </P>
        </Clause>

        <Clause id="liability" n={12} title="Limits of liability">
          <P>
            Nothing in these terms limits liability for death or personal injury
            caused by negligence, for fraud or fraudulent misrepresentation, or
            for anything else that cannot lawfully be limited. If you are a
            consumer, your statutory rights are unaffected by anything below.
          </P>
          <P>
            Subject to that: to the fullest extent the law allows,{" "}
            {LEGAL.operator} is not liable for lost profits, lost sales, lost
            data, loss of goodwill, or any indirect or consequential loss; and our
            total liability to you for all claims in any twelve-month period is
            limited to the greater of the fees you paid us in that period, or 100
            USD.
          </P>
          <P>
            We are not liable for what a seller does or fails to do, for what a
            buyer does, for the acts of Stripe or any other provider named in the{" "}
            <Ref href="/privacy">Privacy Policy</Ref>, or for a chargeback,
            refund or reversal on a sale we were never party to.
          </P>
        </Clause>

        <Clause id="indemnity" n={13} title="Indemnity">
          <P>
            If you sell on {LEGAL.product}, you agree to indemnify{" "}
            {LEGAL.operator} against claims, losses, fines and reasonable legal
            costs arising from what you sold, what you said about it, how you
            handled your buyers&rsquo; data, tax you did not remit, or any breach
            of these terms. We will tell you promptly about any claim, let you
            take the defence where you are entitled to, and not settle it without
            asking you.
          </P>
        </Clause>

        <Clause id="termination" n={14} title="Ending the agreement">
          <P>
            You may close your account at any time from your settings, for any
            reason or none.
          </P>
          <P>
            We may end it on 30 days&rsquo; notice for any reason, and immediately
            where you breach these terms, where clause 7 applies, where the law
            requires it, or where a payment provider we depend on refuses to keep
            serving your account.
          </P>
          <P>
            When an account ends, the shop goes offline and your data is deleted
            on the schedule in the <Ref href="/privacy">Privacy Policy</Ref>.
            Export what you want first — the CSV export in your settings takes
            everything, and it is free on every plan for exactly this reason.
            Clauses that are meant to outlive the agreement — fees owed, liability,
            indemnity, governing law — survive it.
          </P>
        </Clause>

        <Clause id="law" n={15} title="Governing law and disputes">
          <P>
            These terms are governed by the laws of {LEGAL.governingLaw}, and the
            courts of {LEGAL.venue} have exclusive jurisdiction — except that if
            you are a consumer resident elsewhere, you keep the protection of the
            mandatory laws of your own country and may bring proceedings there.
          </P>
          <P>
            Before filing anything, email <Mail address={LEGAL.contactEmail} />{" "}
            and give us 30 days. Most of what reaches a lawyer would have been
            settled by a reply.
          </P>
        </Clause>

        <Clause id="misc" n={16} title="The rest">
          <List
            items={[
              <>
                <strong>Changes.</strong> We may update these terms. Material
                changes are emailed to account holders at least 30 days before
                they take effect, and the date at the top always says which
                version you are reading. Continuing to use {LEGAL.product} after
                that date is acceptance.
              </>,
              <>
                <strong>Whole agreement.</strong> These terms, the{" "}
                <Ref href="/privacy">Privacy Policy</Ref> and the{" "}
                <Ref href="/refunds">Refund Policy</Ref> are the entire agreement
                between us and replace anything said before.
              </>,
              <>
                <strong>Severability.</strong> If a clause is unenforceable, it is
                cut back to what is enforceable and the rest stands.
              </>,
              <>
                <strong>No waiver.</strong> Not enforcing something once does not
                give it up.
              </>,
              <>
                <strong>Assignment.</strong> You may not transfer this agreement.
                We may, on notice, to a successor of the business.
              </>,
              <>
                <strong>Language.</strong> These terms are written in{" "}
                {LEGAL.language}. A translation is a convenience; the{" "}
                {LEGAL.language} version governs.
              </>,
              <>
                <strong>Force majeure.</strong> Neither side is liable for a
                failure caused by something genuinely outside its control.
              </>,
            ]}
          />
        </Clause>

        <Clause id="contact" n={17} title="Contact">
          <P>
            {LEGAL.operator}, {LEGAL.operatorForm}, trading as {LEGAL.product}.
          </P>
          <ContactBlock email={LEGAL.contactEmail} />
        </Clause>
      </div>
    </article>
  );
}
