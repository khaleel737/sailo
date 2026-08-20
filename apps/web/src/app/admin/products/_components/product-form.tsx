"use client";

import { startTransition, useActionState, useRef, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { saveProduct } from "@/lib/actions/products";
import { ImageUploader } from "./image-uploader";
import {
  Alert,
  Button,
  Card,
  Field,
  Input,
  Select,
  Stepper,
  Textarea,
} from "@sailo/design-system/web";
import { cn } from "@sailo/design-system/web/cn";
import { centsToAmount } from "@sailo/core/currency";
import { isProductKind, type ProductKind } from "@sailo/core/variants";
import { useAdminT } from "@/app/admin/_components/admin-i18n";
import { priceIn } from "@sailo/core/regional";
import { Toggle } from "./toggle";
import { KindTabs, KIND_PANEL_ID } from "./kind-tabs";
import { StockCard } from "./stock-card";
import { PricingCard } from "./pricing-card";
import { PhysicalSettingsCard } from "./physical-settings-card";
import { DigitalDeliveryCard } from "./digital-delivery-card";
import { ServiceSettingsCard, type ServiceStaff } from "./service-settings-card";
import { EventSettingsCard } from "./event-settings-card";
import { MembershipSettingsCard } from "./membership-settings-card";
import { LeadSettingsCard } from "./lead-settings-card";
import type { ProductWithRelations } from "./product.types";
import { interpolate } from "@sailo/i18n";
import type { Category } from "@sailo/db/schema";

/**
 * Adding or editing a product.
 *
 * The shape of this form is one decision: what is being sold. It used to be a
 * `<select>` sitting fifth, between the price and the category, and the fields
 * it governed appeared a screen and a half further down — so a seller adding
 * an event met the date field only if they scrolled past Options, and plenty
 * did not. The kind is now the first thing on the page and everything it
 * governs is in a panel plainly beneath it.
 *
 * WHAT IS IN THE PANEL AND WHAT IS NOT
 *
 * The panel holds what differs by kind: the kind's own card, and the stock
 * card whose three controls mean a shelf, a room or a diary depending on
 * which tab is lit. Outside it are the four things every kind has — what it
 * is called, what it costs, what it is filed under, and whether anyone can
 * see it. Moving those inside would have meant five copies of the title field
 * and five chances for one of them to drift.
 *
 * Only the active panel is rendered, which is what makes the exclusivity real
 * rather than visual: an input that is in the DOM is in the `FormData`, so a
 * hidden event panel would post a start time on a physical product.
 *
 * CREATING IS A FLOW, EDITING IS A PAGE
 *
 * A new product is five decisions asked one at a time — what is it, what is
 * it called, what does it cost, its kind's own questions, and whether people
 * can see it — behind a Stepper, the way onboarding already walks. Editing
 * keeps every card on one page, because editing is random access: a wizard
 * would put four clicks between a seller and a typo.
 *
 * The steps hide with CSS rather than unmounting, so every field a seller
 * has passed is still in the DOM and therefore still in the one `FormData`
 * this form submits. The kind panels keep their mount-only exclusivity —
 * that logic is untouched. A `required` field left empty on a hidden step
 * would make the browser try to focus something invisible at submit time, so
 * the form catches `invalid` and walks back to the step that owns the field
 * before asking the browser to say what's wrong.
 */

function Submit({ isEdit, pending }: { isEdit: boolean; pending: boolean }) {
  const a = useAdminT();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : null}
      {isEdit ? a.common.saveChanges : a.products.add}
    </Button>
  );
}

export function ProductForm({
  product,
  categories,
  currency,
  timeZone = "UTC",
  /** Whether the shop can take a card — a membership cannot be sold without one. */
  cardReady = false,
  pricingModes = false,
  pricingUpgradeTo = null,
  weightBands = false,
  codePools = false,
  licensing = false,
  membershipTerms = false,
  staffResources = false,
  roster = [],
  assignedStaffIds = [],
  regionalCurrencies = [],
}: {
  product?: ProductWithRelations;
  categories: Category[];
  currency: string;
  /** The shop's zone, so an event's clock is named rather than assumed. */
  timeZone?: string;
  cardReady?: boolean;
  /** Whether the plan includes PWYW and sell windows — spec 43. */
  pricingModes?: boolean;
  /** The cheapest plan that does, named in the upgrade line. */
  pricingUpgradeTo?: string | null;
  /** Whether the plan prices postage by weight — spec 51, for the hint only. */
  weightBands?: boolean;
  /** Whether the plan hands each buyer their own code — spec 48. */
  codePools?: boolean;
  /** Whether the plan issues checkable licence keys — spec 48. */
  licensing?: boolean;
  /** Whether the plan includes fixed terms and pause — spec 49. */
  membershipTerms?: boolean;
  /** Whether the plan includes staff and classes — spec 51. */
  staffResources?: boolean;
  /**
   * The shop's roster, and who is already named on this service — spec 51.
   *
   * Both read at the page rather than in the card, so the card stays a client
   * component with no database of its own. Only the id, the name and whether
   * they are still taking bookings cross the boundary; the rest of a staff row
   * is somebody's working week and their calendar address.
   */
  roster?: ServiceStaff[];
  assignedStaffIds?: string[];
  /**
   * The other currencies the shop quotes — spec 53.
   *
   * Empty for every shop that has ticked none, which renders no extra fields
   * at all. Already filtered by the plan at the page, because a downgraded
   * shop keeps its typed prices and stops being able to edit them.
   */
  regionalCurrencies?: string[];
}) {
  const a = useAdminT();
  const [state, action, pending] = useActionState(saveProduct, { ok: false });
  const isEdit = Boolean(product);

  /*
   * The guided flow — creation only; editing renders every card at once.
   * `step` is which of the five is visible; the rest stay mounted but hidden
   * so their fields survive into the final FormData.
   */
  const flow = !isEdit;
  const [step, setStep] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);
  const stepLabels = [
    a.productForm.stepKind,
    a.productForm.stepBasics,
    a.productForm.stepPrice,
    a.productForm.stepDetails,
    a.productForm.stepFinish,
  ];
  const lastStep = stepLabels.length - 1;

  /** One named control, straight off the live form. */
  const control = (name: string) =>
    formRef.current?.elements.namedItem(name) as HTMLInputElement | null;

  const goForward = () => {
    /*
     * The two gates a seller can actually fail early: a product needs a name
     * before anything else makes sense, and a price before its kind's own
     * questions do. The browser says what's wrong, on the field itself.
     */
    if (step === 1) {
      const title = control("title");
      if (title && !title.value.trim()) {
        title.reportValidity();
        return;
      }
    }
    if (step === 2) {
      const priceField = control("price");
      if (priceField && !priceField.value.trim()) {
        priceField.reportValidity();
        return;
      }
    }
    setStep((s) => Math.min(s + 1, lastStep));
  };

  // The form shows different sections per kind and per toggle, so these are
  // held in state rather than read back from the DOM.
  const [kind, setKind] = useState<ProductKind>(() =>
    isProductKind(product?.kind ?? "") ? (product?.kind as ProductKind) : "physical",
  );
  const [trackInventory, setTrackInventory] = useState(
    product?.trackInventory ?? false,
  );
  const [price, setPrice] = useState(
    product ? centsToAmount(product.priceCents, currency) : "",
  );
  const [bookingEnabled, setBookingEnabled] = useState(
    product?.bookingEnabled ?? false,
  );
  const [releaseOnPayment, setReleaseOnPayment] = useState(
    product?.releaseOnPayment ?? true,
  );

  /*
   * A membership is one thing at one price, sold one at a time — Stripe prices
   * the product and `resolveLines` forces the quantity to one — so it gets no
   * strike-through and no stock card. Both would be controls whose values the
   * checkout ignores.
   */
  const membership = kind === "membership";

  /*
   * A render helper, not a component: a component defined inside render gets
   * a new identity every pass and remounts its children — which empties every
   * uncontrolled field it wraps. A function that returns JSX reconciles.
   */
  const wrapStep = (index: number, node: React.ReactNode) =>
    flow ? (
      <div
        key={index}
        data-step={index}
        className={cn("space-y-5", step === index ? "animate-rise" : "hidden")}
      >
        {node}
      </div>
    ) : (
      node
    );

  /* One jump per validation burst — see the header comment. */
  const invalidJumped = useRef(false);

  return (
    <form
      /*
       * Submitted by hand rather than through `action={action}`, and the
       * reason is a refusal.
       *
       * React resets an uncontrolled form once a form action completes — it
       * cannot know whether the action succeeded, so it resets either way.
       * On this form that meant a seller who was told "add the code buyers get
       * after paying" watched their title, description, tags and every other
       * typed field empty themselves at the same moment. The one refusal they
       * could act on cost them everything else they had written.
       *
       * Dispatching inside a transition ourselves keeps React out of the
       * submit, so the DOM is left exactly as the seller left it and the
       * message tells them the one thing to change. `required` still runs
       * first: the browser validates before it fires `submit` at all.
       */
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        startTransition(() => action(data));
      }}
      /*
       * A `required` field left empty on a hidden step would make the browser
       * try to focus something invisible and give up silently. Walk to the
       * step that owns the first invalid field, then let the browser speak.
       */
      onInvalidCapture={(event) => {
        if (!flow) return;
        const el = event.target as HTMLInputElement;
        if (invalidJumped.current) {
          event.preventDefault();
          return;
        }
        invalidJumped.current = true;
        setTimeout(() => {
          invalidJumped.current = false;
        }, 0);

        const holder = el.closest<HTMLElement>("[data-step]");
        const owner = holder ? Number(holder.dataset.step) : null;
        if (owner !== null && owner !== step) {
          event.preventDefault();
          setStep(owner);
          requestAnimationFrame(() => el.reportValidity());
        }
      }}
      ref={formRef}
      className="space-y-5"
    >
      {product ? <input type="hidden" name="id" value={product.id} /> : null}

      {state.error ? <Alert>{state.error}</Alert> : null}
      {state.ok && state.message ? (
        <Alert tone="success">{state.message}</Alert>
      ) : null}

      {flow ? (
        <Stepper steps={stepLabels} current={step} className="px-1 pb-1" />
      ) : null}

      {/* ---- What is being sold ------------------------------------------ */}

      {wrapStep(
        0,
        <Card className="space-y-4 p-5">
          <div>
            <h2 className="text-sm font-semibold text-ink-900">
              {a.productForm.kindTitle}
            </h2>
            <p className="mt-0.5 text-xs leading-relaxed text-ink-500">
              {a.productForm.kindBody}
            </p>
          </div>
          <KindTabs value={kind} onChange={setKind} />
        </Card>,
      )}

      {/* ---- The four things every kind has ------------------------------- */}

      {wrapStep(
        1,
        <Card className="space-y-4 p-5">
        <Field label={a.productForm.titleLabel} htmlFor="title">
          <Input
            id="title"
            name="title"
            required
            maxLength={140}
            defaultValue={product?.title}
            placeholder={a.productForm.titlePlaceholder}
          />
        </Field>

        <Field
          label={a.productForm.descriptionLabel}
          htmlFor="description"
          hint={a.common.optional}
        >
          <Textarea
            id="description"
            name="description"
            rows={4}
            defaultValue={product?.description ?? ""}
            placeholder={a.productForm.descriptionPlaceholder}
          />
        </Field>

        <Field label={a.productForm.photos}>
          <ImageUploader initial={product?.images.map((i) => i.url) ?? []} />
        </Field>
      </Card>,
      )}

      {wrapStep(
        2,
        <>
      <Card className="space-y-4 p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={interpolate(
              membership ? a.productForm.priceEach : a.productForm.price,
              { currency },
            )}
            htmlFor="price"
          >
            <Input
              id="price"
              name="price"
              inputMode="decimal"
              required
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="24.00"
            />
          </Field>

          {membership ? null : (
            <Field
              label={a.productForm.compareAt}
              htmlFor="compareAtPrice"
              hint={a.common.optional}
            >
              <Input
                id="compareAtPrice"
                name="compareAtPrice"
                inputMode="decimal"
                defaultValue={
                  product?.compareAtCents
                    ? centsToAmount(product.compareAtCents, currency)
                    : ""
                }
                placeholder="32.00"
              />
            </Field>
          )}
        </div>

        {/*
          The same price again, in each currency the shop quotes — spec 53.

          One pair of fields per currency, right under the shop's own price
          rather than in a section of their own, because they are the same
          decision made a second time: what this product costs. A seller who
          has to go and find a "regional pricing" tab will price half a
          catalogue and leave the rest, and half a catalogue is exactly the
          state that keeps a currency from ever going live.

          Blank is not zero. A blank field means "no price in this currency",
          which keeps the currency off the storefront until it is filled in;
          `0` means free. `moneyToCents` keeps that distinction and
          `buildCurrencyPrices` drops the currency rather than storing a zero.
        */}
        {regionalCurrencies.map((code) => (
          <div key={code} className="grid gap-4 sm:grid-cols-2">
            <Field
              label={interpolate(a.productForm.price, { currency: code })}
              htmlFor={`price_${code}`}
              hint={a.common.optional}
            >
              <Input
                id={`price_${code}`}
                name={`price_${code}`}
                inputMode="decimal"
                defaultValue={
                  product ? centsToAmount(priceIn(product, code)?.price ?? null, code) : ""
                }
              />
            </Field>

            {membership ? null : (
              <Field
                label={interpolate(a.productForm.compareAtIn, { currency: code })}
                htmlFor={`compareAtPrice_${code}`}
                hint={a.common.optional}
              >
                <Input
                  id={`compareAtPrice_${code}`}
                  name={`compareAtPrice_${code}`}
                  inputMode="decimal"
                  defaultValue={
                    product
                      ? centsToAmount(priceIn(product, code)?.secondary ?? null, code)
                      : ""
                  }
                />
              </Field>
            )}
          </div>
        ))}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={a.productForm.category}
            htmlFor="categoryId"
            hint={a.common.optional}
          >
            <Select
              id="categoryId"
              name="categoryId"
              defaultValue={product?.categoryId ?? ""}
            >
              <option value="">{a.productForm.noCategory}</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label={a.productForm.tags}
            htmlFor="tags"
            hint={a.productForm.tagsHint}
          >
            <Input
              id="tags"
              name="tags"
              defaultValue={product?.tags.join(", ") ?? ""}
              placeholder={a.productForm.tagsPlaceholder}
            />
          </Field>
        </div>
      </Card>

      {/*
        How the price is arrived at, and when it is on sale — spec 43.

        Outside the kind panel and directly under the price it modifies: a
        launch window is as meaningful on a run of mugs as on a download, and a
        donation is a digital product with a floor of zero rather than a kind of
        its own. A membership is the one refusal — a recurring buyer-chosen
        amount is a Stripe Price per buyer — so it is not offered one.
      */}
      {membership ? null : (
        <PricingCard
          product={product}
          currency={currency}
          timeZone={timeZone}
          allowed={pricingModes}
          upgradeTo={pricingUpgradeTo}
        />
      )}
        </>,
      )}

      {/* ---- This kind's own settings ------------------------------------- */}

      {wrapStep(
        3,
      <div
        id={KIND_PANEL_ID}
        role="tabpanel"
        aria-labelledby={`product-kind-tab-${kind}`}
        /*
         * Focusable, per the APG: the panel holds its own controls, so it is
         * not a `tabindex="0"` container — the tab order goes straight from
         * the tablist into the first field inside it.
         */
        className="space-y-5"
      >
        {kind === "physical" ? (
          <PhysicalSettingsCard product={product} weightBands={weightBands} />
        ) : null}

        {kind === "digital" ? (
          <DigitalDeliveryCard
            product={product}
            releaseOnPayment={releaseOnPayment}
            onReleaseOnPaymentChange={setReleaseOnPayment}
            codePools={codePools}
            licensing={licensing}
          />
        ) : null}

        {kind === "service" ? (
          <ServiceSettingsCard
            staffResources={staffResources}
            roster={roster}
            assignedStaffIds={assignedStaffIds}
            product={product}
            bookingEnabled={bookingEnabled}
            onBookingEnabledChange={setBookingEnabled}
          />
        ) : null}

        {kind === "event" ? (
          <EventSettingsCard
            product={product}
            releaseOnPayment={releaseOnPayment}
            onReleaseOnPaymentChange={setReleaseOnPayment}
            timeZone={timeZone}
          />
        ) : null}

        {kind === "membership" ? (
          <MembershipSettingsCard
            product={product}
            currency={currency}
            connected={cardReady}
            membershipTerms={membershipTerms}
          />
        ) : null}

        {kind === "lead" ? <LeadSettingsCard product={product} /> : null}

        {/*
          A form has no stock and no price. `membership` was already excluded
          for the same reason — a thing that renews is not a thing there are
          five of — and a lead is the second: there is nothing to run out of,
          and a "sold out" enquiry form is a sentence with no meaning.
        */}
        {membership || kind === "lead" ? null : (
          <StockCard
            kind={kind}
            product={product}
            currency={currency}
            price={price}
            /* Spec 33's preorder date is wall-clock in the shop's own zone,
               like spec 43's two window fields. */
            timeZone={timeZone}
            trackInventory={trackInventory}
            onTrackInventoryChange={setTrackInventory}
            regionalCurrencies={regionalCurrencies}
          />
        )}
      </div>,
      )}

      {/* ---- Visibility --------------------------------------------------- */}

      {wrapStep(
        4,
        <>
      <Card className="space-y-3 p-5">
        <Toggle
          name="inStock"
          label={a.productForm.inStock}
          description={a.productForm.inStockBody}
          defaultChecked={product?.inStock ?? true}
        />
        <Toggle
          name="isFeatured"
          label={a.productForm.featured}
          description={a.productForm.featuredBody}
          defaultChecked={product?.isFeatured ?? false}
        />
        <Toggle
          name="isPublished"
          label={a.productForm.published}
          description={a.productForm.publishedBody}
          defaultChecked={product?.isPublished ?? true}
        />
      </Card>

      </>,
      )}

      {flow ? (
        /*
         * The flow's own footer: back on the start side, forward on the end
         * side, and the real submit only where the seller can see everything
         * they are about to publish.
         */
        <div className="flex items-center justify-between gap-3">
          <div>
            {step > 0 ? (
              <Button type="button" variant="ghost" onClick={() => setStep(step - 1)}>
                {a.common.back}
              </Button>
            ) : (
              <Link
                href="/admin/products"
                className="focus-ring inline-flex items-center rounded px-1 text-sm text-ink-500 transition hover:text-ink-900 pointer-coarse:min-h-11"
              >
                {a.common.cancel}
              </Link>
            )}
          </div>
          {step < lastStep ? (
            <Button type="button" onClick={goForward}>
              {a.common.continue}
            </Button>
          ) : (
            <Submit isEdit={isEdit} pending={pending} />
          )}
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <Submit isEdit={isEdit} pending={pending} />
          <Link
            href="/admin/products"
            className="focus-ring inline-flex items-center rounded text-sm text-ink-500 transition hover:text-ink-900 pointer-coarse:min-h-11"
          >
            {a.common.cancel}
          </Link>
        </div>
      )}
    </form>
  );
}
