/**
 * What a buyer is offered when there is none of it — spec 33.
 *
 * Pure, and for the reason every other rule in this folder is: the buy box
 * decides what the button says, the basket decides what the drawer shows, the
 * storefront card decides whether to draw "sold out", and `resolveLines` decides
 * whether an order may exist. Four surfaces, one answer.
 *
 * WHAT A PREORDER IS NOT
 *
 * It is not a different order type, it does not get a status of its own, and it
 * does not hold an authorisation. It is an ordinary order taken against stock
 * that has not arrived, charged at checkout like everything else, carrying a
 * date the buyer was shown before they committed. That date is the entire risk
 * the feature adds and the entire duty it creates.
 */

/** The columns a preorder decision reads. A trimmed literal satisfies it. */
export type PreorderProduct = {
  preorderEnabled: boolean;
  preorderExpectedAt: Date | null;
  preorderLimit: number | null;
};

export type PreorderVariant = {
  preorderExpectedAt?: Date | null;
  preorderLimit?: number | null;
} | null | undefined;

/**
 * The date this exact combination is promised for.
 *
 * The variant's, falling back to the product's — the same rule its price
 * follows. The blue medium may be six weeks out while the red small is two, and
 * showing the product's date for a combination that will take longer is telling
 * a buyer something untrue at the moment they are deciding.
 *
 * **Null is an answer**, not a missing one: "no date given". It must render as
 * that rather than as a blank, because a blank reads as a date that failed to
 * load and a buyer will wait for it.
 */
export function preorderExpectedAt(
  product: PreorderProduct,
  variant?: PreorderVariant,
): Date | null {
  return variant?.preorderExpectedAt ?? product.preorderExpectedAt ?? null;
}

/**
 * How many preorders this combination may take in total. Null is uncapped.
 *
 * The variant narrows nothing and replaces: a tier with its own ceiling has its
 * own ceiling, and a tier without one inherits the product's. Unlike a sell
 * window there is no "narrows, never widens" rule here, because a limit is a
 * count of a specific thing rather than a bound on a shared period — a seller
 * who can make fifty of the blue and twenty of the red is describing two
 * separate runs, not a subset of one.
 */
export function preorderLimit(
  product: PreorderProduct,
  variant?: PreorderVariant,
): number | null {
  const raw = variant?.preorderLimit ?? product.preorderLimit ?? null;
  if (raw === null || !Number.isFinite(raw)) return null;
  const limit = Math.trunc(raw);
  return limit > 0 ? limit : null;
}

/**
 * Whether this product will take an order it cannot fill yet.
 *
 * Only the switch — whether there is *stock* is a separate question, asked by
 * `isSellable`, and the two must stay separate. A preorder-enabled product that
 * still has stock sells normally; the preorder path opens exactly when the
 * shelf is empty.
 */
export function takesPreorders(product: PreorderProduct): boolean {
  return product.preorderEnabled === true;
}

/**
 * What the buy button should say and do, once stock has had its say.
 *
 * Three states rather than two, because "sold out" and "preorder" are different
 * offers and collapsing them loses the sale either way round: a buyer told
 * "sold out" on a product they could have preordered leaves, and a buyer
 * offered "preorder" on a product with stock is being told something false
 * about when it will arrive.
 */
export type BuyState = "in_stock" | "preorder" | "sold_out";

export function buyState(
  product: PreorderProduct,
  opts: { sellable: boolean },
): BuyState {
  if (opts.sellable) return "in_stock";
  return takesPreorders(product) ? "preorder" : "sold_out";
}

/* -------------------------------------------------------------------------- */
/*  Back in stock                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Whether the "tell me when it's back" form belongs on this page.
 *
 * Offered wherever a buyer cannot buy right now and *might* be able to later:
 * out of stock, and not yet released. Not offered when they can buy it — there
 * is nothing to be told — and not offered on a preorder, where the answer to
 * "when can I have it" is a button rather than a queue.
 *
 * Deliberately still offered on a product whose sell window has *ended*: spec
 * 43's `hideWhenUnavailable` note says an ended launch is often exactly where a
 * seller wants the form, and being told a thing is coming back is the only
 * thing left to offer somebody who arrived too late.
 */
export function offersStockRequest(opts: {
  sellable: boolean;
  takesPreorders: boolean;
}): boolean {
  return !opts.sellable && !opts.takesPreorders;
}

/**
 * What a contact must give to join the queue: an address, or a number.
 *
 * One of the two, never both required. Email is the common case on a card shop
 * and is the only one Sailo can actually send to; a phone is accepted because a
 * shop running chat rails has buyers who never gave an address, and refusing
 * them a place in the queue is refusing a sale.
 *
 * The trimming matters more than it looks: a request stored with a trailing
 * space is a different row from the same request without one, so the unique
 * index that holds "one open request per contact per variant" would not fire.
 */
export function normalizeContact(input: {
  email?: string | null;
  phone?: string | null;
}): { email: string | null; phone: string | null } | null {
  const email = input.email?.trim().toLowerCase() ?? "";
  const phone = input.phone?.replace(/[^\d+]/g, "") ?? "";

  /*
   * Too long is refused, never truncated — and this line is here because a test
   * caught the difference.
   *
   * Slicing first and checking afterwards *looked* the same and was not: a
   * four-hundred-character local part had its `@example.com` cut off by the
   * slice, so the address failed the `@` check and was dropped for a reason
   * that had nothing to do with why it should have been. The next value to
   * arrive that way would have been a *valid* address, truncated into an
   * invalid one and stored — a row in the queue that can never be delivered to.
   *
   * 254 is the RFC's ceiling for a whole address, and 32 is generous for an
   * E.164 number. Anything past either is not a contact we could reach.
   */
  const usableEmail =
    email.length >= 5 && email.length <= 254 && email.includes("@") ? email : null;
  const usablePhone =
    phone.length <= 32 && phone.replace(/\D/g, "").length >= 6 ? phone : null;

  if (!usableEmail && !usablePhone) return null;
  return { email: usableEmail, phone: usablePhone };
}
