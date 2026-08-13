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
  title: "Anti-Spam Policy",
  description:
    "Sailo prohibits advertising sailo.store or any Sailo store through unsolicited email. What we send, the consent it requires, and how the rule binds sellers and third parties.",
  alternates: { canonical: "/anti-spam" },
};

const ABUSE_EMAIL = "abuse@sailo.store";

export default function AntiSpamPage() {
  return (
    <article>
      <h1 className="display text-[clamp(2.25rem,5vw,3rem)] text-[var(--ink)]">
        Anti-Spam Policy
      </h1>
      <p className="mt-4 text-[0.8125rem] text-[var(--mute-400)]">
        Effective {LEGAL.effective}
      </p>
      <p className="mt-8 text-[1.0625rem] leading-[1.7] text-[var(--mute-600)]">
        {LEGAL.product} is operated by {LEGAL.operator}, {LEGAL.operatorForm} based in{" "}
        {LEGAL.city}, {LEGAL.state}. This policy states plainly that neither we nor
        anyone acting through us advertises {LEGAL.product} or any shop it hosts with
        unsolicited email, and it sets the rule that binds our sellers and any third
        party as firmly as it binds us.
      </p>

      <div className="mt-14 space-y-12">
        <Clause id="commitment" n={1} title="The commitment">
          <Callout>
            {LEGAL.product} prohibits the advertising of sailo.store, or any Sailo
            store, through unsolicited electronic messages — spam — by anyone: Sailo,
            its sellers, their affiliates, or any third party acting on their behalf.
          </Callout>
          <P>
            This is not aspirational. It is a term of using the service, enforced
            against accounts that break it, and it is the standard we hold ourselves
            to for the email the platform itself sends.
          </P>
        </Clause>

        <Clause id="what-we-send" n={2} title="What Sailo sends, and nothing else">
          <P>
            Every message that leaves the platform is one of two kinds, and there is
            no third.
          </P>
          <List
            ordered
            items={[
              <>
                <strong className="font-medium text-[var(--ink)]">
                  Transactional email
                </strong>
                , triggered by the recipient&rsquo;s own action — an order
                confirmation, a receipt, an invoice, a shipping or booking notice, a
                password reset, an account alert. A person asked for these by placing
                the order or holding the account.
              </>,
              <>
                <strong className="font-medium text-[var(--ink)]">
                  Consent-based marketing email
                </strong>
                , sent by a seller only to contacts who gave prior express consent to
                hear from that seller, and carrying a working one-click unsubscribe in
                every message that is honoured immediately.
              </>,
            ]}
          />
          <P>
            We do not send, and we do not permit a seller to send, marketing email to
            anyone who did not ask for it.
          </P>
        </Clause>

        <Clause id="consent" n={3} title="Consent and unsubscribe">
          <P>
            Marketing consent on {LEGAL.product} is opt-in: a contact is added to a
            seller&rsquo;s marketing audience only when they affirmatively agree — by
            ticking an unticked box at checkout, or through the seller&rsquo;s own
            subscribe form. A purchase alone is not consent to marketing.
          </P>
          <P>
            Every marketing message carries an unsubscribe link. Unsubscribing takes
            effect at once and permanently for that seller; there is no
            &ldquo;are you sure&rdquo; and no re-adding a contact who left. Suppression
            is enforced by the platform, not left to the seller to remember.
          </P>
        </Clause>

        <Clause id="prohibited" n={4} title="What is forbidden">
          <P>The following are prohibited on {LEGAL.product}, without exception:</P>
          <List
            items={[
              <>
                Buying, renting, harvesting, or scraping email addresses, and importing
                any list a contact did not knowingly join.
              </>,
              <>
                Sending marketing to a contact who did not consent, or after they
                unsubscribed.
              </>,
              <>
                Forging or disguising the sender, the subject, or the origin of a
                message, or omitting a working unsubscribe.
              </>,
              <>
                Advertising a Sailo shop from any other system — a personal inbox, a
                bulk-mail tool, an affiliate&rsquo;s list — in a way that would be
                unsolicited. The rule follows the shop, not just the platform&rsquo;s
                own sending.
              </>,
            ]}
          />
        </Clause>

        <Clause id="who-it-binds" n={5} title="Who this binds">
          <P>
            This policy binds everyone who could put a Sailo address in front of a
            recipient: {LEGAL.product} itself, every seller who runs a shop on it, any
            affiliate promoting a shop, and any third party a seller engages to send on
            their behalf. A seller is responsible for the conduct of anyone mailing for
            them, and cannot escape this policy by outsourcing the send.
          </P>
        </Clause>

        <Clause id="enforcement" n={6} title="Enforcement">
          <P>
            We act on violations. Depending on severity that means pausing a
            seller&rsquo;s ability to send, removing improperly gathered contacts,
            suspending the shop, or terminating the account — and cooperating with
            mailbox providers and blocklist operators to resolve a listing. Sending
            practices that threaten the deliverability of the whole platform are
            treated as serious, because one sender&rsquo;s spam harms every honest shop
            on the service. The{" "}
            <Ref href="/terms">Terms of Service</Ref> set out the account consequences
            in full.
          </P>
        </Clause>

        <Clause id="report" n={7} title="Reporting abuse">
          <P>
            If you received email you believe breaks this policy, tell us and we will
            investigate and act. Include the full message headers if you can — they let
            us identify the sender precisely.
          </P>
          <P>
            Report abuse to <Mail address={ABUSE_EMAIL} />. Blocklist and mailbox
            operators may use the same address to reach us about a listing, and we
            answer those promptly.
          </P>
        </Clause>

        <Clause id="changes" n={8} title="Changes">
          <P>
            If this policy changes, the effective date at the top changes with it.
          </P>
        </Clause>

        <Clause id="contact" n={9} title="Contact">
          <P>
            Abuse reports: <Mail address={ABUSE_EMAIL} />. Anything else about an
            account or a shop: <Mail address={LEGAL.supportEmail} />.
          </P>
          <ContactBlock email={ABUSE_EMAIL} />
        </Clause>
      </div>
    </article>
  );
}
