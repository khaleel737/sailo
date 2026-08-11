/**
 * Which businesses Sailo accepts, which it accepts with conditions, and which
 * it declines.
 *
 * Three lists, one place, because the same policy is read by three different
 * people for three different reasons: a seller deciding whether to bother
 * signing up, a support reply explaining why a shop was closed, and a payment
 * provider or bank checking that we have a policy at all. Three copies of that
 * drift apart, and the one that drifts is always the one being quoted back at
 * us.
 *
 * ── WHY THIS LOOKS LIKE STRIPE'S LIST ────────────────────────────────────────
 * Card payments on Sailo are created on the seller's own Stripe connected
 * account, so Stripe's restricted-business list already binds every seller who
 * switches cards on, and the card networks' rules bind Stripe in turn. A
 * platform whose own policy is looser than its processor's is not more
 * permissive — it just tells sellers yes and lets Stripe tell them no later,
 * after they have built a catalogue. So the declined list below is deliberately
 * shaped like Stripe's, and where they differ the stricter one applies.
 *
 * One deliberate difference: this list holds on every channel. Most of Sailo's
 * orders arrive by chat, bank transfer or cash and never touch a payment system
 * at all, and a policy that only bound card sellers would decline a trade at
 * checkout while hosting a whole shop for it. Nothing here is switched off by
 * taking cash.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Not legal advice, and not a legal opinion about anybody's business. A shop
 * passing this list is not us saying the trade is lawful or licensed where the
 * seller is — that stays the seller's to establish, and the seller-obligations
 * clause of the terms says so.
 */

/** Stripe's own list, which binds every seller taking card payments. */
export const STRIPE_RESTRICTED_URL = "https://stripe.com/legal/restricted-businesses";

type AcceptedBusiness = {
  readonly name: string;
  /** Concrete trades, so a reader recognises themselves rather than guessing. */
  readonly examples: string;
};

type ConditionalBusiness = {
  readonly name: string;
  /** What has to be true. Written as an obligation, not as a caveat. */
  readonly condition: string;
};

type DeclinedGroup = {
  /** Anchor fragment, so a support reply can link the exact group. */
  readonly id: string;
  readonly group: string;
  /** One sentence of reasoning. A rule nobody understands gets argued with. */
  readonly why: string;
  /**
   * Fragments, rendered as a run of list items — no trailing full stops, and no
   * leading capitals except on proper nouns.
   */
  readonly items: readonly string[];
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
      "You hold the licence your country requires to sell it, you verify age at delivery or collection rather than with a checkbox, and you accept that card payments on alcohol are subject to Stripe’s rules and may be declined by them even when we accept the shop.",
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
      "Ordinary retail goods only, listed and photographed as retail goods, with an age gate. Explicit content and services are a different thing and are declined outright below.",
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
      "Above roughly 1,000 USD an order we may ask for identification, proof that you hold the goods, or proof of provenance before card payments continue. Resold luxury goods need documentation that they are authentic.",
  },
  {
    name: "Charitable and community fundraising",
    condition:
      "You are the registered organisation or hold its written authority, you say plainly where the money goes, and you meet whatever registration your country requires of fundraisers.",
  },
  {
    name: "Travel, and anything paid far in advance",
    condition:
      "Accepted case by case and reviewed before card payments are enabled, because the money is taken now and the service is delivered much later. Expect us to ask questions a bank would ask.",
  },
] as const;

/**
 * Declined.
 *
 * Ordered roughly by how often it comes up rather than by how bad it is. Every
 * group carries the reason it exists, because the ones that get argued with are
 * always the ones that look arbitrary — and most of these are not our
 * preference, they are the condition on which the whole platform keeps card
 * acceptance.
 */
export const DECLINED_BUSINESSES: readonly DeclinedGroup[] = [
  {
    id: "unlawful",
    group: "Unlawful, or unlicensed where a licence is required",
    why: "The first line, and the one that swallows most of the rest: if it is not lawful for you to sell it, having a shop does not make it lawful.",
    items: [
      "anything illegal where you are, or where your buyer is",
      "a licensed trade carried on without the licence, or after it has lapsed",
      "goods or services barred by the export, import or sanctions law that applies to us or to you",
      "trade with a person, organisation or region under sanctions",
      "anything sold in breach of an order of a court or a regulator",
    ],
  },
  {
    id: "financial",
    group: "Financial services and money movement",
    why: "Moving other people’s money is a licensed activity everywhere, and Sailo is not licensed for it: we are not a bank, a money transmitter, an escrow agent or a payment institution, and a shop cannot be used as one.",
    items: [
      "money transmission, remittance and money orders",
      "currency exchange and cheque cashing",
      "lending of any kind, including payday loans, cash advances and buy-now-pay-later",
      "debt collection, debt reduction, credit repair and mortgage relief",
      "investment schemes, securities, brokerage and portfolio management",
      "insurance, warranties and extended service plans",
      "bail bonds",
      "escrow, and holding money for a third party",
      "prepaid cards, stored value and the resale of gift cards",
      "crowdfunding, and collecting pledges against something not yet made",
    ],
  },
  {
    id: "crypto",
    group: "Virtual currency and speculative assets",
    why: "Irreversible on one side and reversible on the other: a buyer pays by card, receives something that cannot be recalled, and files a chargeback. The platform carries that asymmetry, so it does not carry the trade.",
    items: [
      "buying, selling or exchanging cryptocurrency",
      "mining, mining contracts and hosted hash rate",
      "token sales, initial coin offerings and presales",
      "NFTs and digital collectibles sold as an investment",
      "in-game currency, accounts and item trading for real money",
      "points, miles and loyalty balances sold on",
    ],
  },
  {
    id: "gambling",
    group: "Gambling and games of chance",
    why: "Licensed in every country that permits it at all, on terms no small shop holds — and a great deal of what is sold as a giveaway is a lottery with a different word on it.",
    items: [
      "lotteries, raffles and prize draws with a paid entry",
      "sports betting, tipster services and odds",
      "fantasy sports played for money",
      "casino games, slots and internet gaming",
      "bidding-fee and penny auctions",
      "mystery boxes, loot boxes and anything where what the buyer receives is decided by chance",
      "sweepstakes and contests with an entry fee",
    ],
  },
  {
    id: "regulated-goods",
    group: "Regulated, controlled and dangerous goods",
    why: "Age-restricted, prescription-only, or capable of hurting the person who opens the parcel — and in most of these cases capable of hurting the courier first.",
    items: [
      "controlled drugs, and anything sold to imitate one",
      "drug paraphernalia",
      "nitrous oxide, research chemicals and novel psychoactive substances",
      "prescription medicines, pharmacies and telemedicine",
      "cannabis, CBD and hemp-derived products, including where they are lawful locally",
      "tobacco, cigarettes, cigars, e-cigarettes, vapes, e-liquid and nicotine pouches",
      "weapons, ammunition, gun parts, magazines and files for printing firearms",
      "knives sold as weapons, and anything restricted as an offensive weapon",
      "explosives, fireworks and pyrotechnics",
      "toxic, flammable, corrosive and radioactive materials",
      "restricted pesticides, and chemicals sold outside their licensed use",
    ],
  },
  {
    id: "counterfeit",
    group: "Counterfeits and infringement",
    why: "Someone else’s work, sold without them. This is also the complaint we receive most often, and the one that arrives with a lawyer attached.",
    items: [
      "counterfeits, replicas, dupes and anything described as inspired by a brand it is not",
      "unauthorised copies of films, music, books, software or courses",
      "cracked software, licence keys and accounts obtained outside their terms",
      "unlicensed merchandise using someone else’s characters, logos, players or artwork",
      "resold stock images, fonts, templates or presets you are not licensed to redistribute",
      "reposted photography, designs or product images that are not yours",
    ],
  },
  {
    id: "adult",
    group: "Adult content and services",
    why: "Card acceptance for adult trade runs through specialist acquirers with age-verification obligations Sailo does not implement, and the last item in this list is reported rather than declined.",
    items: [
      "pornography and sexually explicit content, in any medium",
      "live camming, custom explicit content and subscriptions to it",
      "escorting, companionship and any arrangement of sexual services",
      "mail-order brides and marriage brokering",
      "any content that sexualises a person under 18, real or generated, which we report to law enforcement and to Stripe",
      "any sexual content involving a person who did not consent to it being sold, including intimate images shared without consent",
    ],
  },
  {
    id: "data",
    group: "Data, credentials and access",
    why: "The stock is almost always someone else’s account, someone else’s personal data, or a lie told to a ranking system.",
    items: [
      "personal data sold as a product, scraped databases and mailing lists",
      "stolen or hacked accounts, logins and credentials",
      "followers, likes, views, installs and reviews",
      "verification, badges and ranking manipulation",
      "SIM cards, phone numbers and accounts sold for use in verification",
      "doxxing, tracing and surveillance of a person without their consent",
      "malware, phishing kits, stresser and denial-of-service services",
    ],
  },
  {
    id: "deceptive",
    group: "Deceptive, predatory and unfair practices",
    why: "Defined by what the buyer understood, not by what the small print said. If a sale depends on the buyer misunderstanding it, it is in this group.",
    items: [
      "multi-level marketing, pyramid and matrix schemes",
      "get-rich-quick offers, and coaching sold on a promise of income",
      "guaranteed returns, and any claim about money the seller cannot evidence",
      "unsubstantiated health, medical or weight-loss claims",
      "negative-option billing, silent auto-renewal, and free trials that bill without a clear warning",
      "prices that appear only at the end, and fees a buyer could not have seen before paying",
      "fake documents: diplomas, certificates, identity documents, licences, insurance, test and vaccination records",
      "essays, coursework and examinations written to be submitted as someone else’s work",
      "reselling something available free, or a public service, as though it were your own",
      "remote technical support sold off an unsolicited warning",
    ],
  },
  {
    id: "living",
    group: "People, animals and human material",
    why: "Trades that are either criminal, cruel, or impossible to carry out safely through a parcel service.",
    items: [
      "human organs, tissue, blood, ova, sperm and other bodily material",
      "any offer of a person, including labour arranged under coercion",
      "live animals",
      "endangered species, ivory, and products made from protected wildlife",
      "animal fighting, and equipment made for it",
      "trophies from protected species",
    ],
  },
  {
    id: "harm",
    group: "Hate, violence and harassment",
    why: "Nothing to do with payments. We simply will not host it.",
    items: [
      "material promoting hatred or violence against people for who they are",
      "terrorist and extremist material, and fundraising for it",
      "harassment, threats, and services sold to carry them out",
      "instructions for making weapons or devices intended to hurt people",
      "memorabilia and content that celebrates a violent crime or its perpetrator",
    ],
  },
  {
    id: "aggregation",
    group: "Taking payments for someone else",
    why: "The card networks call it transaction laundering, and it is the fastest way to lose an account here — ours as well as yours, which is why the fraud and enforcement clause is written as bluntly as it is.",
    items: [
      "processing payments for a business other than the one the shop describes",
      "a shop whose real trade is not the trade on its page",
      "splitting or relabelling a payment to disguise what was bought",
      "accepting money through a shop for something it does not sell",
      "re-registering under a new shop or handle to escape a dispute rate, a suspension or a network monitoring programme",
    ],
  },
  {
    id: "platform",
    group: "Misusing Sailo itself",
    why: "The last group is about us, and it is short because it is mostly obvious.",
    items: [
      "reselling, rebranding or white-labelling Sailo as your own product",
      "fake, duplicated or automated shops, handles and referral links",
      "manufactured referral activity, and commission claimed on traffic that did not happen",
      "scraping, probing or working around plan limits and rate limits",
      "using our name, logo or design outside the badge we place on free shops",
      "a shop that exists to send visitors somewhere else, or to send unsolicited messages",
    ],
  },
] as const;

/**
 * Every declined item as one lowercase blob.
 *
 * Used by the tests to assert that categories the card networks require us to
 * exclude are still in the list after somebody edits it. Cheap to compute and
 * only ever called from a test, but it lives here so the shape of the data and
 * the thing that reads it stay together.
 */
export function declinedText(): string {
  return DECLINED_BUSINESSES.flatMap((g) => [g.group, g.why, ...g.items])
    .join(" ")
    .toLowerCase();
}
