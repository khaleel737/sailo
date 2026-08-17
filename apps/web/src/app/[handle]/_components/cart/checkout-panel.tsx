"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Download, Loader2, X } from "lucide-react";
import { createOrderIntent } from "@/lib/actions/orders";
import { markPendingOrder } from "@/lib/cart";
import {
  countriesByName,
  countryFromTimeZone,
  countryName,
  deviceTimeZone,
} from "@sailo/core/countries";
import { shippableCountries, shipsTo } from "@sailo/commerce/delivery";
import { markLeaving } from "@/lib/leaving";
import type { OrderIntentResult } from "@sailo/commerce/orders";
import { useCheckoutQuote } from "./use-checkout-quote";
import {
  PAYMENT_METHOD_DEFS,
  railsForOrder,
  type PaymentMethodType,
} from "@/lib/payments";
import { formatPercent } from "@sailo/core/pricing";
import { readReferralCode } from "@/lib/referral";
import { trackClick } from "@sailo/analytics/clicks";
import { interpolate } from "@sailo/i18n";
import { formatMoney } from "@sailo/core/currency";
import { deliveryCopy, railCopy } from "./checkout-copy";
import { useCart } from "./cart-provider";
import { Confirmation } from "./confirmation";
import type {
  CheckoutCompliance,
  CheckoutDelivery,
  CheckoutMethod,
  CheckoutPanelProps,
} from "./checkout.types";

export function CheckoutPanel({
  shopId,
  shopName,
  currency,
  items,
  methods,
  deliveryOptions,
  needsDeliveryHint = false,
  payInPersonHint = true,
  contactEmail,
  compliance,
  hasFiles = false,
  heldUntilPaid = false,
  title,
  ariaLabel,
  t,
  onClose,
  onPlaced,
  children,
  empty,
}: CheckoutPanelProps) {
  /*
   * Always rendered inside `CartRegion`, which is what puts the shop's
   * resolved locale in context — the same one the page is written in, so a
   * total reads `12,50 €` on a French storefront and `€12.50` on an English
   * one. Optional-chained because the buy-now sheet mounts this outside a
   * populated cart; the formatter falls back to English on its own.
   */
  const locale = useCart()?.locale;
  const [chosen, setChosen] = useState<PaymentMethodType>(
    railsForOrder(methods, payInPersonHint)[0]?.type ?? "whatsapp",
  );
  const [deliveryId, setDeliveryId] = useState<string | null>(
    deliveryOptions[0]?.id ?? null,
  );
  /*
   * Where it's going, which now decides what may be offered rather than merely
   * being copied onto the packing slip.
   *
   * Seeded with the shop's only destination when it has exactly one. A shop
   * that posts only within Croatia has a country list holding Croatia, and
   * making the buyer pick it out of a list of one would be asking a question
   * whose answer we already have — while leaving it blank would open the panel
   * with no delivery options at all. It is not a guess about the buyer: it is
   * the only place this shop posts to, and if that isn't where they are, the
   * panel says so as soon as the rest of the form is filled.
   */
  const [country, setCountry] = useState(() => {
    const reachable = shippableCountries(deliveryOptions);
    return reachable?.length === 1 ? (reachable[0] ?? "") : "";
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /*
   * Tracked only to answer "has the other one been filled in?" — the fields
   * stay uncontrolled and the values are read off the form on submit, so this
   * is about which field is required, not about who owns the text.
   */
  const [emailTyped, setEmailTyped] = useState("");
  const [phoneTyped, setPhoneTyped] = useState("");
  const [result, setResult] = useState<Extract<
    OrderIntentResult,
    { ok: true }
  > | null>(null);

  /*
   * Which rates this order could have, given where it's going.
   *
   * `shipsTo` is the same function the server asks — an empty zone is
   * anywhere, a collection is unaffected, and a rate that names countries
   * refuses one it cannot check. Filtering here rather than round-tripping
   * keeps the country and the rates in step within a single frame; the server
   * asks again before anything is charged, so this is presentation and not
   * enforcement.
   */
  const deliverable = deliveryOptions.filter((option) => shipsTo(option, country));
  /*
   * The rate in force, read back through what is still on offer rather than
   * trusted — the same rule the payment rail below follows, and for the same
   * reason. Changing the country from Croatia to Germany can withdraw the rate
   * that was selected, and an order placed on a rate the panel had stopped
   * showing is the bug that rule exists to prevent.
   */
  const deliveryChoice = deliverable.some((d) => d.id === deliveryId)
    ? deliveryId
    : (deliverable[0]?.id ?? null);

  /*
   * Every figure on this panel comes from the server. `useCheckoutQuote` owns
   * that conversation — the debounced re-price, the coupon round trip, and the
   * two questions only the server can answer about whether this basket needs
   * delivering or an address at all.
   */
  const quote = useCheckoutQuote({
    shopId,
    items,
    deliveryId: deliveryChoice,
    country,
    needsDeliveryHint,
  });
  const { preview, coupon, dispatchCoupon, totals, tax } = quote;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  const selectedDelivery = deliverable.find((d) => d.id === deliveryChoice);
  // The server decides all three: a basket of downloads isn't shipped, a
  // collection order has nowhere to deliver to, and a rail whose promise is a
  // doorstep is not on offer to an order that never reaches one.
  const showDelivery = quote.needsDelivery && deliveryOptions.length > 0;
  const needsAddress = quote.needsAddress;
  const rails = railsForOrder(methods, quote.canPayInPerson);

  /* ---- Where it's going ------------------------------------------------- */

  /*
   * The countries this shop actually posts to, or null when nothing narrows
   * it. Null is the common case and means the dropdown holds every country;
   * a list means the dropdown holds only those, which is the whole feature in
   * one glance — a Croatia-only shop offers Croatia and nothing else, so the
   * buyer learns the rule by reading it instead of by being refused at the end.
   */
  const reachable = shippableCountries(deliveryOptions);
  const countryChoices = useMemo(() => {
    const all = countriesByName(locale);
    return reachable ? all.filter((c) => reachable.includes(c.code)) : all;
    // `reachable` is rebuilt each render from a prop that rarely changes;
    // joined so an identical list doesn't re-sort 244 names.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locale, reachable?.join(",")]);

  /*
   * Ask only when the answer changes something. An unrestricted shop keeps the
   * field exactly as optional as it has always been — the reasoning for
   * leaving region, postcode and country alone was that a required field an
   * honest buyer cannot fill is worse than a blank one, and a shop that posts
   * everywhere has no reason to overturn it. A collection order never needs
   * one either: the buyer is coming to the seller.
   */
  const countryMatters =
    quote.needsDelivery && (reachable !== null || needsAddress);
  const countryRequired =
    quote.needsDelivery &&
    reachable !== null &&
    selectedDelivery?.type !== "collection";

  /*
   * A first guess at where the buyer is, taken from the clock on their device.
   *
   * This is what lets the country sit down in the address block with the rest
   * of the address, where a buyer expects to find it, instead of on its own
   * above the delivery rates. Those rates are filtered by country, so the
   * field had to come first while the answer arrived only by being typed —
   * ask afterwards and the buyer picks a courier before saying where they are,
   * then has the choice withdrawn underneath them. A country that is already
   * filled in by the time anything renders removes the ordering problem rather
   * than working around it.
   *
   * Only ever a starting value. It runs once, never overwrites a country that
   * is already set, and the field stays an ordinary dropdown the buyer can
   * change — at which point the rates re-filter exactly as they always did.
   *
   * Scoped to `countryChoices`, so a Croatia-only shop cannot have Germany
   * filled in because that is where the laptop thinks it is; an unplaceable
   * zone leaves the field blank, which is the honest answer.
   */
  const guessed = useRef(false);
  useEffect(() => {
    /*
     * Not on mount, and not for every basket.
     *
     * `countryMatters` is false until the server has said this order needs
     * delivering, so guessing on mount meant a download and an online call —
     * neither of which has anywhere to be sent — still got a country, a
     * re-render and a second trip to the pricing endpoint for an answer
     * nothing on the panel would read. Waiting for the question to become
     * relevant costs nothing and skips that entirely.
     *
     * The ref is what keeps it a *first* guess: once it has fired, a buyer who
     * blanks the field gets to leave it blank.
     */
    if (guessed.current || !countryMatters || country) return;
    guessed.current = true;

    const guess = countryFromTimeZone(
      deviceTimeZone(),
      countryChoices.map((choice) => choice.code),
    );
    if (guess) setCountry(guess);
  }, [countryMatters, country, countryChoices]);

  /*
   * One field, two homes, and never both at once.
   *
   * It normally belongs at the end of the address, which is where a browser's
   * autofill puts a country and where a buyer looks for one. A collection
   * order has no address block, so it falls back to standing on its own — and
   * the label changes with the position, because "Ship to" reads as a heading
   * above a form and as a non-sequitur underneath a postcode.
   *
   * The label is always a real `<label>` even when it isn't drawn: the blank
   * option reads as a placeholder to someone looking at the page and as
   * nothing at all to someone listening to it.
   */
  const countryField = (label: string, hideLabel: boolean) => (
    <div>
      <label
        htmlFor="checkout-country"
        className={hideLabel ? "sr-only" : "mb-1.5 block text-sm font-medium"}
      >
        {label}
      </label>
      <select
        id="checkout-country"
        name="country"
        required={countryRequired}
        value={country}
        onChange={(e) => setCountry(e.target.value)}
        // `country`, not `country-name`: the value is an alpha-2 code, which
        // is what this token tells the browser to fill and what every stored
        // address wants.
        autoComplete="country"
        className="surface-elevated h-11 w-full rounded-xl px-3 text-sm outline-none"
      >
        <option value="">{t.checkout.country}</option>
        {countryChoices.map((choice) => (
          <option key={choice.code} value={choice.code}>
            {choice.name}
          </option>
        ))}
      </select>
    </div>
  );

  /*
   * The shop has rates and not one of them reaches the buyer. Distinct from
   * "this shop has no delivery options at all", which is an existing and
   * perfectly good configuration that takes physical orders with no fee — and
   * which `showDelivery` already keeps this block out of.
   */
  const noRoute = showDelivery && deliverable.length === 0;

  /*
   * The rail in force, which is not always the one last clicked: the quote can
   * withdraw it. A cart holding a mug and a PDF offers cash on delivery, and
   * removing the mug takes it away again — so the choice is read back through
   * what is still on offer rather than trusted, or the order would go out on a
   * rail the panel had stopped showing.
   */
  const method = rails.some((m) => m.type === chosen)
    ? chosen
    : (rails[0]?.type ?? chosen);
  const def = PAYMENT_METHOD_DEFS[method];
  const rail = railCopy(method, t);

  /*
   * Which of the two ways of reaching the buyer is doing the work.
   *
   * The rule is "one of them", which HTML has no attribute for — so each field
   * is required exactly while the other is empty, and both stop being required
   * as soon as either is filled. That gets the browser's own validation, in the
   * buyer's own language, for a rule it cannot otherwise express; the server
   * checks the same thing, because a form is a courtesy and not a guarantee.
   *
   * An email specifically is needed when the rail settles by receipt, or when
   * the order carries something that arrives by email. Then the phone is
   * genuinely optional and says so.
   */
  const needsEmail = Boolean(def.requires.email) || quote.needsEmail;
  const emailRequired = needsEmail || !phoneTyped.trim();
  const phoneRequired = !needsEmail && !emailTyped.trim();

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const data = new FormData(event.currentTarget);

    /*
     * A thrown action has to land somewhere the buyer can see.
     *
     * `createOrderIntent` returns `{ ok: false }` for everything it expects —
     * sold out, a spent coupon, a rail that is off. It *throws* for what it
     * does not: the database refusing a connection under load, most of all. A
     * load test made that happen ninety times in a row, and with no catch here
     * the rejection escaped `onSubmit`, `setPending(false)` never ran, and the
     * button span forever with nothing said. That is the same trap the comment
     * below describes for `mailto:` — and it is how one order becomes three,
     * because a buyer reads a stuck spinner as failure and presses again.
     *
     * What to tell them depends on the rail, because the two rails leave the
     * buyer in genuinely different places.
     *
     * On a card, nothing has been charged — the money only moves after the
     * redirect to Stripe, which is the step that did not happen — and no
     * confirmation email is sent at this point either, since `createOrderIntent`
     * only mails when the order settles at checkout. So "check your email" is
     * advice that sends a card buyer looking for a message that does not exist,
     * and retrying is simply safe: an unpaid order left behind is cancelled by
     * the hourly sweep.
     *
     * On a manual rail the opposite holds. The order may be written and its
     * confirmation already sent, so retrying is how one order becomes two.
     */
    let res: Awaited<ReturnType<typeof createOrderIntent>>;
    try {
      res = await createOrderIntent({
        shopId,
        items,
        paymentMethod: method,
        deliveryMethodId: deliveryChoice ?? undefined,
        couponCode: quote.couponCode,
        affiliateCode: readReferralCode() ?? undefined,
        customerName: String(data.get("customerName") ?? ""),
        customerEmail: String(data.get("customerEmail") ?? ""),
        customerPhone: String(data.get("customerPhone") ?? ""),
        addressLine1: String(data.get("addressLine1") ?? ""),
        addressLine2: String(data.get("addressLine2") ?? ""),
        city: String(data.get("city") ?? ""),
        region: String(data.get("region") ?? ""),
        postalCode: String(data.get("postalCode") ?? ""),
        /*
         * From state rather than off the form, unlike every field around it.
         *
         * This is the one value the panel *reasoned* with — it decided which
         * delivery rates were on offer and which the order is being placed on
         * — so sending it is what makes the server check the same country the
         * buyer was shown rates for. Read back off the form it could differ by
         * a frame, and a rate filtered on one country and charged against
         * another is precisely the drift the server-side check exists to
         * catch.
         */
        country,
        note: String(data.get("note") ?? ""),
        /*
         * Sent as what the buyer did, not as what the shop requires. The
         * server holds the switch and re-decides — these two lines are a
         * report, and `createOrderIntent` treats them as one.
         */
        acceptedTerms: data.get("acceptedTerms") === "on",
        marketingOptIn: data.get("marketingOptIn") === "on",
      });
    } catch (thrown) {
      // Named for what it is rather than `error`, which is the state setter's
      // own name one scope up.
      console.error("[sailo] checkout failed:", thrown);
      setError(method === "card" ? t.checkout.failedSafe : t.checkout.failedUnsure);
      setPending(false);
      return;
    }

    if (!res.ok) {
      setError(res.error);
      setPending(false);
      return;
    }

    /*
     * When the basket empties depends on what just happened to the money.
     *
     * On every rail but card the order now stands — confirmation sent, invoice
     * issued — so the basket it came from is spent, and it empties here,
     * before any handoff navigates away.
     *
     * A card order is still only an intent: the buyer is about to leave for
     * Stripe, and may pay or may abandon. Emptying here is what made
     * abandoning lose the whole basket — they came back to a shop that had
     * forgotten everything they picked. So the basket stays, and the order id
     * is parked in storage instead: the invoice page empties it when the
     * payment lands there, and the storefront asks the server on the next
     * visit for anyone who never came back.
     *
     * `onPlaced` doubles as "this checkout sells the basket". The buy-now
     * sheet passes nothing, and its orders must not park a marker that would
     * later empty a basket they did not come from.
     */
    if (method === "card") {
      if (onPlaced) markPendingOrder(shopId, res.orderId);
    } else {
      onPlaced?.();
    }

    /*
     * Two different things wear the same `redirect` kind, and they behave
     * nothing alike.
     *
     * `https:` — WhatsApp, Telegram, Instagram — genuinely leaves the page, so
     * returning early is right: nothing after it would ever run anyway.
     *
     * `mailto:` and `tel:` do not. They ask the operating system to hand off to
     * another app, and if nothing is registered to take it — desktop Chrome
     * with no default mail client, most commonly — the browser does nothing at
     * all. The page stays exactly where it was. Returning early there skipped
     * `setPending(false)`, so the button sat spinning forever while the order
     * had already been saved. A buyer reads that as failure and presses it
     * again, which is how one order becomes three.
     *
     * So: try the handoff either way, but only treat the http case as a
     * departure. Everything else falls through to the confirmation, because
     * the order exists whether or not a mail app ever opened.
     */
    if (res.handoff?.kind === "redirect") {
      const leavesPage = /^https?:/i.test(res.handoff.url);
      // The contact-rail handoff is an outbound click — count it before the
      // navigation tears this page down. `sendBeacon` survives the unload;
      // mailto:/tel: never reach the server (no host to count) and are not
      // sent at all.
      if (leavesPage) trackClick(shopId, res.handoff.url, "contact");
      /*
       * Said before the assignment, not after: the navigation cancels the
       * Server Action's still-open revalidation stream, and on WebKit that
       * cancellation reaches React as a real error within milliseconds. The
       * flag has to already be set when the boundary asks. See `lib/leaving`.
       *
       * Only for the http case. `mailto:` and `tel:` leave the page standing,
       * so an error after one of those is the buyer's to see.
       */
      if (leavesPage) markLeaving();
      window.location.href = res.handoff.url;
      if (leavesPage) return;
    }

    setResult(res);
    setPending(false);
  }
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel ?? title}
    >
      <button
        type="button"
        aria-label={t.common.close}
        onClick={onClose}
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
      />

      {/*
        Two things kept the close button out of reach on a phone, and they
        were independent — fixing either alone still left it unreachable.

        `dvh`, not `vh`. On iOS Safari `vh` is the *large* viewport, measured
        with the address bar hidden, and it does not change when the bar is
        showing. A panel capped at 92vh is therefore taller than the screen
        the buyer can actually see, and because the sheet is bottom-aligned
        below `sm`, the overflow goes off the *top* — taking the close button
        with it. `dvh` tracks the viewport that is really there.

        The panel no longer scrolls; the region inside it does. The button is
        positioned against the panel, so while the panel was the scrolling box
        it scrolled away with the content — reaching the payment fields meant
        pushing the X off screen. With `overflow-hidden` here and the scroller
        one level in, the button is pinned to a box that never moves.
      */}
      <div className="surface-card animate-rise relative flex max-h-[92dvh] w-full max-w-md flex-col overflow-hidden rounded-t-2xl sm:rounded-2xl">
        <button
          type="button"
          onClick={onClose}
          aria-label={t.common.close}
          className="text-muted absolute end-4 top-4 z-10 grid place-items-center transition pointer-coarse:-m-3 pointer-coarse:size-11 hover:opacity-70"
        >
          <X className="size-5" />
        </button>

        {/*
          `overscroll-contain` stops the page behind the sheet from taking
          over the gesture once this reaches its end, which on iOS reads as
          the sheet refusing to scroll. The bottom padding clears the home
          indicator on a phone that has one.
        */}
        <div className="overflow-y-auto overscroll-contain p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          {result ? (
            <Confirmation
              result={result}
              shopName={shopName}
              contactEmail={contactEmail}
              methodName={rail.name}
              t={t}
              onClose={onClose}
            />
          ) : items.length === 0 ? (
            <div className="pe-8">{empty}</div>
          ) : (
            <form method="post" onSubmit={onSubmit} className="space-y-4">
              {children?.(preview)}

              {error ? (
                <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                  {error}
                </p>
              ) : null}

              {/*
                Standing on its own only when there is no address block to live
                in — a collection order from a shop that posts to a fixed list
                still needs the question asked, and has no street or postcode
                to ask it beside.
              */}
              {countryMatters && !needsAddress
                ? countryField(t.checkout.shipTo, false)
                : null}

              {showDelivery ? (
                <fieldset>
                  <legend className="mb-1.5 text-sm font-medium">
                    {t.checkout.howReceive}
                  </legend>
                  {noRoute ? (
                    /*
                     * Said here, in the buyer's language, next to the country
                     * they just chose — rather than by the server after they
                     * have filled in a whole checkout. The order is refused
                     * there too; this is so nobody has to reach it.
                     */
                    <p className="surface-elevated rounded-xl p-2.5 text-sm">
                      {country
                        ? interpolate(t.checkout.noShippingTo, {
                            shop: shopName,
                            country: countryName(country, locale),
                          })
                        : t.checkout.chooseCountryFirst}
                    </p>
                  ) : (
                  <div className="space-y-1.5">
                    {deliverable.map((option) => {
                      const d = deliveryCopy(option.type, t);
                      const active = deliveryChoice === option.id;
                      const free =
                        option.freeOverCents !== null &&
                        totals.subtotalCents - totals.discountCents >=
                          option.freeOverCents;
                      return (
                        <label
                          key={option.id}
                          className={`flex cursor-pointer items-start gap-2.5 rounded-xl p-2.5 transition ${
                            active ? "surface-elevated" : "hover:opacity-70"
                          }`}
                        >
                          <input
                            type="radio"
                            name="deliveryMethod"
                            value={option.id}
                            checked={active}
                            onChange={() => setDeliveryId(option.id)}
                            className="mt-0.5 size-4 accent-current"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="flex items-baseline justify-between gap-2">
                              <span className="text-sm font-medium">
                                {option.name}
                              </span>
                              <span className="text-xs font-semibold tabular-nums">
                                {option.feeCents === 0 || free
                                  ? t.common.free
                                  : formatMoney(option.feeCents, currency, locale)}
                              </span>
                            </span>
                            <span className="text-muted block text-xs leading-snug">
                              {option.type === "collection"
                                ? (option.address ?? d.description)
                                : (option.estimate ?? d.description)}
                              {option.type === "collection" && option.hours
                                ? ` · ${option.hours}`
                                : ""}
                            </span>
                            {!free &&
                            option.freeOverCents !== null &&
                            option.feeCents > 0 ? (
                              <span className="text-muted block text-xs">
                                {interpolate(t.checkout.freeOver, {
                                  amount: formatMoney(
                                    option.freeOverCents,
                                    currency,
                                    locale,
                                  ),
                                })}
                              </span>
                            ) : null}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                  )}
                </fieldset>
              ) : null}

              {rails.length > 1 ? (
                <fieldset>
                  <legend className="mb-1.5 text-sm font-medium">
                    {t.checkout.howOrder}
                  </legend>
                  <div className="space-y-1.5">
                    {rails.map((m) => {
                      const d = railCopy(m.type, t);
                      const active = method === m.type;
                      return (
                        <label
                          key={m.type}
                          className={`flex cursor-pointer items-start gap-2.5 rounded-xl p-2.5 transition ${
                            active ? "surface-elevated" : "hover:opacity-70"
                          }`}
                        >
                          <input
                            type="radio"
                            name="paymentMethod"
                            value={m.type}
                            checked={active}
                            onChange={() => setChosen(m.type)}
                            className="mt-0.5 size-4 accent-current"
                          />
                          <span className="min-w-0">
                            <span className="block text-sm font-medium">
                              {m.label ?? d.name}
                            </span>
                            <span className="text-muted block text-xs leading-snug">
                              {d.description}
                            </span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </fieldset>
              ) : null}

              <div className="space-y-2.5">
                <input
                  name="customerName"
                  // Whose order it is. Every list, email and packing slip
                  // names the buyer, and named nobody without this.
                  required
                  placeholder={t.checkout.yourName}
                  autoComplete="name"
                  className="surface-elevated h-11 w-full rounded-xl px-3 text-sm outline-none placeholder:opacity-50"
                />
                <div className="grid grid-cols-2 gap-2">
                  <input
                    name="customerEmail"
                    type="email"
                    // Required outright when a receipt, a download or a ticket
                    // has to reach an inbox; otherwise required only while no
                    // phone number has been given.
                    required={emailRequired}
                    onChange={(e) => setEmailTyped(e.target.value)}
                    placeholder={
                      emailRequired ? t.checkout.email : t.checkout.emailOptional
                    }
                    autoComplete="email"
                    className="surface-elevated h-11 w-full rounded-xl px-3 text-sm outline-none placeholder:opacity-50"
                  />
                  <input
                    name="customerPhone"
                    type="tel"
                    required={phoneRequired}
                    onChange={(e) => setPhoneTyped(e.target.value)}
                    placeholder={
                      phoneRequired ? t.checkout.phone : t.checkout.phoneOptional
                    }
                    autoComplete="tel"
                    className="surface-elevated h-11 w-full rounded-xl px-3 text-sm outline-none placeholder:opacity-50"
                  />
                </div>
                {/* Why the shop is asking. Shown on every rail now, because
                    every rail needs one of the two fields above it. */}
                <p className="text-muted text-xs">
                  {interpolate(t.checkout.contactHint, { shop: shopName })}
                </p>
              </div>

              {needsAddress ? (
                <fieldset className="space-y-2.5">
                  <legend className="mb-1.5 text-sm font-medium">
                    {t.checkout.deliveryAddress}
                  </legend>
                  <input
                    name="addressLine1"
                    // The street and the town are what make this postable. The
                    // region and the postcode are left alone: plenty of real
                    // addresses have neither, and a required field an honest
                    // buyer cannot fill is worse than a blank one. The country
                    // is asked above the delivery options instead, because it
                    // decides which of them are on offer.
                    required
                    placeholder={t.checkout.street}
                    autoComplete="address-line1"
                    className="surface-elevated h-11 w-full rounded-xl px-3 text-sm outline-none placeholder:opacity-50"
                  />
                  <input
                    name="addressLine2"
                    placeholder={t.checkout.apartment}
                    autoComplete="address-line2"
                    className="surface-elevated h-11 w-full rounded-xl px-3 text-sm outline-none placeholder:opacity-50"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      name="city"
                      required
                      placeholder={t.checkout.city}
                      autoComplete="address-level2"
                      className="surface-elevated h-11 w-full rounded-xl px-3 text-sm outline-none placeholder:opacity-50"
                    />
                    <input
                      name="region"
                      placeholder={t.checkout.region}
                      autoComplete="address-level1"
                      className="surface-elevated h-11 w-full rounded-xl px-3 text-sm outline-none placeholder:opacity-50"
                    />
                  </div>
                  <input
                    name="postalCode"
                    placeholder={t.checkout.postalCode}
                    autoComplete="postal-code"
                    className="surface-elevated h-11 w-full rounded-xl px-3 text-sm outline-none placeholder:opacity-50"
                  />
                  {/*
                    Last, where an address ends and where a browser's autofill
                    expects to put it. It decides which delivery rates are
                    shown further up the form, which is why it used to sit
                    above them — the timezone guess is what makes asking here
                    safe, because a country is already filled in before the
                    rates first render.
                  */}
                  {countryMatters ? countryField(t.checkout.country, true) : null}
                </fieldset>
              ) : null}

              <textarea
                name="note"
                rows={2}
                placeholder={t.checkout.notes}
                className="surface-elevated w-full rounded-xl px-3 py-2.5 text-sm outline-none placeholder:opacity-50"
              />

              <div>
                {coupon.applied ? (
                  <div className="surface-elevated flex items-center justify-between gap-2 rounded-xl px-3 py-2.5">
                    <span className="text-sm">
                      <span className="font-semibold">{coupon.applied}</span>{" "}
                      <span className="text-muted">{t.checkout.applied}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => dispatchCoupon({ type: "cleared" })}
                      className="text-muted text-xs underline underline-offset-2 transition hover:opacity-70"
                    >
                      {t.checkout.remove}
                    </button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <input
                      value={coupon.input}
                      onChange={(e) => {
                        dispatchCoupon({ type: "typed", value: e.target.value.toUpperCase() });
                      }}
                      placeholder={t.checkout.discountCode}
                      aria-label={t.checkout.discountCode}
                      className="surface-elevated h-11 min-w-0 flex-1 rounded-xl px-3 text-sm uppercase outline-none placeholder:normal-case placeholder:opacity-50"
                    />
                    <button
                      type="button"
                      onClick={quote.applyCoupon}
                      disabled={coupon.checking || !coupon.input.trim()}
                      className="surface-card h-11 shrink-0 rounded-xl px-4 text-sm font-medium transition hover:opacity-70 disabled:opacity-40"
                    >
                      {coupon.checking ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        t.checkout.apply
                      )}
                    </button>
                  </div>
                )}
                {coupon.error ? (
                  <p className="mt-1.5 text-xs text-red-600">{coupon.error}</p>
                ) : null}
              </div>

              <dl className="surface-border space-y-1.5 border-t pt-3 text-sm">
                <div className="flex justify-between">
                  <dt className="text-muted">{t.checkout.subtotal}</dt>
                  <dd className="tabular-nums">
                    {formatMoney(totals.subtotalCents, currency, locale)}
                  </dd>
                </div>
                {totals.discountCents > 0 ? (
                  <div className="flex justify-between text-emerald-600">
                    <dt>{t.checkout.discount}</dt>
                    <dd className="tabular-nums">
                      −{formatMoney(totals.discountCents, currency, locale)}
                    </dd>
                  </div>
                ) : null}
                {showDelivery && selectedDelivery ? (
                  <div className="flex justify-between">
                    <dt className="text-muted">{selectedDelivery.name}</dt>
                    <dd className="tabular-nums">
                      {totals.deliveryFeeCents === 0
                        ? t.common.free
                        : formatMoney(totals.deliveryFeeCents, currency, locale)}
                    </dd>
                  </div>
                ) : null}
                {tax && totals.taxCents > 0 && !tax.inclusive ? (
                  <div className="flex justify-between">
                    <dt className="text-muted">
                      {tax.name} ({formatPercent(tax.rateBp)}%)
                    </dt>
                    <dd className="tabular-nums">
                      {formatMoney(totals.taxCents, currency, locale)}
                    </dd>
                  </div>
                ) : null}
                <div className="surface-border flex justify-between border-t pt-1.5 text-base font-semibold">
                  <dt>{t.checkout.total}</dt>
                  <dd className="tabular-nums">
                    {formatMoney(totals.totalCents, currency, locale)}
                  </dd>
                </div>
                {tax && totals.taxCents > 0 && tax.inclusive ? (
                  <p className="text-muted text-xs">
                    {interpolate(t.checkout.taxIncluded, {
                      amount: formatMoney(totals.taxCents, currency, locale),
                      name: tax.name,
                      percent: formatPercent(tax.rateBp),
                    })}
                  </p>
                ) : null}
              </dl>

              {hasFiles && heldUntilPaid ? (
                <p className="surface-elevated flex items-start gap-2 rounded-xl p-3 text-xs">
                  <Download className="mt-0.5 size-3.5 shrink-0 opacity-60" />
                  {interpolate(t.checkout.downloadAfterPayment, {
                    shop: shopName,
                  })}
                </p>
              ) : null}

              {/*
                Compliance, immediately above the button that commits.

                The terms box is `required`, which is what stops an honest
                buyer from missing it — the server refuses the order anyway,
                but being told no after filling in a whole checkout is a worse
                way to learn about a checkbox than not being able to submit.

                The consent box is never `defaultChecked`. Pre-ticked consent
                is not consent under the GDPR, and a default that happened to
                be convenient here would make every row this feature writes
                worthless as proof.
              */}
              {compliance.requireTerms || compliance.askMarketingConsent ? (
                <div className="space-y-2.5">
                  {compliance.requireTerms ? (
                    <div className="flex items-start gap-2.5">
                      <input
                        id="acceptedTerms"
                        type="checkbox"
                        name="acceptedTerms"
                        required
                        className="mt-0.5 size-4 shrink-0 accent-current pointer-coarse:size-5"
                      />
                      {/*
                        The label wraps the words and stops there. With the
                        anchor inside it, a tap on "read the terms" would
                        both open the tab and toggle the box the buyer was
                        trying to read about — so the link is its sibling.
                      */}
                      <span className="text-xs leading-snug">
                        <label htmlFor="acceptedTerms" className="cursor-pointer">
                          {t.checkout.termsAgree}
                        </label>
                        {compliance.termsUrl ? (
                          <>
                            {" "}
                            <a
                              href={compliance.termsUrl}
                              // A new tab, so the basket this buyer spent five
                              // minutes filling is still here when they come
                              // back from reading.
                              target="_blank"
                              rel="noopener noreferrer"
                              className="underline underline-offset-2 transition hover:opacity-70"
                            >
                              {t.checkout.termsView}
                            </a>
                          </>
                        ) : null}
                      </span>
                    </div>
                  ) : null}

                  {compliance.askMarketingConsent ? (
                    <label className="flex cursor-pointer items-start gap-2.5">
                      <input
                        type="checkbox"
                        name="marketingOptIn"
                        className="mt-0.5 size-4 shrink-0 accent-current pointer-coarse:size-5"
                      />
                      <span className="text-xs leading-snug">
                        {t.checkout.marketingOptIn}
                      </span>
                    </label>
                  ) : null}
                </div>
              ) : null}

              <button
                type="submit"
                // `noRoute` is the shop having nowhere to send this. The
                // server refuses it anyway, but letting the button be pressed
                // means filling in a whole checkout to be told no by an
                // answer the panel already had.
                disabled={pending || !preview || noRoute}
                className="accent-bg flex h-11 w-full items-center justify-center gap-2 rounded-xl text-sm font-semibold transition hover:opacity-90 disabled:opacity-60"
              >
                {pending ? <Loader2 className="size-4 animate-spin" /> : null}
                {rail.action}
              </button>

              <p className="text-muted text-center text-xs">
                {def.kind === "contact"
                  ? t.checkout.contactHandoffNote
                  : t.checkout.manualNote}
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

export type {
  CheckoutCompliance,
  CheckoutDelivery,
  CheckoutMethod,
  CheckoutPanelProps,
};
export { railCopy };
