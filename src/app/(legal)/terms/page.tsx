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
  title: "Terms of Service",
  description:
    "The agreement between Sailo and the people who use it: what the platform does, what sellers are responsible for, and where each side's liability ends.",
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
        using the service you accept them. If you do not, do not use {LEGAL.product}.
      </p>

      <div className="mt-14 space-y-12">
        <Clause id="what" n={1} title="What Sailo is">
          <P>
            {LEGAL.product} gives a seller one public page at{" "}
            <span dir="ltr">{LEGAL.domain}/their-handle</span> where they can list
            what they sell and take orders. Buyers browse that page and order from
            the seller.
          </P>
          <Callout>
            Sailo is the software, not the shop. Every contract of sale is between
            the buyer and the seller. We are not the merchant, the seller&rsquo;s
            agent, or a party to any sale, and we do not take a commission on one.
          </Callout>
          <P>
            That is not a disclaimer of convenience, it describes how the money
            actually moves. Card payments run through the seller&rsquo;s own
            connected Stripe account and land there directly. Bank transfer and cash
            on delivery happen entirely outside the platform. At no point does Sailo
            hold, route or take a cut of a buyer&rsquo;s payment to a seller.
          </P>
        </Clause>

        <Clause id="accounts" n={2} title="Your account">
          <P>
            You must be at least 16 and able to enter a binding contract. Give
            accurate details and keep them current. You are responsible for
            everything done under your account and for keeping your password to
            yourself. Tell us at <Mail address={LEGAL.supportEmail} /> if you think
            someone else has access.
          </P>
          <P>
            One person or business, one account. Do not share credentials, and do not
            open a new account to get around a suspension.
          </P>
        </Clause>

        <Clause id="seller" n={3} title="If you sell on Sailo">
          <P>
            The shop is yours, and so is the responsibility for it. By listing
            anything you confirm that:
          </P>
          <List
            items={[
              <>
                You have the right to sell it, and selling it is lawful where you are
                and where your buyers are.
              </>,
              <>
                Your descriptions, prices, photos and stock levels are accurate, and
                your delivery and returns terms are stated plainly to the buyer before
                they order.
              </>,
              <>
                You will fulfil orders you accept, or refund them promptly if you
                cannot.
              </>,
              <>
                You will handle your buyers&rsquo; personal data lawfully. For that
                data you are the controller and Sailo is your processor; the{" "}
                <Ref href="/privacy">Privacy Policy</Ref> sets out what that means.
              </>,
              <>
                You will register for, collect and remit whatever tax applies to your
                sales. Sailo does not calculate, collect or remit sales tax, VAT or
                GST on your behalf.
              </>,
              <>
                You own or are licensed to use everything you upload, and it does not
                infringe anyone&rsquo;s rights.
              </>,
            ]}
          />
        </Clause>

        <Clause id="prohibited" n={4} title="What may not be sold or done">
          <P>
            Some of this is our choice and some of it is required by the payment
            networks we and our sellers depend on. Either way it is not negotiable.
            You may not use {LEGAL.product} to offer:
          </P>
          <List
            items={[
              <>
                Anything illegal where the buyer or the seller is, including
                controlled substances, drug paraphernalia, and prescription
                medication.
              </>,
              <>Weapons, ammunition, explosives, and their components.</>,
              <>
                Counterfeit goods, pirated media, stolen property, or anything sold in
                breach of someone else&rsquo;s trade mark or copyright.
              </>,
              <>
                Sexually explicit material, escort or adult services, and any content
                involving minors.
              </>,
              <>
                Gambling, lotteries, betting, sweepstakes, and anything that pays out
                on chance.
              </>,
              <>
                Financial instruments, securities, cryptocurrency, virtual currency,
                money transmission and debt-collection services.
              </>,
              <>
                Multi-level marketing, pyramid and matrix schemes, get-rich-quick
                programmes, and any offer whose return depends on recruitment.
              </>,
              <>
                Human remains, live animals, endangered species and products made from
                them.
              </>,
              <>
                Personal data, credentials, licence keys or accounts belonging to
                someone else.
              </>,
              <>
                Content that harasses, defames, or incites violence or hatred against
                any group or person.
              </>,
            ]}
          />
          <P>You also may not:</P>
          <List
            items={[
              <>
                Probe, scrape, overload or attempt to gain unauthorised access to any
                part of the service or another shop&rsquo;s data.
              </>,
              <>
                Impersonate anyone, or set up a shop that misrepresents who is behind
                it.
              </>,
              <>
                Use the platform to launder money, evade sanctions, or process
                payments for a business other than the one on the account.
              </>,
              <>
                Resell or white-label the service itself without a written agreement.
              </>,
            ]}
          />
          <P>
            We may remove content, suspend a shop, or close an account that breaches
            this section. Where the breach is serious or unlawful, we will do so
            without notice.
          </P>
        </Clause>

        <Clause id="plans" n={5} title="Plans, billing and cancellation">
          <P>
            The free plan is free, with the limits shown on the pricing page. Paid
            plans are billed in advance, monthly or yearly, through Stripe, and renew
            automatically until cancelled.
          </P>
          <List
            items={[
              <>
                Prices are in US dollars and exclude any tax that applies where you
                are.
              </>,
              <>
                You can cancel at any time from your billing settings. Cancellation
                takes effect at the end of the period you have already paid for, and
                your shop stays on the paid plan until then.
              </>,
              <>
                If a payment fails we will retry it. If it keeps failing, the account
                falls back to the free plan and anything above the free limits stops
                being available. Nothing is deleted for non-payment.
              </>,
              <>
                We may change prices with at least 30 days&rsquo; notice by email. The
                new price applies from your next renewal, and you can cancel before it
                if you would rather not.
              </>,
            ]}
          />
          <P>
            Refunds of Sailo subscription charges are covered by the{" "}
            <Ref href="/refunds">Refund Policy</Ref>.
          </P>
        </Clause>

        <Clause id="buyers" n={6} title="If you buy from a shop on Sailo">
          <P>
            You are buying from that seller, not from us. Their terms, their delivery
            promises and their returns policy govern the sale. Questions about an
            order, a delivery or a refund go to the seller first, using the contact
            details on their shop page.
          </P>
          <P>
            If a seller will not engage and you believe they are breaking these terms,
            tell us at <Mail address={LEGAL.supportEmail} />. We can act against the
            shop. We cannot refund you for a purchase we never received money for, and
            we have no authority over a payment made by bank transfer or in cash.
          </P>
        </Clause>

        <Clause id="content" n={7} title="Who owns what">
          <P>
            You keep every right you had in what you upload. You grant us a
            non-exclusive, worldwide, royalty-free licence to host, store, resize and
            display it, for the sole purpose of running your shop. That licence ends
            when you delete the content or your account, apart from copies in routine
            backups, which age out.
          </P>
          <P>
            We keep the rights in {LEGAL.product} itself: the software, the name, the
            mark and the design. Nothing here transfers them to you.
          </P>
          <P>
            If you believe something on Sailo infringes your copyright, write to{" "}
            <Mail address={LEGAL.contactEmail} /> identifying the work, the URL, and
            your authority to act. We respond to valid notices and will remove
            infringing material.
          </P>
        </Clause>

        <Clause id="availability" n={8} title="Availability">
          <P>
            We work to keep Sailo running and we do not promise it always will. The
            service is provided as is, without warranty of any kind, express or
            implied, including merchantability, fitness for a particular purpose and
            non-infringement. There is no uptime guarantee on any plan.
          </P>
          <P>
            We may change, suspend or discontinue any part of the service. If we
            discontinue it entirely, we will give at least 30 days&rsquo; notice and a
            way to export your products, orders and customers.
          </P>
        </Clause>

        <Clause id="liability" n={9} title="Limits of liability">
          <P>
            To the fullest extent the law allows, {LEGAL.operator} is not liable for
            indirect, incidental, special, consequential or punitive damages, nor for
            lost profits, lost revenue, lost data or lost goodwill, arising out of your
            use of the service.
          </P>
          <P>
            Total liability for any claim is limited to the greater of the amount you
            paid us in the twelve months before the claim, or one hundred US dollars.
          </P>
          <P>
            We are not liable for a dispute between a buyer and a seller, for goods or
            services a seller does or does not deliver, or for a seller&rsquo;s
            compliance with the law. Some jurisdictions do not allow these exclusions,
            and where that is so they do not apply to you.
          </P>
        </Clause>

        <Clause id="indemnity" n={10} title="Indemnity">
          <P>
            If you sell on Sailo, you agree to indemnify {LEGAL.operator} against
            claims, losses and reasonable legal costs arising from what you sold, what
            you published, your breach of these terms, or your breach of the law. We
            will tell you promptly about any such claim and will not settle it without
            asking you.
          </P>
        </Clause>

        <Clause id="termination" n={11} title="Ending the agreement">
          <P>
            You can close your account at any time from your settings. We may suspend
            or close an account that breaches these terms, that exposes us or our
            providers to legal or payment-network risk, or that has been dormant for
            more than 24 months on the free plan.
          </P>
          <P>
            On closure your shop stops being reachable and your data is deleted on the
            schedule in the <Ref href="/privacy">Privacy Policy</Ref>. Export your
            data first if you want to keep it.
          </P>
        </Clause>

        <Clause id="law" n={12} title="Governing law and disputes">
          <P>
            These terms are governed by the laws of {LEGAL.governingLaw}, without
            regard to conflict-of-laws rules. Any dispute goes to the state or federal
            courts located in {LEGAL.venue}, and both sides consent to that
            jurisdiction.
          </P>
          <P>
            Nothing here takes away a mandatory consumer right you have where you
            live, including the right to bring a claim in your local courts if the law
            gives you one.
          </P>
          <P>
            Please write to us before filing anything. Most things are faster to fix
            than to litigate.
          </P>
        </Clause>

        <Clause id="misc" n={13} title="The rest">
          <P>
            If a clause is unenforceable, the rest stands. Not enforcing a term once
            does not waive it. You may not assign this agreement without our consent;
            we may assign it if the business is transferred. These terms, with the
            Privacy Policy and the Refund Policy, are the entire agreement between us.
          </P>
          <P>
            We may update these terms. The effective date changes when we do, and
            material changes are emailed to account holders at least 30 days before
            they take effect.
          </P>
        </Clause>

        <Clause id="contact" n={14} title="Contact">
          <P>Notices under these terms go to:</P>
          <ContactBlock email={LEGAL.contactEmail} />
        </Clause>
      </div>
    </article>
  );
}
