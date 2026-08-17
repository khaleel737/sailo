import type { Metadata } from "next";
import {
  Callout,
  Clause,
  ContactBlock,
  DefList,
  Group,
  List,
  Mail,
  P,
  Ref,
} from "@/components/legal/legal-kit";
import { LEGAL } from "@sailo/core/legal";
import {
  ACCEPTED_BUSINESSES,
  CONDITIONAL_BUSINESSES,
  DECLINED_BUSINESSES,
  JURISDICTION_RULES,
  STRIPE_LIST_RECONCILED,
  STRIPE_RESTRICTED_URL,
} from "@sailo/security/restricted-businesses";

/**
 * The acceptable-use policy, at its own address.
 *
 * These lists already render inside clauses 6 to 8 of the Terms, and they stay
 * there — the Terms are the agreement and this is not a second one. What this
 * page adds is a URL, and the URL is the point: an acquirer, a bank or a
 * partner performing diligence asks for a link to the restricted-business
 * policy, and "clause 8 of our terms of service" is the answer that gets a
 * follow-up email. It is also the link a refusal can carry, and a seller
 * reading why their shop was declined should not have to scroll past an
 * indemnity clause to get there.
 *
 * Same data, one source. Editing the policy means editing
 * `@sailo/security/restricted-businesses`, and both surfaces move together.
 *
 * The country section is the one thing here that clause 8 does not render.
 * Fifteen countries of extra prohibitions would bury the global list a seller
 * is actually reading, and the Terms are already the longest document we
 * publish — so it lives on the page that exists to be complete rather than the
 * one that exists to be agreed to.
 */
export const metadata: Metadata = {
  title: "Restricted Businesses",
  description:
    "Which businesses Sailo accepts, which it accepts on conditions, and which it declines — on every channel, including the country-specific rules that apply to sellers taking card payments.",
  alternates: { canonical: "/restricted-businesses" },
};

export default function RestrictedBusinessesPage() {
  return (
    <article>
      <h1 className="display text-[clamp(2.25rem,5vw,3rem)] text-[var(--ink)]">
        Restricted Businesses
      </h1>
      <p className="mt-4 text-[0.8125rem] text-[var(--mute-400)]">
        Effective {LEGAL.effective} · Reconciled against Stripe&rsquo;s published
        list of {STRIPE_LIST_RECONCILED}
      </p>
      <p className="mt-8 text-[1.0625rem] leading-[1.7] text-[var(--mute-600)]">
        This is the acceptable-use policy for {LEGAL.product}. It says which
        businesses we accept, which we accept with something attached, and which
        we decline. It forms part of the{" "}
        <Ref href="/terms">Terms of Service</Ref> — clauses 6, 7 and 8 — and is
        published separately so that it can be linked, quoted and checked on its
        own.
      </p>

      <div className="mt-14 space-y-12">
        <Clause id="scope" n={1} title="What this covers, and on which channels">
          <Callout>
            This policy holds on every channel. Most orders on {LEGAL.product}{" "}
            arrive by chat, bank transfer or cash and never touch a payment
            system — that does not make anything below acceptable here.
          </Callout>
          <P>
            Card payments on {LEGAL.product} are created on the seller&rsquo;s
            own Stripe connected account. Stripe&rsquo;s{" "}
            <Ref href={STRIPE_RESTRICTED_URL}>
              prohibited and restricted businesses list
            </Ref>{" "}
            therefore binds every seller who switches card payments on, and the
            card networks&rsquo; rules bind Stripe in turn. This policy is shaped
            like Stripe&rsquo;s deliberately. Where the two differ, the stricter
            one applies.
          </P>
          <P>
            A platform whose own policy is looser than its processor&rsquo;s is
            not being more permissive. It is telling sellers yes and letting
            Stripe tell them no later, after they have built a catalogue.
          </P>
          <Callout>
            Accepting a shop is not us saying your business is lawful, licensed
            or insured where you are. That stays yours to establish under{" "}
            <Ref href="/terms#seller">clause 4 of the Terms</Ref>, and we do not
            check it for you.
          </Callout>
        </Clause>

        <Clause id="accepted" n={2} title="Businesses we accept">
          <P>
            Almost every small business fits here. If you recognise your trade in
            this list, there is nothing further you need from us before you
            start.
          </P>
          <DefList
            items={ACCEPTED_BUSINESSES.map((b) => ({
              term: b.name,
              detail: b.examples,
            }))}
          />
          <P>
            The list is not exhaustive and is not meant to be. Something similar
            to these, sold honestly, is accepted whether or not it has a line of
            its own.
          </P>
        </Clause>

        <Clause id="conditional" n={3} title="Accepted, with conditions">
          <P>
            These are real businesses and they are welcome here, but each one
            carries a licence, an age restriction, or a gap between when the
            buyer pays and when they receive — and the gap is where chargebacks
            come from. The condition attached to each is part of the Terms:
            trading outside it is a breach, not a technicality.
          </P>
          <DefList
            items={CONDITIONAL_BUSINESSES.map((b) => ({
              term: b.name,
              detail: b.condition,
            }))}
          />
          <P>
            We may ask you for a licence, a registration number, proof that you
            hold the stock, or identification — before you start or at any point
            afterwards. Card payments may stay off until we have it, and a shop
            that cannot produce it may be limited to chat, bank transfer and cash
            orders, or closed.
          </P>
        </Clause>

        <Clause id="declined" n={4} title="Businesses we decline">
          <P>
            Some of this is our choice. Most of it is the condition on which the
            whole platform keeps card acceptance. Every group carries the reason
            it exists, because the rules that get argued with are always the ones
            that look arbitrary.
          </P>

          <div className="space-y-8 pt-2">
            {DECLINED_BUSINESSES.map((g) => (
              <Group key={g.id} id={g.id} title={g.group}>
                <P>{g.why}</P>
                <List items={[...g.items]} />
              </Group>
            ))}
          </div>

          <P>
            No list of this kind is complete, and this one is not. We may add to
            it when a new category of harm turns up or a payment provider
            requires it, and we may decline or close a shop that is plainly the
            same thing under another name. Where we add a category that affects a
            shop already trading, we give the notice in{" "}
            <Ref href="/terms#misc">clause 18 of the Terms</Ref>.
          </P>
        </Clause>

        <Clause id="countries" n={5} title="Extra rules where your business is">
          <P>
            Everything above holds everywhere. Some trades are additionally
            declined for sellers in particular countries — not because we think
            less of them, but because Stripe prohibits them there and a card
            payment would be refused whatever this page said.
          </P>
          <Callout>
            The country that decides this is <strong>yours</strong>, not your
            buyer&rsquo;s. It is the business location your Stripe account was
            opened in, which Stripe fixes when the account is created and does
            not let anyone edit afterwards.
          </Callout>
          <P>
            If your country is not listed, nothing here is added to your policy.
            Local law may still forbid more than this page does, and establishing
            that stays yours.
          </P>

          <div className="space-y-8 pt-2">
            {JURISDICTION_RULES.map((rule) => (
              <Group
                key={rule.country}
                id={`country-${rule.country.toLowerCase()}`}
                title={rule.name}
              >
                <P>Declined for sellers here, in addition to everything above:</P>
                <List items={[...rule.declined]} />
                {rule.conditional && rule.conditional.length > 0 ? (
                  <>
                    <P>
                      And accepted here only after we have reviewed the shop:
                    </P>
                    <List items={[...rule.conditional]} />
                  </>
                ) : null}
              </Group>
            ))}
          </div>
        </Clause>

        <Clause id="screening" n={6} title="How we check, and what happens then">
          <P>
            We screen a shop&rsquo;s own words — its name, description and
            catalogue — when card payments are switched on, and again from time
            to time afterwards. Stripe runs its own checks on every account we
            open for you: identity and business verification, sanctions
            screening, and its own prohibited-business review. Neither of us is
            the only line, and neither of us reads every language perfectly, so
            passing a check is not approval of a trade this policy declines.
          </P>
          <P>
            Where a shop plainly falls in clause 4, we decline it and say which
            group. Where it might, we ask you before deciding anything — a
            question is cheaper than a wrongly closed shop, and the words a small
            business uses about itself are ambiguous far more often than they are
            evasive.
          </P>
          <P>
            When we decline a shop, we say why unless the law stops us, your data
            stays exportable for the period in the{" "}
            <Ref href="/privacy">Privacy Policy</Ref>, and we refund the unused
            part of any paid plan. The exception is the child-safety item under{" "}
            <Ref href="#adult">Adult content and services</Ref>, which is
            reported rather than answered.
          </P>
        </Clause>

        <Clause id="asking" n={7} title="If you are not sure">
          <P>
            Ask before you build it. Email{" "}
            <Mail address={LEGAL.supportEmail} /> with what you sell, who to, and
            how it reaches them, and you will get a straight answer. That is
            considerably cheaper for both of us than a catalogue built against a
            shop we then have to close.
          </P>
          <ContactBlock email={LEGAL.supportEmail} />
        </Clause>
      </div>
    </article>
  );
}
