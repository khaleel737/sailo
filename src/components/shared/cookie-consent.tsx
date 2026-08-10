"use client";

import { useCallback, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import {
  CONSENT_EVENT,
  readConsent,
  writeConsent,
  type ConsentChoice,
} from "@/lib/consent";

/*
 * Whether this browser has answered is external state — it lives in
 * `localStorage`, another tab can change it, and it cannot be read while
 * rendering on the server. That is precisely what `useSyncExternalStore`
 * describes, and it replaces an effect that set state the moment it ran.
 *
 * Declared at module scope so the identities are stable: a `subscribe` that is
 * recreated each render re-subscribes each render.
 */
function subscribeToConsent(onChange: () => void) {
  window.addEventListener(CONSENT_EVENT, onChange);
  // Another tab answering counts as answering.
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CONSENT_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

const isUnanswered = () => readConsent() === null;

/*
 * Never ask during server rendering. Whether to ask depends on what is in this
 * browser's storage, and guessing produces a flash of a banner at someone who
 * already answered.
 */
const isUnansweredOnServer = () => false;

/*
 * What this site actually stores, and under which heading.
 *
 * Audited rather than assumed: `sailo_session` is BetterAuth's, `sailo_locale`
 * is the language switcher's, `sailo_consent` is this answer. Google Analytics
 * writes `_ga` and a per-property `_ga_*`, and it is the only optional thing
 * here — Vercel Analytics is cookieless, and there is no Sentry, no ad tag and
 * no third-party pixel to declare.
 *
 * `sailo_consent` is marked because it is *not* a cookie — `consent.ts` keeps
 * it in `localStorage`, deliberately, so that recording an answer about
 * cookies does not itself set one. Listing it unqualified beside three real
 * cookies made this notice say something untrue about the site it describes,
 * and disagree with the inventory in `legal.ts`, which correctly omits it. Of
 * the two ways to fix that, naming it accurately beats dropping it: the
 * paragraph above is about being checkable, and a visitor who opens their
 * storage will find it there.
 *
 * A category with nothing behind it is worse than no category: it is a claim
 * that cannot be checked. Add the next one when a tag arrives to justify it,
 * and bump CONSENT_VERSION so everyone is asked again about the new question.
 */
const CATEGORIES = [
  {
    id: "essential",
    body: "essentialBody",
    locked: true,
    // The qualifier is a technical identifier like the names themselves, so it
    // reads the same in every language and needs no dictionary entry.
    cookies: ["sailo_session", "sailo_locale", "sailo_consent (localStorage)"],
  },
  {
    id: "analytics",
    body: "analyticsBody",
    locked: false,
    cookies: ["_ga", "_ga_*"],
  },
] as const satisfies readonly {
  id: "essential" | "analytics";
  body: "essentialBody" | "analyticsBody";
  locked: boolean;
  cookies: readonly string[];
}[];

/**
 * The analytics consent request, for Sailo's own pages.
 *
 * Deliberately not a library. The good ones — `vanilla-cookieconsent` is the
 * pick — ship their own stylesheet, and a banner that arrives with someone
 * else's radii and someone else's greys is the most visible element on the
 * page disagreeing with the rest of it. The work a library actually saves is
 * the gating, which is four lines in `google-tag.tsx`.
 *
 * Two buttons of equal weight. A design where "accept" is a filled capsule and
 * "decline" is grey text is a dark pattern with a legal name — consent has to
 * be as easy to refuse as to give — so the only difference between them here
 * is which one carries the accent.
 *
 * It is a dialog rather than a banner pinned over the content: on a phone a
 * fixed bar covers the thing the visitor came to read, and covering the page
 * until someone agrees is the other pattern regulators dislike.
 */
export function CookieConsent({
  labels,
}: {
  labels: {
    title: string;
    body: string;
    accept: string;
    decline: string;
    privacy: string;
    customise: string;
    save: string;
    essential: string;
    essentialBody: string;
    analytics: string;
    analyticsBody: string;
  };
}) {
  const unanswered = useSyncExternalStore(
    subscribeToConsent,
    isUnanswered,
    isUnansweredOnServer,
  );

  /*
   * Dismissal is tracked separately from the stored answer on purpose.
   *
   * `writeConsent` swallows a storage failure — private browsing, a full quota
   * — and says so: asking again next time is the safe direction to fail in.
   * But it must not fail by leaving the dialog open under someone who just
   * clicked Accept, which reads as a broken button rather than as a browser
   * refusing to remember. This closes it either way.
   */
  const [dismissed, setDismissed] = useState(false);
  /*
   * The middle path. One optional category today, so a panel could look like
   * theatre — but "accept or leave" is the pattern regulators single out, and
   * the shape has to exist before the second category does, not after.
   */
  const [choosing, setChoosing] = useState(false);
  const [analytics, setAnalytics] = useState(false);

  const answer = useCallback((choice: ConsentChoice) => {
    writeConsent(choice);
    setDismissed(true);
  }, []);

  const accept = useCallback(() => answer("granted"), [answer]);
  const decline = useCallback(() => answer("denied"), [answer]);
  const openChoices = useCallback(() => setChoosing(true), []);
  const toggleAnalytics = useCallback(() => setAnalytics((on) => !on), []);
  const saveChoices = useCallback(
    () => answer(analytics ? "granted" : "denied"),
    [answer, analytics],
  );

  if (!unanswered || dismissed) return null;

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-labelledby="consent-title"
      className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-[34rem] rounded-[var(--r-card)] border border-[var(--mute-200)] bg-[var(--paper)] p-5 shadow-lg sm:inset-x-6 sm:bottom-6"
    >
      <p
        id="consent-title"
        className="text-[0.9375rem] font-medium text-[var(--ink)]"
      >
        {labels.title}
      </p>
      <p className="mt-1.5 text-[0.8125rem] leading-[1.65] text-[var(--mute-500)]">
        {labels.body}{" "}
        <Link
          href="/privacy"
          className="focus-line underline underline-offset-2 hover:text-[var(--ink)]"
        >
          {labels.privacy}
        </Link>
      </p>

      {choosing ? (
        <ul className="mt-4 space-y-2">
          {CATEGORIES.map((category) => {
            const on = category.locked || analytics;
            return (
              <li key={category.id}>
                <label
                  className={
                    category.locked
                      ? "flex items-start gap-3 rounded-[var(--r-card)] border border-[var(--mute-200)] bg-[var(--mute-100)] p-3"
                      : "flex cursor-pointer items-start gap-3 rounded-[var(--r-card)] border border-[var(--mute-200)] p-3 hover:bg-[var(--mute-100)]"
                  }
                >
                  {/*
                    A real switch, checkbox underneath.
                    
                    The input carries the state, the keyboard behaviour and the
                    accessible name; the span beside it is only paint. An
                    interactive div with a click handler would have to
                    re-implement all three, and the version this replaced was a
                    span with none of them — which is why the locked row read as
                    a broken control rather than a fixed one.
                  */}
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={category.locked}
                    readOnly={category.locked}
                    onChange={category.locked ? undefined : toggleAnalytics}
                    className="peer sr-only"
                  />
                  <span
                    aria-hidden
                    className={`mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors ${
                      on ? "bg-[var(--ink)]" : "bg-[var(--mute-300)]"
                    } ${category.locked ? "opacity-60" : "peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--ink)] peer-focus-visible:ring-offset-2"}`}
                  >
                    {/*
                      `rtl:-translate-x-4` because the track flips and the
                      thumb does not. Arabic sets `dir="rtl"` on the document,
                      which starts the thumb on the right — and a physical
                      `translate-x-4` then pushes it further right, off the
                      track it is meant to cross, so the switch reads as on
                      when it is off.
                    */}
                    <span
                      className={`block size-4 rounded-full bg-[var(--paper)] shadow-sm transition-transform ${
                        on ? "translate-x-4 rtl:-translate-x-4" : "translate-x-0"
                      }`}
                    />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[0.8125rem] font-medium text-[var(--ink)]">
                      {labels[category.id]}
                    </span>
                    <span className="block text-[0.75rem] text-[var(--mute-500)]">
                      {labels[category.body]}
                    </span>
                    {/*
                      The names themselves, which are identifiers rather than
                      prose and so are the same in every language. Naming them
                      is the difference between a category someone has to trust
                      and one they can check.
                    */}
                    <span className="mt-1 block font-mono text-[0.6875rem] text-[var(--mute-400)]">
                      {category.cookies.join(", ")}
                    </span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      ) : null}

      {/*
        Three ways out, all the same size and shape. An "accept" styled louder
        than the others is the dark pattern with a legal name; so is burying
        the granular choice behind a text link.
      */}
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={accept}
          className="focus-ring press inline-flex min-h-11 flex-1 basis-full items-center justify-center rounded-[var(--r-pill)] bg-[var(--ink)] px-5 text-[0.8125rem] font-semibold text-[var(--paper)] transition hover:opacity-90 sm:basis-0"
        >
          {labels.accept}
        </button>
        <button
          type="button"
          onClick={decline}
          className="focus-ring press inline-flex min-h-11 flex-1 basis-[calc(50%-0.25rem)] items-center justify-center rounded-[var(--r-pill)] border border-[var(--mute-300)] px-5 text-[0.8125rem] font-semibold text-[var(--ink)] transition hover:bg-[var(--mute-100)] sm:basis-0"
        >
          {labels.decline}
        </button>
        <button
          type="button"
          onClick={choosing ? saveChoices : openChoices}
          aria-expanded={choosing}
          className="focus-ring press inline-flex min-h-11 flex-1 basis-[calc(50%-0.25rem)] items-center justify-center rounded-[var(--r-pill)] border border-[var(--mute-300)] px-5 text-[0.8125rem] font-semibold text-[var(--ink)] transition hover:bg-[var(--mute-100)] sm:basis-0"
        >
          {choosing ? labels.save : labels.customise}
        </button>
      </div>
    </div>
  );
}
