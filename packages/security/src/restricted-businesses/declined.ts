/**
 * Declined.
 *
 * Ordered roughly by how often it comes up rather than by how bad it is. Every
 * group carries the reason it exists, because the ones that get argued with are
 * always the ones that look arbitrary — and most of these are not our
 * preference, they are the condition on which the whole platform keeps card
 * acceptance.
 *
 * Reconciled item by item against Stripe's published list — see
 * `STRIPE_LIST_RECONCILED` in `./index`. Where Stripe prohibits, this declines.
 * Where Stripe merely *restricts* — accepts subject to a review or a platform
 * approval — this declines anyway if the approval is one Sailo does not hold,
 * and attaches a condition in `./accepted` if it is one a seller can meet. The
 * `unapproved` group below is where that distinction is written down, because
 * "we would need a permission we do not have" is a different sentence from "we
 * will not host this" and a seller deserves to be told which one they got.
 */

export type DeclinedGroup = {
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
      "telecommunications manipulation equipment, including signal jammers and blockers",
    ],
  },
  {
    id: "financial",
    group: "Financial services and money movement",
    why: "Moving other people’s money is a licensed activity everywhere, and Sailo is not licensed for it: we are not a bank, a money transmitter, an escrow agent or a payment institution, and a shop cannot be used as one.",
    items: [
      "money transmission, remittance and money orders",
      "currency exchange and cheque cashing",
      "ATMs, and any service whose product is access to cash",
      "peer-to-peer money transfer between people who are not buying anything",
      "lending of any kind, including payday loans, cash advances and buy-now-pay-later",
      "paying off a loan, a credit card or a mortgage by card",
      "debt collection, debt reduction, credit repair and mortgage relief",
      "bankruptcy, debt settlement and debt-negotiation services",
      "law firms and advisers taking client money for anything other than their own fee",
      "investment schemes, securities, brokerage and portfolio management",
      "funded proprietary trading, and selling access to a funded trading account",
      "insurance, warranties and extended service plans",
      "bail bonds",
      "escrow, and holding money for a third party",
      "neobanks, challenger banks, and anything presented to a buyer as a bank account",
      "shell banks, payable-through accounts and the sale of bearer shares",
      "prepaid cards, stored value and the resale of gift cards",
      "identity theft protection, credit monitoring and identity recovery services",
      "crowdfunding, and collecting pledges against something not yet made",
    ],
  },
  {
    id: "crypto",
    group: "Virtual currency and speculative assets",
    why: "Irreversible on one side and reversible on the other: a buyer pays by card, receives something that cannot be recalled, and files a chargeback. The platform carries that asymmetry, so it does not carry the trade.",
    items: [
      "buying, selling or exchanging cryptocurrency",
      "mining, staking, mining contracts and hosted hash rate",
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
      "games of skill played for a cash or material prize",
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
      "kava, kratom and plant products sold for a psychoactive effect",
      "prescription medicines, pharmacies and telemedicine",
      "prescription-only and regulated medical devices",
      "ephedrine, HCG and weight-loss substances sold outside a pharmacy",
      "cannabis, CBD and hemp-derived products, including where they are lawful locally",
      "tobacco, cigarettes, cigars, e-cigarettes, vapes, e-liquid and nicotine pouches",
      "weapons, ammunition, gun parts, magazines and files for printing firearms",
      "replica and imitation firearms that are not marked as the law requires, including toys",
      "knives sold as weapons, and anything restricted as an offensive weapon",
      "stun guns, pepper spray and other self-defence weapons",
      "explosives, fireworks and pyrotechnics",
      "toxic, flammable, corrosive and radioactive materials",
      "restricted pesticides, chemicals sold outside their licensed use, and anything only a certified applicator may apply",
      "goods a postal or courier service refuses to carry",
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
      "devices and services that modify a games console or defeat a copy protection",
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
      "strip clubs, adult venues, and door or table charges for them",
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
      "testimonials, before-and-after photographs and reviews of something that did not happen",
      "incentives, prizes and rewards no seller could actually deliver",
      "negative-option billing, silent auto-renewal, and free trials that bill without a clear warning",
      "prices that appear only at the end, and fees a buyer could not have seen before paying",
      "fake documents: diplomas, certificates, identity documents, licences, insurance, test and vaccination records",
      "fake references, and paid-for employment or rental histories",
      "essays, coursework and examinations written to be submitted as someone else’s work",
      "reselling something available free, or a public service, as though it were your own",
      "remote technical support sold off an unsolicited warning",
      "telemarketing, and anything sold from an unsolicited call",
      "door-to-door and doorstep selling",
    ],
  },
  {
    id: "travel",
    group: "Airlines, cruises and timeshares",
    why: "Money taken now for something delivered months later by a business that can stop existing in between. This is the shape behind the largest chargeback events the card networks have ever had to absorb, which is why ordinary travel bookings are a condition above and these are a flat no.",
    items: [
      "commercial airlines, and selling seats on them",
      "cruise lines, and selling passages on them",
      "charter and private aircraft, where the flight crosses a border",
      "timeshares, timeshare resale, and timeshare exit services",
      "holiday and travel clubs sold as a membership",
    ],
  },
  {
    id: "government",
    group: "Government services and public money",
    why: "A payment page that looks official when it is not, or that stands between a person and something their state already provides. The harm lands on the person who could not tell the difference, so it does not depend on whether the service is delivered.",
    items: [
      "services offered by or on behalf of an embassy or a consulate",
      "visa, permit, licence and document applications handled without the authority’s permission",
      "charging for a government service without adding something the applicant could not do themselves",
      "disbursing grants, benefits or other government economic support",
      "anything presented as official, endorsed or approved when it is not",
    ],
  },
  {
    id: "unapproved",
    group: "Trades that need a permission Sailo does not hold",
    why: "Stripe accepts each of these only from a platform it has approved in advance for that category, and Sailo is approved as what it is: software one seller runs one shop on. Saying so here is the honest version — the alternative is accepting the shop and letting Stripe refuse its first card payment.",
    items: [
      "online dating, matchmaking and introduction services",
      "cyberlockers, file hosting, and paid access to a shared drive of files",
      "running a platform inside your shop: letting other people open their own shops, take their own payments, or collect tips through your account",
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
      "keying in card numbers taken somewhere else, so that the shop is really a card terminal",
      "opening an account in one country for a business run from another",
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
