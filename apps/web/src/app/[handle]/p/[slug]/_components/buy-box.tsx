"use client";

import { useEffect, useState } from "react";
import type { CheckoutField } from "@/app/[handle]/_components/cart/custom-fields";
import { Check, Minus, Plus, ShoppingBag } from "lucide-react";
import {
  ExpressCheckout,
  type CheckoutCompliance,
  type CheckoutDelivery,
  type CheckoutMethod,
  type CheckoutService,
} from "@/app/[handle]/_components/cart/express-checkout";
import { useCart } from "@/app/[handle]/_components/cart/cart-provider";
import { FavoriteButton } from "@/app/[handle]/_components/favorites/favorite-button";
import { OptionChips } from "@/app/[handle]/_components/option-chips";
import { useVariantPhoto } from "./variant-photo";
import { isSoldOut } from "@/app/[handle]/_lib/availability";
import type { Dictionary } from "@sailo/i18n";
import { interpolate } from "@sailo/i18n";
import { formatMoney } from "@sailo/core/currency";
import {
  findVariant,
  isLowStock,
  quantityCeiling,
  retargetSelection,
  variantLabel,
  type CheckoutVariant,
} from "@sailo/core/variants";
import { railsForOrder } from "@/lib/payments";
import { AmountField, suggestedText } from "@/app/[handle]/_components/amount-field";
import { StockRequestForm } from "@/app/[handle]/_components/stock-request-form";
import type { SellWindowState } from "@sailo/core/pricing-models";
import type { ProductOption, VariantOptions } from "@sailo/db/schema";

/**
 * The buying half of the product page: price, choices, quantity, and the two
 * ways out — into the basket, or straight through checkout.
 *
 * This is where the choosing happens now. The card sends every buyer here,
 * the price on screen is always the price of the exact combination picked,
 * and "Buy now" carries that combination into checkout without asking again.
 * The old page showed options as a read-only list and made the buyer pick
 * them inside a sheet that covered the photos they were picking from.
 */
export function BuyBox({
  shopId,
  shopName,
  productId,
  slug,
  productTitle,
  priceCents,
  compareAtCents,
  currency,
  inStock,
  salesOpen,
  methods,
  deliveryOptions,
  blockedCountries,
  kind,
  billingInterval,
  canPayInPerson,
  options,
  variants,
  unitsLeft,
  maxPerOrder = null,
  pricingMode = "fixed",
  pwywFloorCents = 0,
  pwywSuggestedCents = 0,
  windowState = "open",
  preorderEnabled = false,
  preorderExpectedAt = null,
  takesPhone = false,
  offersStockRequest = false,
  service = null,
  serviceLocation = null,
  imageUrl = null,
  hasFiles = false,
  heldUntilPaid = false,
  contactEmail,
  compliance,
  customFields,
  t,
}: {
  shopId: string;
  shopName: string;
  productId: string;
  slug: string;
  productTitle: string;
  priceCents: number;
  compareAtCents: number | null;
  currency: string;
  inStock: boolean;
  /** False once an event's start time has passed. */
  salesOpen: boolean;
  methods: CheckoutMethod[];
  deliveryOptions: CheckoutDelivery[];
  blockedCountries: string[];
  kind: string;
  /** `month` or `year` for a membership; null for everything else. */
  billingInterval?: string | null;
  /**
   * Whether a pay-in-person rail belongs on this product, decided on the
   * server by `cartCanPayInPerson` so the button, the sheet and the order all
   * answer from the same place.
   */
  canPayInPerson: boolean;
  options: ProductOption[];
  variants: CheckoutVariant[];
  /** Units left on the product itself, when it has no options. */
  unitsLeft: number | null;
  /**
   * The seller's cap on one order — four tickets a head, two per customer.
   *
   * A separate answer from stock, and both apply: a room of 200 that will not
   * sell anybody a fifth seat is refusing on this, not on supply. The server
   * clamps against it too, in `maxOrderable`, because a quantity arrives from
   * a browser and this control is only the polite half of the rule.
   */
  maxPerOrder?: number | null;
  /**
   * `fixed` or `pwyw` — spec 43. On `pwyw` the price is a field rather than a
   * number, and everything below reads the buyer's amount where it would
   * otherwise read the variant's.
   */
  pricingMode?: string;
  /** The seller's floor, in minor units. Zero means free is allowed. */
  pwywFloorCents?: number;
  /** What the field opens on. */
  pwywSuggestedCents?: number;
  /**
   * Whether this product is inside its sell window, decided on the server
   * against a fresh clock — spec 43.
   *
   * A prop rather than something computed here, and that is the whole of the
   * caching answer: `getProductBySlug` is `"use cache"` with `cacheLife("max")`
   * and never expires on a clock, so a boundary decided *inside* it would be
   * frozen into an entry that outlives the window. The cached thing is the row;
   * the decision is taken per request from `now`, exactly as `eventSalesOpen`
   * already is one line away.
   */
  windowState?: SellWindowState;
  /**
   * Whether this seller takes orders against stock that has not arrived —
   * spec 33.
   *
   * Decided on the server so the button and the checkout answer from the same
   * place: `resolveLines` lets a sold-out line through on exactly this
   * condition, and a button that offered a preorder the order would refuse
   * would be a dead tap on the one control the page exists for.
   */
  preorderEnabled?: boolean;
  /**
   * The date the buyer is shown **before** they commit, already resolved to
   * this combination where it has its own.
   *
   * Null is "no date given", which renders as that. It is never a blank: a
   * blank reads as a date that failed to load and a buyer will wait for it.
   */
  preorderExpectedAt?: Date | null;
  /** Whether the shop runs a chat rail, so a phone is worth collecting. */
  takesPhone?: boolean;
  /**
   * Whether "tell me when it's back" belongs on this product — spec 33.
   *
   * Decided on the server by `offersStockRequest`, which is the same predicate
   * the storefront card asks. Passed rather than re-derived because the rule
   * involves the sell window and the preorder switch as well as stock, and a
   * second copy of it here is a second answer.
   */
  offersStockRequest?: boolean;
  service?: CheckoutService | null;
  serviceLocation?: string | null;
  imageUrl?: string | null;
  hasFiles?: boolean;
  heldUntilPaid?: boolean;
  contactEmail: string | null;
  compliance: CheckoutCompliance;
  customFields: CheckoutField[];
  t: Dictionary;
}) {
  const cart = useCart();
  const locale = cart?.locale;

  // Open on something the buyer can actually have.
  const [selection, setSelection] = useState<VariantOptions>(
    () => (variants.find((v) => v.available) ?? variants[0])?.options ?? {},
  );
  const variant = variants.length
    ? (findVariant(variants, selection) ?? null)
    : null;

  const unitPriceCents = variant?.priceCents ?? priceCents;
  const wasPriced = variant ? variant.compareAtCents : compareAtCents;
  const stockLeft = variant ? variant.unitsLeft : unitsLeft;
  /*
   * `quantityCeiling`, not a third copy of the same three comparisons. It is
   * what `maxOrderable` is built from, and `maxOrderable` is what the checkout
   * clamps with — so the number this stepper can reach is the number the order
   * will honour.
   *
   * `Math.max(1, …)` keeps the control legal when the answer is zero: a
   * sold-out product is refused by `soldOut` below, not by a picker whose only
   * value is none.
   */
  const maxQuantity = Math.max(1, quantityCeiling(stockLeft, maxPerOrder));

  const [quantity, setQuantity] = useState(1);
  const [justAdded, setJustAdded] = useState(false);
  const [buying, setBuying] = useState(false);

  /*
   * The buyer's own number, on a pay-what-you-want product — spec 43.
   *
   * Held as the text they typed rather than as cents, so a half-finished "12."
   * survives the keystroke instead of collapsing to a number and moving their
   * cursor. `chosenCents` is what travels.
   */
  const pwyw = pricingMode === "pwyw";
  const [amount, setAmount] = useState(() =>
    suggestedText(pwywSuggestedCents, currency),
  );
  const [amountCents, setAmountCents] = useState(pwywSuggestedCents);

  /*
   * What this line is worth, whichever mode the product is in.
   *
   * Clamped here only so the drawer and the button read the same number the
   * server will settle on — the floor that actually decides is `resolveLines`,
   * which re-applies it to whatever arrives. A buyer who empties the field gets
   * the floor rather than a zero, which is what the server would give them.
   */
  const chosenCents = pwyw
    ? Math.max(pwywFloorCents, amountCents)
    : unitPriceCents;

  /*
   * Tell the gallery which photo the buyer is looking at, so choosing
   * "Charcoal" shows the charcoal one. In an effect because the gallery is a
   * sibling component: this is a render of one telling another to update, and
   * doing it during render is the one thing React genuinely forbids.
   */
  const photo = useVariantPhoto();
  const showPhoto = photo?.show;
  const chosenPhoto = variant?.imageUrl ?? null;
  useEffect(() => {
    showPhoto?.(chosenPhoto);
  }, [showPhoto, chosenPhoto]);

  const soldOut = isSoldOut({ inStock, variants, unitsLeft });
  /*
   * The rails this product can be bought on, which is not always every rail
   * the shop runs: cash on delivery promises a moment where the money changes
   * hands, and a download and a video call have none. A shop whose only rail
   * is that one genuinely cannot sell either, and saying so on the button
   * beats opening a sheet with nothing in it.
   */
  const rails = railsForOrder(methods, canPayInPerson);
  const noRails = rails.length === 0;
  /*
   * Outside its sell window, this product cannot be bought — spec 43.
   *
   * The button is the polite half. `resolveLines` refuses the order whatever
   * this says, which is what makes a page opened before the window closed
   * unable to complete after it; disabling here only saves the buyer from
   * filling in a sheet that was always going to be refused.
   */
  const windowClosed = windowState !== "open";

  /*
   * Sold out, or a preorder — spec 33.
   *
   * Three states rather than two, because collapsing them loses the sale
   * either way round: a buyer told "sold out" on something they could have
   * preordered leaves, and a buyer offered "preorder" on something in stock is
   * told a date that does not apply to them.
   *
   * A closed sell window is not a preorder. Spec 43's window says the seller
   * has not opened sales, or has closed them — taking money against that would
   * be selling something they deliberately took off sale.
   */
  const canPreorder = soldOut && preorderEnabled && !windowClosed && salesOpen;
  const disabled = (soldOut && !canPreorder) || !salesOpen || noRails || windowClosed;

  function chooseOption(name: string, value: string) {
    const target = retargetSelection(variants, selection, name, value);
    if (!target) return;
    setSelection(target.options);
    // The new combination may hold fewer units than the old quantity.
    const left = target.unitsLeft;
    if (left !== null) setQuantity((q) => Math.min(q, Math.max(1, left)));
  }

  function addToBasket() {
    if (!cart) return;
    cart.add({
      productId,
      variantId: variant?.id ?? null,
      quantity,
      title: productTitle,
      label: variant ? variantLabel(variant.options, options) : "",
      kind,
      unitPriceCents: chosenCents,
      /*
       * Only on a pay-what-you-want line, and this is the one number in the
       * basket that is not a cache. `toOrderItems` sends it; `resolveLines`
       * clamps it to the seller's floor. Left undefined on a fixed-price line
       * so nothing downstream has to decide whether to believe it.
       */
      priceCents: pwyw ? chosenCents : undefined,
      imageUrl: variant?.imageUrl ?? imageUrl ?? null,
    });
    setJustAdded(true);
    window.setTimeout(() => setJustAdded(false), 1600);
  }

  /*
   * A membership never joins a basket.
   *
   * The checkout it needs is a different Stripe mode, and one session cannot
   * be both — so "Add to basket" beside it would build a cart that has no way
   * to be paid for, and the buyer would only find out at the end. The button
   * says what it does instead, and goes straight to the subscribe flow.
   */
  const isMembership = kind === "membership";

  /*
   * One label, and the order of these branches is the order of the reasons.
   *
   * The window comes before "sold out" deliberately: a product that is not
   * released yet has no stock question to answer, and telling a buyer something
   * is sold out when the seller has simply not opened sales is both wrong and
   * the kind of wrong that costs the sale — they will not come back on Friday
   * for something they were told had run out.
   */
  const primaryLabel = noRails
    ? t.shop.unavailable
    : windowState === "early"
      ? t.pricing.notYetOnSale
      : windowState === "ended"
        ? t.pricing.noLongerAvailable
        : canPreorder
          ? t.stock.preorder
          : soldOut
            ? t.shop.soldOut
            : !salesOpen
              ? t.shop.salesClosed
              : isMembership
                ? t.shop.subscribeNow
                : null;

  return (
    <div className="space-y-4">
      <div className="flex items-baseline gap-2">
        <span className="text-xl font-semibold tabular-nums">
          {/*
            A pay-what-you-want product has no price to print — the number is
            the field below, and printing the suggestion up here as though it
            were the price is how a buyer comes to believe they were quoted one.
          */}
          {pwyw
            ? t.pricing.payWhatYouWant
            : unitPriceCents > 0
              ? formatMoney(unitPriceCents, currency, locale)
              : t.common.free}
        </span>
        {/* The interval belongs beside the number, not in a line underneath:
            a price with no cadence is the single most misread thing on a
            membership page. */}
        {isMembership ? (
          <span className="text-muted text-sm">
            {billingInterval === "year" ? t.shop.perYear : t.shop.perMonth}
          </span>
        ) : null}
        {/*
          No strike-through on a buyer-chosen amount: there is no "was" price,
          so a higher number crossed out beside it advertises a saving against
          nothing.
        */}
        {!pwyw && wasPriced !== null && wasPriced > unitPriceCents ? (
          <span className="text-muted text-sm line-through tabular-nums">
            {formatMoney(wasPriced, currency, locale)}
          </span>
        ) : null}
      </div>

      <OptionChips
        options={options}
        variants={variants}
        selection={selection}
        onChoose={chooseOption}
        t={t}
      />

      {/*
        The promised date, above the button and before the buyer commits — spec
        33, and the entire risk this feature adds.

        A card payment for goods that arrive six weeks later is a chargeback
        waiting to happen if the buyer was never told six weeks. It is recorded
        on the order too, so a `product_not_received` case can show what was
        *promised* rather than what was hoped.

        No date renders as "no date yet" and never as a blank: a blank reads as
        a date that failed to load, and a buyer will wait for it.

        The refund line says that a policy exists, not what it is. What it says
        is the seller's business; that it exists is not.
      */}
      {canPreorder ? (
        <div className="surface-elevated space-y-1 rounded-xl p-3 text-sm">
          <p className="font-medium">
            {preorderExpectedAt
              ? interpolate(t.stock.expected, {
                  date: preorderExpectedAt.toLocaleDateString(locale, {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  }),
                })
              : t.stock.noDate}
          </p>
          <p className="text-muted text-xs">
            {interpolate(t.stock.refundNote, { shop: shopName })}
          </p>
        </div>
      ) : null}

      {pwyw && !disabled ? (
        <AmountField
          currency={currency}
          locale={locale}
          floorCents={pwywFloorCents}
          value={amount}
          onChange={(next) => {
            setAmount(next.text);
            setAmountCents(next.cents);
          }}
          t={t}
        />
      ) : null}

      {salesOpen && isLowStock(stockLeft) ? (
        <p className="text-sm font-medium text-amber-600">
          {interpolate(t.checkout.onlyLeft, { count: stockLeft })}
        </p>
      ) : null}

      {!disabled ? (
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">{t.checkout.quantity}</span>
          <div className="surface-elevated flex items-center rounded-lg">
            <button
              type="button"
              onClick={() => setQuantity((q) => Math.max(1, q - 1))}
              aria-label={t.checkout.decrease}
              /* 36px, and this is the control a buyer uses to say how many
                 they want — sitting immediately beside its opposite. A miss
                 here is not a dead tap, it is one fewer or one more of
                 something they are about to pay for. */
              className="flex size-9 items-center justify-center transition pointer-coarse:size-11 hover:opacity-60"
            >
              <Minus className="size-4" />
            </button>
            <span className="w-8 text-center text-sm font-semibold tabular-nums">
              {quantity}
            </span>
            <button
              type="button"
              disabled={quantity >= maxQuantity}
              onClick={() => setQuantity((q) => Math.min(maxQuantity, q + 1))}
              aria-label={t.checkout.increase}
              className="flex size-9 items-center justify-center transition pointer-coarse:size-11 hover:opacity-60 disabled:cursor-not-allowed disabled:opacity-30"
            >
              <Plus className="size-4" />
            </button>
          </div>
        </div>
      ) : null}

      <div className="space-y-2">
        <div className="flex gap-2">
          {cart && !isMembership ? (
            <button
              type="button"
              disabled={disabled}
              onClick={addToBasket}
              className="accent-bg flex h-12 min-w-0 flex-1 items-center justify-center gap-2 rounded-xl text-sm font-semibold transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {justAdded ? (
                <>
                  <Check className="size-4" />
                  {t.cart.added}
                </>
              ) : (
                <>
                  <ShoppingBag className="size-4" />
                  {primaryLabel ?? t.cart.add}
                </>
              )}
            </button>
          ) : null}

          <FavoriteButton
            shopId={shopId}
            item={{
              productId,
              slug,
              title: productTitle,
              imageUrl: imageUrl ?? null,
              priceCents: unitPriceCents,
            }}
            label={t.shop.saveToFavorites}
            look="flat"
            className="size-12 shrink-0"
          />
        </div>

        <button
          type="button"
          disabled={disabled}
          onClick={() => setBuying(true)}
          className={`h-12 w-full rounded-xl text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${
            cart
              ? "surface-elevated hover:opacity-70"
              : "accent-bg hover:opacity-90"
          }`}
        >
          {cart && !isMembership
            ? t.cart.buyNow
            : (primaryLabel ?? t.shop.orderNow)}
        </button>
      </div>

      {/*
        "Tell me when the blue medium is back" — spec 33, and it is *inside* the
        buy box on purpose.
        
        `variant_id` is the subject of the request, not `product_id`: notifying
        somebody because the red one arrived is the failure that turns a helpful
        message into a complaint. The picker lives here, so this is the only
        place on the page that knows which combination the buyer means. Rendered
        below the buttons because it is what a buyer reads *after* finding they
        cannot buy.
      */}
      {offersStockRequest && soldOut && !canPreorder ? (
        <div className="pt-1">
          <StockRequestForm
            shopId={shopId}
            productId={productId}
            /*
             * Null for a product sold as one thing, which is exactly what the
             * column means — the claim compares with `is not distinct from`
             * rather than `=` for this case.
             */
            variantId={variant?.id ?? null}
            takesPhone={takesPhone}
            locale={locale}
            t={t}
          />
        </div>
      ) : null}

      {buying ? (
        <ExpressCheckout
          shopId={shopId}
          shopName={shopName}
          productId={productId}
          productTitle={productTitle}
          currency={currency}
          variant={variant}
          options={options}
          quantity={quantity}
          unitPriceCents={chosenCents}
          pwywCents={pwyw ? chosenCents : undefined}
          methods={methods}
          deliveryOptions={deliveryOptions}
          blockedCountries={blockedCountries}
          kind={kind}
          canPayInPerson={canPayInPerson}
          service={service}
          serviceLocation={serviceLocation}
          imageUrl={imageUrl}
          hasFiles={hasFiles}
          heldUntilPaid={heldUntilPaid}
          contactEmail={contactEmail}
          compliance={compliance}
          customFields={customFields}
          t={t}
          onClose={() => setBuying(false)}
        />
      ) : null}
    </div>
  );
}
