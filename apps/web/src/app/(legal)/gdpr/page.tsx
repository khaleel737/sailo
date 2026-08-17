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
import { LEGAL } from "@sailo/core/legal";

export const metadata: Metadata = {
  title: "GDPR",
  description:
    "How Sailo meets the GDPR: lawful bases, data minimisation, international transfers on Standard Contractual Clauses, Article 28 processor terms for sellers, retention, subject rights and breach reporting.",
  alternates: { canonical: "/gdpr" },
};

export default function GdprPage() {
  return (
    <article>
      <h1 className="display text-[clamp(2.25rem,5vw,3rem)] text-[var(--ink)]">
        GDPR
      </h1>
      <p className="mt-4 text-[0.8125rem] text-[var(--mute-400)]">
        Effective {LEGAL.effective}
      </p>
      <p className="mt-8 text-[1.0625rem] leading-[1.7] text-[var(--mute-600)]">
        {LEGAL.product} is built to the GDPR and the UK GDPR. This page is the
        short account of how, with a link to the clause that carries each one in
        full. The <Ref href="/privacy">Privacy Policy</Ref> is the binding
        document; this is the map to it.
      </p>

      <div className="mt-14 space-y-12">
        <Clause id="stance" n={1} title="What we do not do">
          <Callout>
            We do not sell personal data. We do not share it for advertising. We
            do not profile anyone, and no machine here decides anything about a
            person on its own. There is no exception, no affiliate arrangement
            and no &ldquo;trusted partner&rdquo; carve-out behind that sentence.
          </Callout>
          <P>
            The complete list of everyone who processes data on our behalf is in{" "}
            <Ref href="/privacy#subprocessors">section 6 of the Privacy Policy</Ref>
            . Each one runs part of the service and may use what it processes
            only to deliver that service back to us. None of them is an
            advertising network.
          </P>
        </Clause>

        <Clause id="how" n={2} title="How we meet it">
          <List
            items={[
              <>
                <strong>A lawful basis per category.</strong> Contract, legitimate
                interests, legal obligation and consent are each recorded against
                what they cover, rather than one blanket claim over everything —{" "}
                <Ref href="/privacy#why">section 4</Ref>.
              </>,
              <>
                <strong>Minimisation as a design decision.</strong> We do not
                store visitors&rsquo; IP addresses. A shop&rsquo;s visitor count
                is derived per shop, per day, and written to nobody&rsquo;s
                device — <Ref href="/privacy#collect">section 3</Ref>.
              </>,
              <>
                <strong>Consent that is real.</strong> Analytics on our own pages
                load only after you agree, and refusing is exactly as easy as
                agreeing. A seller&rsquo;s storefront asks its own question only
                when that seller has connected marketing tools of their own, and
                those too load only after a yes —{" "}
                <Ref href="/privacy#cookies">section 10</Ref>.
              </>,
              <>
                <strong>Transfers on Standard Contractual Clauses</strong>, with
                the UK Addendum where the UK GDPR applies —{" "}
                <Ref href="/privacy#transfers">section 7</Ref>.
              </>,
              <>
                <strong>Article 28 terms for sellers.</strong> For their
                buyers&rsquo; data the seller is the controller and we are the
                processor, and the written agreement that requires is already in
                force without anything further to sign —{" "}
                <Ref href="/privacy#processor">section 8</Ref>.
              </>,
              <>
                <strong>Retention with an actual period</strong>, stated per
                category, including the one we cannot erase on request and why —{" "}
                <Ref href="/privacy#retention">section 11</Ref>.
              </>,
              <>
                <strong>Rights answered in 30 days, free</strong> — access,
                correction, erasure, portability, objection —{" "}
                <Ref href="/privacy#rights">section 12</Ref>.
              </>,
              <>
                <strong>Breaches reported within 72 hours</strong> where the law
                requires it, and to the people affected without undue delay where
                the risk is high — <Ref href="/privacy#breach">section 14</Ref>.
              </>,
            ]}
          />
        </Clause>

        <Clause id="sellers" n={3} title="If you are a seller in the EU or UK">
          <P>
            You are the controller of your buyers&rsquo; data and we are your
            processor. That means the obligation to your buyers is yours, and the
            obligation to help you meet it is ours.
          </P>
          <P>
            You do not need to sign a separate data processing agreement.{" "}
            <Ref href="/privacy#processor">Section 8</Ref> is that agreement, it
            applies to every account, and it binds us to process only on your
            instructions, to keep the sub-processor list current with notice
            before it changes, to help you answer a buyer&rsquo;s request, and to
            delete on closure. If your own regulator wants it as a standalone
            document, write to <Mail address={LEGAL.privacyEmail} /> and we will
            send one.
          </P>
        </Clause>

        <Clause id="ask" n={4} title="Exercising a right, or telling us we are wrong">
          <P>
            Write to <Mail address={LEGAL.privacyEmail} />. We answer within 30
            days and never charge. You can also complain to your own supervisory
            authority — the Information Commissioner&rsquo;s Office in the UK, or
            the authority for the country you live in across the EEA. We would
            ask you to come to us first, but nothing requires you to.
          </P>
          <Callout>
            Where we fall short of something on this page, the honest response is
            to fix it rather than to reword it. A gap reported here is read by the
            person who can change the code.
          </Callout>
        </Clause>

        <Clause id="contact" n={5} title="Contact">
          <P>
            {LEGAL.operator}, {LEGAL.operatorForm}, trading as {LEGAL.product}.
            Privacy enquiries: <Mail address={LEGAL.privacyEmail} />.
          </P>
          <ContactBlock email={LEGAL.privacyEmail} />
        </Clause>
      </div>
    </article>
  );
}
