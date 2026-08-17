/**
 * The two lists a seller reads about themselves: what fits, and what fits with
 * something attached.
 *
 * Kept apart from `declined.ts` because they are read at different moments and
 * by different people. A seller reads these two once, at signup, and should
 * stop reading; the declined groups are read later, by us, when explaining a
 * decision — which is why those carry anchors and these do not.
 */

export type AcceptedBusiness = {
  readonly name: string;
  /** Concrete trades, so a reader recognises themselves rather than guessing. */
  readonly examples: string;
};

export type ConditionalBusiness = {
  readonly name: string;
  /** What has to be true. Written as an obligation, not as a caveat. */
  readonly condition: string;
};

/**
 * What the product is for.
 *
 * Not an exhaustive list and it does not need to be: it is here so a seller
 * with an ordinary small business stops reading after thirty seconds and goes
 * and builds their shop.
 */
export const ACCEPTED_BUSINESSES: readonly AcceptedBusiness[] = [
  {
    name: "Things you make",
    examples:
      "jewellery, ceramics, candles, clothing, art and prints, furniture, leather goods, plants, soap and skincare, anything that leaves your hands finished",
  },
  {
    name: "Things you buy and resell",
    examples:
      "boutiques, thrift and vintage, sneakers, books, parts and spares, wholesale to trade buyers, second-hand goods you own outright",
  },
  {
    name: "Food and drink",
    examples:
      "bakeries, home kitchens, coffee roasters, spice and sauce makers, catering, meal boxes, cakes to order, market stalls",
  },
  {
    name: "Digital files",
    examples:
      "presets and LUTs, templates, e-books, fonts, sample packs, stock photography, notion boards, printables, recorded courses",
  },
  {
    name: "Services and appointments",
    examples:
      "hairdressing, barbering, nails, tattooing, photography, repairs, cleaning, tutoring, translation, design, trades, consulting",
  },
  {
    name: "Classes, workshops and events",
    examples:
      "a seat at a pottery class, a supper club, a workshop, a market pitch, a retreat place, a ticketed talk",
  },
  {
    name: "Made to order and commissions",
    examples:
      "custom furniture, wedding cakes, portraits, tailoring, personalised gifts, print on demand, anything you start after the order arrives",
  },
  {
    name: "Rentals and hire",
    examples:
      "equipment hire, party and event kit, tools, costumes, bikes, studio time — where you hold the item and the buyer collects or returns it",
  },
] as const;

/**
 * Accepted, but not unconditionally.
 *
 * Every one of these is a legitimate trade that carries a licence, an age
 * restriction, or a gap between paying and receiving. The gap is the part that
 * matters commercially: a chargeback is filed against the shop months later,
 * and the seller has usually spent the money by then.
 *
 * Several of these are trades Stripe classes as *restricted* rather than
 * prohibited — accepted subject to review rather than refused. Where Stripe
 * reviews, we attach a condition and reserve the same review, because a
 * platform that waves through what its processor stops is only moving the
 * refusal to a worse moment.
 */
export const CONDITIONAL_BUSINESSES: readonly ConditionalBusiness[] = [
  {
    name: "Food prepared for sale",
    condition:
      "You are registered with whichever authority licenses food where you cook, you meet its hygiene and allergen-labelling rules, and a home kitchen is registered as one.",
  },
  {
    name: "Alcohol",
    condition:
      "You hold the licence your country requires to sell it, you verify age at delivery or collection rather than with a checkbox, and you accept that card payments on alcohol are subject to Stripe’s rules and may be declined by them even when we accept the shop. Not available at all in some countries — see the country list at the end of this policy.",
  },
  {
    name: "Cosmetics, skincare and supplements",
    condition:
      "The product meets the labelling, ingredient and registration rules where your buyers are, and you make no claim to diagnose, treat, cure or prevent anything. A moisturiser is a cosmetic; a moisturiser that cures eczema is an unlicensed medicine.",
  },
  {
    name: "Health, wellness and body services",
    condition:
      "You hold the registration or licence your practice needs — massage, physiotherapy, tattooing, piercing, aesthetics, nutrition advice — and you describe it as what it is rather than as medical treatment.",
  },
  {
    name: "Sexual wellness products",
    condition:
      "Ordinary retail goods only, listed and photographed as retail goods, with an age gate. Explicit content and services are a different thing and are declined outright below, and several countries prohibit these goods entirely — see the country list at the end of this policy.",
  },
  {
    name: "Pre-orders and long lead times",
    condition:
      "You state the dispatch date on the listing before the buyer pays, and you keep to it or refund. Taking payment more than 30 days before delivery is the single most common cause of a chargeback on this platform, and the chargeback is yours.",
  },
  {
    name: "Tickets and dated events",
    condition:
      "You are the organiser or are authorised by them. Resale of tickets you did not issue is declined. If the event does not happen, you refund it — a credit for a future date is not a refund unless the buyer chooses it.",
  },
  {
    name: "Memberships and anything that repeats",
    condition:
      "You state the price, the interval and how to stop it before the first payment is taken, and you make cancelling as easy as starting. Silent auto-renewal is declined as a deceptive practice, not merely discouraged.",
  },
  {
    name: "Drop-shipping and long supplier chains",
    condition:
      "You are answerable for delivery times, customs charges and returns even though someone else ships. A shop that answers complaints with the supplier’s shipping policy is a shop we will close.",
  },
  {
    name: "High-value single items",
    condition:
      "Above roughly 1,000 USD an order we may ask for identification, proof that you hold the goods, or proof of provenance before card payments continue. Resold luxury goods need documentation that they are authentic, and precious metals, stones and bullion are reviewed before card payments are enabled at all.",
  },
  {
    name: "Charitable and community fundraising",
    condition:
      "You are the registered organisation or hold its written authority, you say plainly where the money goes, and you meet whatever registration your country requires of fundraisers. Raffles and prize draws are not fundraising for this purpose — they are gambling, and they are declined.",
  },
  {
    name: "Travel bookings and reservations",
    condition:
      "You are booking accommodation, tours, transfers or experiences you or a named supplier will actually deliver, and we review the shop before card payments are enabled — the money is taken now and the service delivered much later, which is the shape a bank asks the most questions about. Airlines, cruises, charter flights and timeshares are declined outright below, whatever the shop is called.",
  },
  {
    name: "Selling into a country you are not in",
    condition:
      "You may sell across borders, but the shop must trade from the country your Stripe account was opened in, and you must meet the consumer, labelling and tax law where your buyers are. Opening an account in one country to take payments for a business run from another is cross-border acquiring, and it is declined below.",
  },
] as const;
