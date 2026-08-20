import { minorPerMajor } from "../money/currency";
import type {
  Automation,
  AutomationRun,
  BookingClaim,
  Client,
  ContactListRow,
  Dispute,
  Order,
  OrderItem,
  Product,
  ProductVariant,
  Shop,
  StaffResource,
  Subscription,
} from "@sailo/db/schema";

/**
 * What a Sailo object looks like to anything outside Sailo.
 *
 * **One vocabulary, two transports.** These same functions build the body of a
 * webhook and the body of a `GET /api/v1/orders/{id}`, and that is the point:
 * an integration that receives `order.paid` and then fetches the order to
 * check something sees identical field names in both, so a Zapier field map
 * built against one works against the other. Two shapes would be two sets of
 * documentation, two mental models, and a support question every week about
 * why `total` is an object here and a number there.
 *
 * It also fixes the direction of the dependency. Resources are the vocabulary;
 * a webhook is one way of shipping them. `./webhook-events` imports from here,
 * never the reverse.
 *
 * No `server-only` — nothing here touches the database. They take rows the
 * caller already holds and return plain JSON, which is what makes them
 * testable without a database and safe for the docs page to describe.
 *
 * In `@sailo/core` rather than `apps/web` because the phone emits webhooks too.
 * `@sailo/api` runs in `apps/api`, which cannot reach into the web app's tree,
 * and a payload built there has to be the *same* payload — a consumer must not
 * be able to tell which surface the seller was holding. `apps/web/src/lib/api/
 * resources.ts` is a re-export, so every REST endpoint and docs page that
 * imports it is untouched.
 *
 * **Nothing internal leaks.** No Stripe ids, no download tokens, no
 * `paymentProofUrl`, no seller's private `notes`. Each of those either
 * identifies an object in someone else's system, or is a credential, or is
 * something the seller wrote for themselves — and none of them are things a
 * consumer can act on.
 */

/* -------------------------------------------------------------------------- */
/*  Money                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Minor units as a decimal string — 4999 USD cents becomes `"49.99"`.
 *
 * Sent *alongside* the integer, never instead of it, because two readers want
 * different things. A program wants `cents`, which cannot lose a digit to
 * floating point. A person wiring a Zap wants something they can drop into an
 * email without a formatter step — and the single most common integration bug
 * is that person mapping the integer and mailing a customer "you paid 4999".
 *
 * Currency-aware rather than a division by 100: JPY has no minor unit at all
 * and JOD has three, so a fixed hundred is wrong for a fifth of the currencies
 * this app supports, and wrong by a factor of ten or a hundred when it is.
 */
export function decimalAmount(minor: number, currency: string): string {
  const per = minorPerMajor(currency);
  if (per === 1) return String(Math.round(minor));

  const negative = minor < 0;
  const abs = Math.abs(Math.round(minor));
  const digits = String(per).length - 1;
  const whole = Math.floor(abs / per);
  const fraction = String(abs % per).padStart(digits, "0");
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

/** `{ cents, amount, currency }`, so no caller has to remember to send both. */
export function money(minor: number | null, currency: string) {
  const cents = minor ?? 0;
  return { cents, amount: decimalAmount(cents, currency), currency };
}

/** ISO 8601 or null — never `undefined`, which JSON would drop entirely. */
export function iso(value: Date | null | undefined): string | null {
  return value ? new Date(value).toISOString() : null;
}

/* -------------------------------------------------------------------------- */
/*  Order                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * An order, as every `order.*` event and every `/orders` response describes it.
 *
 * One shape for all of them rather than a slimmer one per event: a consumer
 * writing against `order.paid` and later adding `order.refunded` should not
 * have to remap every field, and what differs between those two is which one
 * fired, not what an order is.
 *
 * The customer's name, email, phone and address are here. That is the same
 * personal data `exporters.ts` already writes into the orders CSV a seller can
 * download unaided, which is the boundary `docs/specs/16-outbound-webhooks.md`
 * drew — this does not widen it.
 */
export function orderResource(order: Order, items: readonly OrderItem[]) {
  const currency = order.currency;

  return {
    id: order.id,
    object: "order" as const,
    status: order.status,
    paymentStatus: order.paymentStatus,
    paymentMethod: order.paymentMethod,

    currency,
    subtotal: money(order.subtotalCents, currency),
    discount: money(order.discountCents, currency),
    deliveryFee: money(order.deliveryFeeCents, currency),
    tax: money(order.taxCents, currency),
    total: money(order.totalCents, currency),
    refunded: money(order.refundedCents, currency),

    itemCount: order.itemCount,

    customer: {
      clientId: order.clientId,
      name: order.customerName,
      email: order.customerEmail,
      phone: order.customerPhone,
    },

    address: {
      line1: order.addressLine1,
      line2: order.addressLine2,
      city: order.city,
      region: order.region,
      postalCode: order.postalCode,
      country: order.country,
    },

    delivery: {
      method: order.deliveryMethod,
      label: order.deliveryLabel,
      pickupLocation: order.pickupLocation,
      trackingCarrier: order.trackingCarrier,
      trackingNumber: order.trackingNumber,
      trackingUrl: order.trackingUrl,
      shippedAt: iso(order.shippedAt),
    },

    /*
     * Null rather than an object of nulls when there is no appointment. A
     * consumer branching on `booking` gets a truthy test that works; one
     * branching on `booking.scheduledFor` gets the same answer either way.
     */
    booking: order.scheduledFor
      ? {
          scheduledFor: iso(order.scheduledFor),
          serviceMode: order.serviceMode,
          serviceLocation: order.serviceLocation,
        }
      : null,

    coupon: order.couponCode ? { code: order.couponCode } : null,
    affiliate: order.affiliateCode ? { code: order.affiliateCode } : null,

    note: order.note,

    items: items.map((item) => ({
      id: item.id,
      productId: item.productId,
      variantId: item.variantId,
      title: item.title,
      variantLabel: item.variantLabel,
      sku: item.sku,
      kind: item.kind,
      quantity: item.quantity,
      unitPrice: money(item.unitPriceCents, currency),
      subtotal: money(item.subtotalCents, currency),
    })),

    createdAt: iso(order.createdAt),
    updatedAt: iso(order.updatedAt),
  };
}

/**
 * A stand-in order, for the "send test event" button on a shop that has never
 * had a real one.
 *
 * Built by handing `orderResource` a complete fabricated row rather than by
 * writing the JSON out by hand, and **every field is stated explicitly** — a
 * partial object would leave the untouched ones `undefined`, JSON would drop
 * them entirely, and the test payload would have a different set of keys from
 * a real one. That is precisely the failure the test button exists to prevent:
 * Zapier builds its whole field map from the first payload it receives, so a
 * seller who maps against a thin sample discovers the mismatch on their first
 * real sale.
 *
 * `resources.test.ts` compares its keys against a real order's and fails if
 * the two ever drift.
 */
export function sampleOrderResource(shop: Pick<Shop, "currency">) {
  const now = new Date();

  const order = {
    id: "00000000-0000-0000-0000-000000000000",
    status: "new",
    paymentStatus: "paid",
    paymentMethod: "card",
    currency: shop.currency,
    subtotalCents: 2500,
    discountCents: 0,
    deliveryFeeCents: 0,
    taxCents: 0,
    totalCents: 2500,
    refundedCents: 0,
    itemCount: 1,
    clientId: null,
    customerName: "Sample Buyer",
    customerEmail: "sample@example.com",
    customerPhone: null,
    addressLine1: null,
    addressLine2: null,
    city: null,
    region: null,
    postalCode: null,
    country: null,
    deliveryMethod: null,
    deliveryLabel: null,
    pickupLocation: null,
    trackingCarrier: null,
    trackingNumber: null,
    trackingUrl: null,
    shippedAt: null,
    scheduledFor: null,
    serviceMode: null,
    serviceLocation: null,
    couponCode: null,
    affiliateCode: null,
    note: null,
    createdAt: now,
    updatedAt: now,
  } as unknown as Order;

  const item = {
    id: "00000000-0000-0000-0000-000000000001",
    productId: null,
    variantId: null,
    title: "Sample product",
    variantLabel: null,
    sku: null,
    kind: "digital",
    quantity: 1,
    unitPriceCents: 2500,
    subtotalCents: 2500,
  } as unknown as OrderItem;

  return orderResource(order, [item]);
}

/* -------------------------------------------------------------------------- */
/*  Contact                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * A person on a shop's list.
 *
 * `marketingConsentAt` is the field that matters most here: an integration
 * pushing these into Kit or Mailchimp must be able to tell somebody who agreed
 * to be emailed from somebody who merely bought a thing, and a boolean could
 * not carry *when*. A null means no consent, and a consumer that mails them
 * anyway is doing so on its own authority rather than on ours.
 *
 * `notes` is absent by design — that column is the seller's private scratchpad
 * about a customer, and it is the last thing that should be syncable into a
 * third-party CRM by an integration nobody re-read.
 */
export function contactResource(client: Client) {
  return {
    id: client.id,
    object: "contact" as const,
    name: client.name,
    email: client.email,
    phone: client.phone,
    tags: client.tags,
    source: client.source,
    marketingConsentAt: iso(client.marketingConsentAt),
    address: {
      line1: client.addressLine1,
      line2: client.addressLine2,
      city: client.city,
      region: client.region,
      postalCode: client.postalCode,
      country: client.country,
    },
    createdAt: iso(client.createdAt),
    updatedAt: iso(client.updatedAt),
  };
}

/* -------------------------------------------------------------------------- */
/*  Product                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * A product, priced in the shop's currency.
 *
 * Products carry no currency of their own — a shop prices in one — so it is
 * passed in rather than guessed, and the money helper above needs it to know
 * how many decimal places the number has.
 *
 * `stock` is null when the product does not track inventory, which is a
 * different statement from zero. A consumer syncing stock levels into a
 * marketplace listing must not read "not counted" as "sold out".
 */
export function productResource(
  product: Product,
  currency: string,
  variants: readonly ProductVariant[] = [],
) {
  return {
    id: product.id,
    object: "product" as const,
    title: product.title,
    slug: product.slug,
    description: product.description,
    kind: product.kind,
    tags: product.tags,

    price: money(product.priceCents, currency),
    compareAt: product.compareAtCents === null ? null : money(product.compareAtCents, currency),

    trackInventory: product.trackInventory,
    stock: product.trackInventory ? product.stockQuantity : null,
    inStock: product.inStock,

    isPublished: product.isPublished,
    isFeatured: product.isFeatured,

    booking: product.bookingEnabled
      ? {
          durationMinutes: product.durationMinutes,
          serviceMode: product.serviceMode,
          leadHours: product.bookingLeadHours,
        }
      : null,

    event: product.eventStartsAt
      ? {
          startsAt: iso(product.eventStartsAt),
          endsAt: iso(product.eventEndsAt),
        }
      : null,

    membership: product.billingInterval
      ? {
          interval: product.billingInterval,
          /*
           * The interval and how many of them, because one without the other
           * is not a cycle: a mirror that read `month` and nothing else would
           * bill a quarterly membership every month. Stripe's own pair.
           */
          intervalCount: product.billingIntervalCount,
          trialDays: product.trialDays,
        }
      : null,

    variants: variants.map((variant) => ({
      id: variant.id,
      sku: variant.sku,
      options: variant.options,
      price: money(variant.priceCents ?? product.priceCents, currency),
      stock: product.trackInventory ? variant.stockQuantity : null,
      isAvailable: variant.isAvailable,
    })),

    createdAt: iso(product.createdAt),
    updatedAt: iso(product.updatedAt),
  };
}

/* -------------------------------------------------------------------------- */
/*  Shop                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The shop the key speaks for — the "who am I" every integration setup screen
 * calls first to prove the credential works and to name what it connected to.
 *
 * Deliberately thin. Nothing about billing, nothing about the owner's account,
 * no contact email: this answers "which shop" and not "tell me everything
 * about this seller".
 */
export function shopResource(shop: Shop) {
  return {
    id: shop.id,
    object: "shop" as const,
    handle: shop.handle,
    name: shop.name,
    currency: shop.currency,
    timeZone: shop.timeZone,
    createdAt: iso(shop.createdAt),
  };
}

/* -------------------------------------------------------------------------- */
/*  Subscription                                                               */
/* -------------------------------------------------------------------------- */

/**
 * A membership, as every `subscription.*` event describes it.
 *
 * The seven subscription events all carry this one shape rather than a payload
 * shaped per event, for the reason `orderResource` gives: a consumer that wired
 * `subscription.created` and later adds `subscription.cancelled` should not
 * have to remap anything, because what differs between them is which one fired
 * and not what a membership is.
 *
 * **No Stripe identifiers.** `stripeSubscriptionId`, `stripeCustomerId` and
 * `stripeAccountId` all name objects in an account the consumer has no right to
 * — the *seller's* — and shipping them would let anything holding a webhook
 * payload address that account directly. The membership's own id is the handle,
 * and `GET /api/v1/…` speaks the same one.
 *
 * `billingMode` is here because it changes what a consumer may conclude. A
 * `manual` membership is one Sailo raises renewal orders for and a human
 * settles at the door; nothing will ever arrive from Stripe about it, so an
 * integration waiting for a card renewal on one would wait forever.
 */
export function subscriptionResource(sub: Subscription) {
  const currency = sub.currency;

  return {
    id: sub.id,
    object: "subscription" as const,
    status: sub.status,

    productId: sub.productId,
    clientId: sub.clientId,

    price: money(sub.priceCents, currency),
    currency,
    interval: sub.interval,
    /** How many intervals per charge — the `3` in "every 3 months". */
    intervalCount: sub.intervalCount,

    /** `stripe` or `manual` — see above; they renew by different machinery. */
    billingMode: sub.billingMode,
    /** The rail a manual member pays on. Null for a card subscription. */
    paymentMethod: sub.paymentMethod,

    currentPeriodEnd: iso(sub.currentPeriodEnd),
    /**
     * The member asked to stop but has paid through `currentPeriodEnd`.
     *
     * The distinction `subscription.cancelled` and `subscription.ended` are
     * built on: a consumer that revokes access the moment it sees a
     * cancellation takes away a month somebody already bought.
     */
    cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
    canceledAt: iso(sub.canceledAt),
    trialEndsAt: iso(sub.trialEndsAt),

    startedAt: iso(sub.startedAt),
    createdAt: iso(sub.createdAt),
    updatedAt: iso(sub.updatedAt),
  };
}

/* -------------------------------------------------------------------------- */
/*  Booking                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * One appointment, as `GET /api/v1/bookings` describes it.
 *
 * The row this is built from is `booking_claims`, which exists to make a slot
 * exclusive rather than to be read — so the two things a calendar integration
 * actually needs, the name of the service and the name of the person taking
 * it, are not on it. They are passed in rather than looked up here, because
 * this module holds no database handle and because the list endpoint resolves
 * both for a whole page in one query each; a resource function that fetched
 * them would be a round trip per appointment.
 *
 * **`seats` and `isExclusive` are the pair that decides what an appointment
 * means.** An exclusive claim is a one-to-one booking and holds the whole slot;
 * a non-exclusive one is a seat in a class, and several sit in the same window
 * without conflicting. A consumer mirroring these into a calendar that treats
 * every entry as busy will double-book a class teacher out of their own class
 * unless it reads `isExclusive` first.
 *
 * There is no status. A booking claim is released by deletion — an order that
 * is cancelled or refunded gives the slot back by removing the row — so a claim
 * that exists is an appointment that stands, and the absence of one from a
 * later page is how a consumer learns it was dropped.
 */
export function bookingResource(
  claim: BookingClaim,
  context: { productTitle: string | null; staffName: string | null },
) {
  return {
    id: claim.id,
    object: "booking" as const,

    orderId: claim.orderId,
    productId: claim.productId,
    /** The service as it is titled now, not as it was when booked. */
    productTitle: context.productTitle,

    /** Null on a shop that books no particular person — see `staffResource`. */
    staffId: claim.staffId,
    staffName: context.staffName,

    startsAt: iso(claim.startsAt),
    endsAt: iso(claim.endsAt),

    /** How many places this claim takes. Always 1 on an exclusive booking. */
    seats: claim.seatsTaken,
    /** True when the claim holds the whole slot rather than a seat in it. */
    isExclusive: claim.isExclusive,

    createdAt: iso(claim.createdAt),
  };
}

/* -------------------------------------------------------------------------- */
/*  Staff                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Somebody a buyer can book, as `GET /api/v1/staff` describes them.
 *
 * **Not a login and not a team member.** A staff resource is a bookable name on
 * a roster — the person a buyer picks when they book a haircut — and it has no
 * account, no password and no access to anything. The seller's actual
 * colleagues are `member` rows against an organisation, which this API does not
 * describe at all. Anything reading this as an identity is reading it wrong,
 * which is why the object is `staff` and never `user`.
 *
 * **`calendarFeedUrl` is deliberately absent, and it is the one field here that
 * would matter if it leaked.** It is the seller's private external calendar —
 * an Google or iCloud secret link that anyone holding can read every
 * appointment in that person's life, work or not. It is a credential wearing a
 * URL's clothes, and the API returns no credentials.
 *
 * `hours` is absent for a duller reason: it is an internal weekly-hours blob
 * whose shape is ours to change, and a consumer that needs to know when
 * somebody is free should ask what is bookable rather than reimplement the
 * calculation from the raw opening windows, closures and external busy feeds
 * that go into it.
 */
export function staffResource(staff: StaffResource) {
  return {
    id: staff.id,
    object: "staff" as const,
    name: staff.name,
    email: staff.email,
    avatarUrl: staff.avatarUrl,
    /** IANA name. Null means the shop's own zone, not UTC. */
    timeZone: staff.timeZone,
    /**
     * Whether they can be booked at all right now.
     *
     * Inactive rather than deleted is how a seller takes somebody off the
     * roster without breaking the appointments already against them, so an
     * inactive person can still be the `staffId` on a future booking.
     */
    isActive: staff.isActive,
    /** Where they sit in the seller's own ordering of the roster. */
    position: staff.position,
    createdAt: iso(staff.createdAt),
    updatedAt: iso(staff.updatedAt),
  };
}

/* -------------------------------------------------------------------------- */
/*  Contact list                                                               */
/* -------------------------------------------------------------------------- */

/**
 * A named list, as `GET /api/v1/lists` describes it.
 *
 * The two counts are the numbers a seller reads a list by, and they are
 * separate because they answer different questions. `subscribedCount` is how
 * many people a send would actually reach. `pendingCount` is how many were
 * added to a double-opt-in list and have not yet clicked the link in their own
 * inbox — they are on the list and they are **not** recipients, and a consumer
 * that adds the two together and reports it as an audience size is overstating
 * every list a seller has by exactly the number of people who never confirmed.
 *
 * Neither count includes members who left. `removed` is a state rather than a
 * deletion, so the row survives to stop the next import quietly putting them
 * back, but nothing counts them and nothing mails them.
 */
export function contactListResource(
  list: ContactListRow,
  counts: { subscribed: number; pending: number },
) {
  return {
    id: list.id,
    object: "list" as const,
    name: list.name,
    description: list.description,
    /**
     * Whether joining this list needs a click in the member's own inbox.
     *
     * The field that decides what `POST /contacts/{id}/lists` can achieve: on a
     * double-opt-in list a join lands as `pending` and stays there until the
     * person confirms, so an integration cannot put a subscriber on one by
     * asking.
     */
    doubleOptIn: list.doubleOptIn,
    subscribedCount: counts.subscribed,
    pendingCount: counts.pending,
    createdAt: iso(list.createdAt),
    updatedAt: iso(list.updatedAt),
  };
}

/* -------------------------------------------------------------------------- */
/*  Flow                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * An automation, as `GET /api/v1/flows` describes it.
 *
 * A seller builds a sequence once — somebody joins a list, wait two days, send
 * this — and it runs itself from then on. This is that sequence, plus how much
 * of it is currently in flight.
 *
 * **The graph is summarised, not published.** `steps` is the ordered node list
 * with each node's `kind` and nothing else. The full node bodies are an
 * internal shape that the builder and the runner agree on and that is ours to
 * change; publishing them would freeze it, and a consumer reconstructing "what
 * this flow does" from raw node config would be reimplementing the parser
 * against a moving target. What an integration actually needs from a flow is
 * whether it is running, what starts it, and how it is going — all of which
 * are here.
 *
 * `runs` is null when the caller did not ask for the tallies, which is the
 * list case: counting live runs per flow is a second query, and a page of
 * flows should not pay for it when most callers want the names and statuses.
 */
export function flowResource(
  automation: Automation,
  context: {
    steps: readonly { id: string; kind: string }[];
    runs?: {
      total: number;
      live: number;
      completed: number;
      failed: number;
      cancelled: number;
    } | null;
  },
) {
  return {
    id: automation.id,
    object: "flow" as const,
    name: automation.name,
    /** `email` for a sequence a seller drew, `scenario` for a one-step rule. */
    kind: automation.kind,
    /** `draft`, `active` or `paused`. Only `active` enrols anybody. */
    status: automation.status,

    /**
     * What starts it. Null on a draft nobody has finished.
     *
     * `config` is the trigger's own qualifier — which list, which product —
     * and is passed through as stored rather than reshaped, because it is the
     * one part of the graph whose meaning is stable and public: it is the same
     * vocabulary the webhook events use.
     */
    trigger: automation.trigger
      ? { type: automation.trigger.type, config: automation.trigger.config ?? {} }
      : null,

    /**
     * `once` or `repeat` — whether somebody who already walked this flow can
     * enter it again. A consumer counting sends per person needs it.
     */
    entryPolicy: automation.entryPolicy,

    steps: context.steps.map((step) => ({ id: step.id, kind: step.kind })),
    stepCount: context.steps.length,

    runs: context.runs ?? null,

    activatedAt: iso(automation.activatedAt),
    createdAt: iso(automation.createdAt),
    updatedAt: iso(automation.updatedAt),
  };
}

/* -------------------------------------------------------------------------- */
/*  Flow run                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * One person walking one flow, as `GET /api/v1/flows/{id}/runs` describes it.
 *
 * The row that answers "why did this customer not get the email" — which is
 * the question a seller brings to support, and until now had no way to answer
 * except by reading the database.
 *
 * **`lastError` is our own sentence, never a cause.** The runner truncates
 * whatever it writes there to 500 characters, and what it writes is a reason a
 * person can act on — a send refusal, an action's failure — rather than an
 * exception. Nothing from a stack, a driver or a third party's response body
 * reaches it, which is what makes it safe to hand back.
 *
 * `email` is the address the run is keyed on, which is the same personal data
 * `GET /contacts` already returns under the same key. A run list is
 * nonetheless a bulk read of addresses, so it needs a key like any other read.
 */
export function flowRunResource(run: AutomationRun) {
  return {
    id: run.id,
    object: "flow_run" as const,
    flowId: run.automationId,
    contactId: run.clientId,
    email: run.email,

    /** `queued`, `waiting`, `done`, `failed` or `cancelled`. */
    status: run.status,
    /**
     * Which step they are sitting on, as the node id from the flow's `steps`.
     * Null once the run is over.
     */
    currentStep: run.cursor,
    /** When the runner will next look at them. Null when nothing is pending. */
    wakeAt: iso(run.wakeAt),
    /** How many times a step has been retried. Six is the ceiling. */
    attempt: run.attempt,

    enteredAt: iso(run.enteredAt),
    finishedAt: iso(run.finishedAt),
    lastError: run.lastError,
  };
}

/* -------------------------------------------------------------------------- */
/*  Dispute                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * A chargeback, as `dispute.opened` and `dispute.closed` describe it.
 *
 * Emitted only for `scope = "connected"` — a buyer charging back a seller's
 * sale. A platform dispute is a seller charging back their own Sailo
 * subscription, which is Sailo's money and Sailo's problem, and it has no
 * business arriving in that seller's Zapier account as though a customer had
 * done something.
 *
 * **`evidenceSnapshot` is deliberately absent.** It is the complete bundle
 * assembled to answer the case — buyer address, delivery proof, the seller's
 * own account of events — and it exists to be sent to Stripe, not syndicated to
 * whatever an integration points at. `completenessBp` says how strong the
 * response was without shipping the response itself.
 *
 * Stripe's identifiers are absent for the same reason they are absent from a
 * subscription: they address the seller's account.
 */
export function disputeResource(dispute: Dispute) {
  const currency = dispute.currency;

  return {
    id: dispute.id,
    object: "dispute" as const,
    orderId: dispute.orderId,

    status: dispute.status,
    /** `inquiry` | `chargeback` | `compliance` — an inquiry costs nothing yet. */
    caseType: dispute.caseType,
    /** Stripe's reason string: `fraudulent`, `product_not_received`… */
    reason: dispute.reason,
    /** The card network's own code — `10.4`, `13.1`. Not a Stripe id. */
    networkReasonCode: dispute.networkReasonCode,
    network: dispute.network,

    amount: money(dispute.amountCents, currency),
    /** Stripe's dispute fee, which is why a $42 chargeback costs $57. */
    fee: money(dispute.feeCents, currency),
    /** Amount plus fee — what actually left the seller's balance. */
    deducted: money(dispute.deductedCents, currency),
    currency,

    /** The response deadline. Null on a case that no longer needs one. */
    dueBy: iso(dispute.dueBy),
    evidenceSubmittedAt: iso(dispute.evidenceSubmittedAt),
    submissionCount: dispute.submissionCount,
    /** How complete the submission was over its required fields, in bp. */
    completenessBp: dispute.completenessBp,

    fundsWithdrawnAt: iso(dispute.fundsWithdrawnAt),
    fundsReinstatedAt: iso(dispute.fundsReinstatedAt),

    openedAt: iso(dispute.stripeCreatedAt),
    createdAt: iso(dispute.createdAt),
    updatedAt: iso(dispute.updatedAt),
  };
}
