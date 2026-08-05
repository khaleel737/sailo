import type { Metadata } from "next";
import {
  Callout,
  Clause,
  ContactBlock,
  DataTable,
  List,
  Mail,
  P,
  Ref,
} from "@/components/legal/legal-kit";
import { COOKIES, LEGAL, SUBPROCESSORS } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "What Sailo collects, why, who processes it, how long it is kept, and how to get a copy of it or have it deleted.",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  return (
    <article>
      <h1 className="display text-[clamp(2.25rem,5vw,3rem)] text-[var(--ink)]">
        Privacy Policy
      </h1>
      <p className="mt-4 text-[0.8125rem] text-[var(--mute-400)]">
        Effective {LEGAL.effective}
      </p>
      <p className="mt-8 text-[1.0625rem] leading-[1.7] text-[var(--mute-600)]">
        {LEGAL.product} is operated by {LEGAL.operator}, {LEGAL.operatorForm} based in{" "}
        {LEGAL.city}, {LEGAL.state}. This policy explains what the service collects,
        why it needs it, and what you can ask us to do about it. It describes the
        software as it is actually built, not a template.
      </p>

      <div className="mt-14 space-y-12">
        <Clause id="short" n={1} title="The short version">
          <List
            items={[
              <>
                We do not sell your personal information, and we never have. We do
                not rent it, trade it, or hand it to advertisers or data brokers.
              </>,
              <>
                We do not use your data to build advertising profiles, and there are
                no third-party advertising or analytics trackers on any Sailo page.
              </>,
              <>
                We do not store visitors&rsquo; IP addresses. Nothing on a storefront
                follows anyone across the web.
              </>,
              <>
                We never see card numbers. Payments run through Stripe&rsquo;s own
                pages and Stripe&rsquo;s own systems.
              </>,
              <>
                A small number of vendors run parts of the service and process data
                strictly on our instructions. They are all named in{" "}
                <a href="#subprocessors" className="focus-line underline">
                  section 6
                </a>
                .
              </>,
            ]}
          />
        </Clause>

        <Clause id="roles" n={2} title="Who is responsible for what">
          <P>
            Sailo is a platform. Sellers use it to run their own shops, and buyers
            order from those shops. That split matters for privacy, because it
            decides who answers your request.
          </P>
          <P>
            <strong className="font-medium text-[var(--ink)]">
              For seller accounts,
            </strong>{" "}
            Sailo is the controller. We decide what an account needs in order to
            exist, and we answer directly for it.
          </P>
          <P>
            <strong className="font-medium text-[var(--ink)]">
              For buyer and order data,
            </strong>{" "}
            the seller is the controller and Sailo is their processor. When you buy
            from a shop, you are giving your details to that shop; we hold them on
            the shop&rsquo;s behalf so it can fulfil the order. If you want a shop to
            delete your details, ask the shop. If they do not respond, write to us at{" "}
            <Mail address={LEGAL.privacyEmail} /> and we will help.
          </P>
        </Clause>

        <Clause id="collect" n={3} title="What we collect">
          <P>
            <strong className="font-medium text-[var(--ink)]">
              If you open a Sailo account.
            </strong>{" "}
            Your name, your email address, and a password. Passwords are stored only
            as a salted hash; we cannot read yours, and neither can anyone who
            obtains the database. We also keep sign-in session records, which include
            the IP address and browser the session was created from, so you can see
            and end sessions you do not recognise.
          </P>
          <P>
            <strong className="font-medium text-[var(--ink)]">
              What you put in your shop.
            </strong>{" "}
            Your shop name, description, location, contact details, social links,
            currency, product catalogue and images. If you enable bank transfer or
            cash on delivery, the payout instructions you write are stored so buyers
            can read them at checkout. Anything you put in your shop is published to
            anyone who opens its link, which is the point of it.
          </P>
          <P>
            <strong className="font-medium text-[var(--ink)]">
              If you place an order with a shop.
            </strong>{" "}
            Your name, and whichever of email or phone you provide. If the order is
            being delivered, the delivery address. Any note you add, the items
            ordered, the total, and the payment method and status. If you leave a
            review, the name you sign it with and what you wrote.
          </P>
          <P>
            <strong className="font-medium text-[var(--ink)]">
              If you simply visit a shop.
            </strong>{" "}
            One page-view record, so the shop&rsquo;s owner can see whether anyone is
            reading their link. It contains a random identifier from a first-party
            cookie, the page that referred you, any campaign tags in the link, an
            approximate country, region and city resolved at our host&rsquo;s network
            edge, and your device type, operating system and browser family.
          </P>
          <Callout>
            We do not store your IP address with that record. Your address is used
            for a few milliseconds to rate-limit abusive traffic and is then
            discarded. Location is approximate and derived at the network edge, not
            from GPS, and it is never precise enough to identify a household.
          </Callout>
        </Clause>

        <Clause id="why" n={4} title="Why we are allowed to hold it">
          <P>
            If the GDPR or UK GDPR applies to you, these are our lawful bases. If it
            does not, this section still tells you honestly why we hold each thing.
          </P>
          <List
            items={[
              <>
                <strong className="font-medium text-[var(--ink)]">Contract.</strong>{" "}
                Account details, shop content and order details. Without them there is
                no service to provide.
              </>,
              <>
                <strong className="font-medium text-[var(--ink)]">
                  Legitimate interests.
                </strong>{" "}
                Page-view counts, rate limiting and abuse prevention. Sellers need to
                know whether their link works, and the service needs to stay standing.
                We have kept this to the minimum that achieves it, which is why no IP
                address is stored.
              </>,
              <>
                <strong className="font-medium text-[var(--ink)]">
                  Legal obligation.
                </strong>{" "}
                Invoices and payment records, which tax law requires us and sellers to
                retain.
              </>,
              <>
                <strong className="font-medium text-[var(--ink)]">Consent.</strong>{" "}
                Anything you volunteer that the service did not ask for, and any
                marketing email you opt into. You can withdraw it at any time.
              </>,
            ]}
          />
        </Clause>

        <Clause id="payments" n={5} title="Payments, and why we never see your card">
          <P>
            Card details are entered on Stripe&rsquo;s own hosted pages and are
            transmitted to Stripe. They do not pass through Sailo&rsquo;s servers and
            are never stored by us. We hold a Stripe customer reference and the last
            status Stripe reported, and nothing more.
          </P>
          <P>
            When a seller accepts card payments, they do so through their own Stripe
            account connected to the platform. The money moves from the buyer to that
            seller&rsquo;s account. Sailo does not hold seller funds at any point and
            takes no commission on any sale.
          </P>
          <P>
            Stripe processes payment data as an independent controller under its own
            privacy policy. If a seller offers bank transfer or cash on delivery, the
            payment happens entirely outside Sailo; we record only that the seller
            marked it settled, and any reference the buyer typed in.
          </P>
        </Clause>

        <Clause id="subprocessors" n={6} title="Who else processes data, and why">
          <P>
            This is the complete list. Every party below runs part of the service and
            may use what it processes only to deliver that service back to us. None
            of them is permitted to use it for their own purposes, and none of them is
            an advertising network.
          </P>
          <DataTable
            caption="Sub-processors"
            columns={["Provider", "What they do", "What they see", "Where"]}
            rows={SUBPROCESSORS.map((s) => [s.name, s.purpose, s.data, s.region])}
          />
          <P>
            We will update this list before adding a new provider. Material changes
            are announced by email to account holders.
          </P>
        </Clause>

        <Clause id="cookies" n={7} title="Cookies">
          <P>
            Three, all first-party. There are no advertising cookies, no cross-site
            trackers, and no third-party tag managers anywhere on Sailo.
          </P>
          <DataTable
            caption="Cookies"
            columns={["Cookie", "What it does", "How long", "Type"]}
            rows={COOKIES.map((c) => [c.name, c.purpose, c.life, c.kind])}
          />
          <P>
            You can clear or block all of them in your browser. Blocking the session
            cookie means you cannot stay signed in; blocking the other two costs you
            nothing but a language preference.
          </P>
        </Clause>

        <Clause id="retention" n={8} title="How long we keep things">
          <List
            items={[
              <>
                <strong className="font-medium text-[var(--ink)]">
                  Account and shop data
                </strong>{" "}
                for as long as the account exists, then deleted within 30 days of a
                deletion request.
              </>,
              <>
                <strong className="font-medium text-[var(--ink)]">
                  Orders and invoices
                </strong>{" "}
                for seven years, because tax and accounting rules require it. This
                survives account deletion, and it is the one category we cannot erase
                on request.
              </>,
              <>
                <strong className="font-medium text-[var(--ink)]">
                  Page-view records
                </strong>{" "}
                for as long as the shop&rsquo;s plan can display them, up to three
                years, then removed.
              </>,
              <>
                <strong className="font-medium text-[var(--ink)]">
                  Rate-limit counters
                </strong>{" "}
                for seconds to minutes. They expire on their own.
              </>,
            ]}
          />
          <P>
            Deleting an account deletes its shop, catalogue, images, reviews and
            analytics. Buyer records attached to completed orders are retained under
            the rule above and are unlinked from the account.
          </P>
        </Clause>

        <Clause id="rights" n={9} title="Your rights, and how to use them">
          <P>
            Wherever you live, you can ask us for a copy of what we hold about you,
            ask us to correct it, ask us to delete it, or object to how we use it.
            Write to <Mail address={LEGAL.privacyEmail} />. We answer within 30 days
            and we do not charge for it.
          </P>
          <P>
            <strong className="font-medium text-[var(--ink)]">
              If you are in California
            </strong>{" "}
            (CCPA, as amended by the CPRA), you may request the categories and
            specific pieces of personal information we have collected, the sources,
            the purpose, and the categories of third parties it was disclosed to; you
            may request deletion and correction; and you may not be discriminated
            against for asking. You may also opt out of the sale or sharing of
            personal information and limit the use of sensitive personal information.
            We have nothing for you to opt out of: we do not sell or share personal
            information as those terms are defined, and we do not collect sensitive
            personal information. In the twelve months before this policy&rsquo;s
            effective date, we sold or shared none.
          </P>
          <P>
            <strong className="font-medium text-[var(--ink)]">
              If you are in the EU, the EEA, the UK or Switzerland
            </strong>{" "}
            (GDPR and UK GDPR), you additionally have the right to data portability,
            the right to restrict processing, and the right to lodge a complaint with
            your supervisory authority. Data is processed in the United States;
            transfers rely on our providers&rsquo; Standard Contractual Clauses and
            equivalent safeguards.
          </P>
          <P>
            An authorised agent may act for you if you say so in writing. We may need
            to verify your identity before acting, which usually means proving control
            of the email address on the record.
          </P>
        </Clause>

        <Clause id="security" n={10} title="How the data is kept">
          <P>
            The database is private and reachable only by the application, over TLS,
            with credentials held as encrypted environment secrets. It is not exposed
            to the public internet and is not browsable by anyone outside the
            operator. All traffic to and from the service is encrypted in transit, and
            provider storage is encrypted at rest.
          </P>
          <List
            items={[
              <>
                Passwords are salted and hashed. Nobody, including the operator, can
                read them.
              </>,
              <>
                Card details never reach our servers. That risk sits with Stripe,
                which is PCI DSS Level 1 certified.
              </>,
              <>
                Access to production data is limited to the operator, and the internal
                staff panel is restricted to an explicit list of email addresses
                checked on every request.
              </>,
              <>
                Download links for digital goods are unguessable, expiring and
                limited by use count.
              </>,
              <>Scheduled jobs authenticate with a secret compared in constant time.</>,
              <>
                Write endpoints are rate limited, and the limiter stores a counter,
                never a request body.
              </>,
            ]}
          />
          <P>
            No system is perfect, and we will not claim otherwise. If a breach affects
            you, we will tell you and the relevant authority without undue delay and,
            where required, within 72 hours of becoming aware of it. If you believe
            you have found a vulnerability, please write to{" "}
            <Mail address={LEGAL.privacyEmail} /> before disclosing it publicly.
          </P>
        </Clause>

        <Clause id="children" n={11} title="Children">
          <P>
            Sailo is not intended for anyone under 16, and we do not knowingly collect
            their information. If you believe a child has given us data, write to{" "}
            <Mail address={LEGAL.privacyEmail} /> and we will delete it.
          </P>
        </Clause>

        <Clause id="changes" n={12} title="Changes to this policy">
          <P>
            When this policy changes, the effective date at the top changes with it.
            For anything that materially affects how your data is handled, we email
            account holders before it takes effect. Continuing to use Sailo after that
            means the new version applies.
          </P>
        </Clause>

        <Clause id="contact" n={13} title="Contact">
          <P>
            Privacy requests and questions about this policy go to the address below.
            For anything else, see the <Ref href="/terms">Terms of Service</Ref> or
            the <Ref href="/refunds">Refund Policy</Ref>.
          </P>
          <ContactBlock email={LEGAL.privacyEmail} />
        </Clause>
      </div>
    </article>
  );
}
