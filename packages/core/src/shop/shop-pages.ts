import type { Shop } from "@sailo/db/schema";
import { countryName, normalizeCountry } from "../place/countries";
import { invoiceIdentity } from "./invoice-identity";

/**
 * The seller's own hosted documents, rendered from facts we already hold.
 *
 * Spec 41, and the smallest thing in the release. `shops.requireTerms` has
 * forced a buyer to accept terms since spec 05, with the enforcement server-side
 * and the acceptance timestamped — and the seller has had nowhere to point it.
 * Most paste nothing and the switch stays off, which is why this exists.
 *
 * ## What this is, said plainly, because the honesty is the product
 *
 * A **template**, filled in from the invoice identity a seller has already given
 * us plus four questions. Easytools sells a generator; the difference between
 * the two is what each says about itself. Nothing here is legal advice and
 * nothing presents itself as legal advice: the disclaimer
 * (`pages.disclaimer` in the storefront dictionary, `legal.disclaimer` in the
 * admin one) is not optional and not dismissible — it renders at the top of the
 * generator and in the footer of every published legal page.
 *
 * ## English only, deliberately
 *
 * The admin chrome around this is translated to thirty-five languages like
 * everything else. **The document is not.** A template in thirty-five languages
 * is not a translation job, it is thirty-five legal documents, and a
 * machine-translated refund clause is the exact case Decision A
 * (`RELEASE-PLAN-2026-08.md` §0.5) names as never machine-translatable. A seller
 * writing in their own language edits the body, which is theirs to write; we
 * make no claim of legal equivalence for a copy we did not author.
 *
 * ## Pure, and why that matters here
 *
 * No database and no clock. `generatedOn` is passed in, so the same shop and the
 * same answers render the same bytes twice — which is what lets a regeneration
 * be diffed against what the seller has on screen instead of being applied and
 * apologised for.
 */

export const SHOP_PAGE_KINDS = [
  "terms",
  "privacy",
  "refunds",
  "about",
  "faq",
] as const;

export type ShopPageKind = (typeof SHOP_PAGE_KINDS)[number];

export function isShopPageKind(value: unknown): value is ShopPageKind {
  return (
    typeof value === "string" && (SHOP_PAGE_KINDS as readonly string[]).includes(value)
  );
}

/**
 * The kinds that carry a legal claim, as opposed to the two that are copy.
 *
 * `about` and `faq` are storefront sections a seller writes for themselves;
 * nothing about them is generated from a template and nothing snapshots them
 * onto an order. The disclaimer, the regeneration warning and the "have this
 * reviewed" register apply to the three above them and would be noise on the
 * two below.
 */
export const LEGAL_PAGE_KINDS = ["terms", "privacy", "refunds"] as const;

export function isLegalPageKind(kind: string): boolean {
  return (LEGAL_PAGE_KINDS as readonly string[]).includes(kind);
}

/**
 * Which template produced a body.
 *
 * Stored per page so a correction to the text below can list the shops still on
 * an old version — without touching a word any of them edited. Bump it when the
 * *meaning* of a template changes; a typo fix is not a new version, because a
 * version bump is a prompt to every seller to re-read their own documents.
 */
export const SHOP_PAGE_TEMPLATE_VERSION = "2026-08";

/** Default slugs. A seller may change one; `kind` is what the admin edits by. */
export const SHOP_PAGE_SLUGS: Readonly<Record<ShopPageKind, string>> = {
  terms: "terms",
  privacy: "privacy",
  refunds: "refunds",
  about: "about",
  faq: "faq",
};

/* -------------------------------------------------------------------------- */
/*  Slugs                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Segments a shop page may not claim under `/[handle]/legal/`.
 *
 * Short, because the route is already nested: `/[handle]/legal/[slug]` cannot
 * shadow `/[handle]/p/[slug]` or any top-level route, so this is not the
 * handle-squatting problem wearing a different hat. What it is guarding is the
 * two segments Next itself would resolve first if this directory ever grew a
 * sibling, plus the shapes that read as a path rather than a name.
 */
const RESERVED_PAGE_SLUGS = new Set(["new", "edit", "index", "api", "_next"]);

export const SHOP_PAGE_SLUG_MAX = 48;

/** `null` when the slug is usable; otherwise the reason, for the form. */
export function validatePageSlug(raw: string): string | null {
  const slug = raw.trim().toLowerCase();
  if (!slug) return "Give the page a web address.";
  if (slug.length > SHOP_PAGE_SLUG_MAX) {
    return `Keep the web address under ${SHOP_PAGE_SLUG_MAX} characters.`;
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    return "Use lowercase letters, numbers and single hyphens.";
  }
  if (RESERVED_PAGE_SLUGS.has(slug)) return "That web address is reserved.";
  return null;
}

/** Best effort at turning a title into a slug. Empty when nothing survives. */
export function toPageSlug(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SHOP_PAGE_SLUG_MAX)
    .replace(/-+$/g, "");
}

/* -------------------------------------------------------------------------- */
/*  The facts a template is filled from                                       */
/* -------------------------------------------------------------------------- */

/**
 * The four things `shops` does not already know.
 *
 * Four, and no more. Everything else on these pages comes from the invoice
 * identity the seller filled in for their invoices — asking for an address twice
 * is how a three-minute setup becomes a form.
 */
export type GeneratorAnswers = {
  /**
   * How many days a buyer has to ask for a refund. `null` means the seller
   * declined to state one, which the template says out loud rather than
   * inventing fourteen.
   */
  refundWindowDays: number | null;
  /** Anything collected beyond the order itself, in the seller's own words. */
  extraDataCollected: string | null;
  /** Whether the storefront runs analytics or advertising tags. */
  usesAnalytics: boolean;
  /** Whether the seller ships physical goods, which changes the refund text. */
  shipsPhysicalGoods: boolean;
};

/**
 * The answer to "do you use analytics", derived rather than asked.
 *
 * A seller who has configured a pixel has already told us; putting the question
 * to them again invites the wrong answer, and a privacy policy that says "we use
 * no analytics" on a storefront loading a Meta pixel is worse than no policy at
 * all — it is a false statement about personal data, on a page whose whole
 * purpose is to be true about personal data.
 *
 * `ga4MeasurementId` is included alongside the three the spec names. The
 * question is whether the storefront runs analytics, and a shop configured with
 * only GA4 runs analytics; leaving it out would pre-answer "no" for exactly the
 * sellers most likely to be measured.
 */
export function analyticsPreanswer(
  shop: Pick<
    Shop,
    "ga4MeasurementId" | "gtmContainerId" | "metaPixelId" | "tiktokPixelId"
  >,
): boolean {
  return Boolean(
    shop.ga4MeasurementId ||
      shop.gtmContainerId ||
      shop.metaPixelId ||
      shop.tiktokPixelId,
  );
}

/**
 * Everything a template needs, flattened, with the gaps visible as gaps.
 *
 * Nullable throughout for the same reason `EvidenceHoldings` is: the interesting
 * case is the sparse shop, and a shape that required its fields could not
 * represent the seller this feature is mostly for — somebody with a trading name,
 * an email and nothing else.
 */
export type ShopPageFacts = {
  shopName: string;
  legalName: string | null;
  addressLines: readonly string[];
  country: string | null;
  contactEmail: string | null;
  registrationNumber: string | null;
  taxId: string | null;
  /** `products.kind` values the shop actually publishes, for the delivery text. */
  sells: readonly string[];
  /** ISO date, passed in. Nothing here reads a clock. */
  generatedOn: string;
} & GeneratorAnswers;

type FactsShop = Parameters<typeof invoiceIdentity>[0] &
  Pick<Shop, "name" | "invoiceCountry" | "invoiceRegistrationNumber" | "taxId">;

/**
 * Read the facts off a shop row, so no caller assembles them by hand.
 *
 * `invoiceIdentity` is reused rather than re-derived: it already decides when a
 * registered entity supersedes a trading name and how an address is ordered for
 * a country, and a second copy of that here would be the pair-of-functions bug
 * with a legal document downstream of it.
 */
export function shopPageFacts(
  shop: FactsShop,
  answers: GeneratorAnswers,
  opts: { sells?: readonly string[]; generatedOn: string; locale?: string },
): ShopPageFacts {
  const identity = invoiceIdentity(shop, opts.locale ?? "en");
  const country = normalizeCountry(shop.invoiceCountry);

  return {
    shopName: shop.name,
    /*
     * Null when the seller never gave a registered entity. `invoiceIdentity`
     * falls back to the trading name, which is right for an invoice header and
     * wrong here: a terms document that silently presents a trading name as the
     * contracting legal entity states something we do not know to be true.
     */
    legalName: shop.invoiceLegalName?.trim() || null,
    addressLines: identity.addressLines,
    country: country ? countryName(country, opts.locale ?? "en") : null,
    contactEmail: identity.email,
    registrationNumber: shop.invoiceRegistrationNumber?.trim() || null,
    taxId: shop.taxId?.trim() || null,
    sells: opts.sells ?? [],
    generatedOn: opts.generatedOn,
    ...answers,
  };
}

/* -------------------------------------------------------------------------- */
/*  Rendering                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * What a missing fact renders as.
 *
 * Never blank and never `undefined`. A published page reading "These terms are
 * between you and undefined" is the failure this whole module is written
 * against, and a blank is barely better — the seller does not see the hole and
 * the buyer reads a sentence with a piece cut out of it. So a gap announces
 * itself, in a form nobody would mistake for finished prose, and every one of
 * them is also returned in `gaps` so the admin can say "three details missing"
 * before the seller publishes.
 */
export function missingMark(what: string): string {
  return `**[${what} — add this before publishing]**`;
}

export type RenderedPage = {
  kind: ShopPageKind;
  title: string;
  bodyMd: string;
  /** Human-readable descriptions of every `missingMark` in the body. */
  gaps: readonly string[];
  templateVersion: string;
};

const TITLES: Readonly<Record<ShopPageKind, string>> = {
  terms: "Terms of Sale",
  privacy: "Privacy Policy",
  refunds: "Refunds and Returns",
  about: "About",
  faq: "Frequently asked questions",
};

/** A collector, so a template can ask for a fact and record its absence once. */
function factReader() {
  const gaps: string[] = [];
  const need = (value: string | null | undefined, what: string): string => {
    if (value && value.trim()) return value.trim();
    if (!gaps.includes(what)) gaps.push(what);
    return missingMark(what);
  };
  return { gaps, need };
}

/** "Ada Lovelace Ltd, 12 Bridge Street, Lisbon, Portugal" — or the gap markers. */
function seller(facts: ShopPageFacts, need: ReturnType<typeof factReader>["need"]) {
  const name = need(facts.legalName ?? facts.shopName, "your business name");
  const address = facts.addressLines.length
    ? facts.addressLines.join(", ")
    : need(null, "your business address");
  return { name, address };
}

function whatWeSell(facts: ShopPageFacts): string {
  const words: Record<string, string> = {
    physical: "physical goods we send to you",
    digital: "digital files and downloads",
    service: "services and appointments",
    event: "tickets to events",
    membership: "memberships that renew",
  };
  const listed = facts.sells
    .map((kind) => words[kind])
    .filter((word): word is string => Boolean(word));
  const [only] = listed;
  if (!only) return "the items listed on our shop";
  if (listed.length === 1) return only;
  return `${listed.slice(0, -1).join(", ")} and ${listed.at(-1)}`;
}

function refundSentence(facts: ShopPageFacts): string {
  if (facts.refundWindowDays === null) {
    return (
      "We have not set a standard refund window. " +
      missingMark("how many days a buyer has to ask for a refund") +
      " Until you state one, buyers will rely on whatever their local consumer " +
      "law gives them, which in the EU and UK is usually 14 days from delivery " +
      "for distance sales."
    );
  }
  if (facts.refundWindowDays === 0) {
    return (
      "We do not offer refunds beyond what the law requires of us. Your " +
      "statutory rights are unaffected: in the EU and the UK, distance selling " +
      "rules give you a 14-day right to cancel most purchases, with exceptions " +
      "for digital content you have started to download and for services you " +
      "asked us to begin."
    );
  }
  return (
    `You can ask us for a refund within **${facts.refundWindowDays} days** of ` +
    `receiving your order. This is our own policy and it sits on top of your ` +
    `statutory rights, which it does not reduce.`
  );
}

function termsBody(facts: ShopPageFacts): { body: string; gaps: readonly string[] } {
  const { gaps, need } = factReader();
  const who = seller(facts, need);
  const email = need(facts.contactEmail, "a contact email address");

  const lines = [
    `_Last updated ${facts.generatedOn}._`,
    "",
    "## Who you are buying from",
    "",
    `These terms are between you and **${who.name}**, at ${who.address}` +
      `${facts.country ? `, ${facts.country}` : ""}.` +
      (facts.registrationNumber ? ` Registered number ${facts.registrationNumber}.` : "") +
      (facts.taxId ? ` Tax registration ${facts.taxId}.` : ""),
    "",
    `You can reach us at ${email}.`,
    "",
    `We sell ${whatWeSell(facts)}. The shop is hosted on Sailo, which processes ` +
      "orders and payments on our behalf. Your contract for what you buy is with " +
      "us, not with Sailo.",
    "",
    "## Placing an order",
    "",
    "Prices and availability are as shown at the moment you order. If we cannot " +
      "fulfil an order — something is out of stock, a price was wrong, an " +
      "appointment is no longer free — we will tell you and refund you in full.",
    "",
    "Your order is accepted when we confirm it, not when you submit it.",
    "",
    "## Paying",
    "",
    "Payment is taken through the methods shown at checkout. Card payments are " +
      "processed by Stripe; we never see or store your card details.",
    "",
    "## Delivery and access",
    "",
    facts.shipsPhysicalGoods
      ? "We aim to send physical orders promptly and will give you tracking where " +
        "the carrier provides it. Delivery estimates are estimates, not promises, " +
        "and risk in the goods passes to you when they are delivered."
      : "Digital goods and access are released once payment clears. If a download " +
        "link or an access code does not work, tell us and we will fix it.",
    "",
    "## Refunds",
    "",
    refundSentence(facts),
    "",
    "Our full refund terms are on our Refunds page.",
    "",
    "## Things we are not responsible for",
    "",
    "We are responsible for loss you suffer that is a foreseeable result of us " +
      "breaking these terms. We are not responsible for loss that was not " +
      "foreseeable, or for business losses. Nothing here limits our liability for " +
      "death or personal injury caused by our negligence, for fraud, or for " +
      "anything else the law does not allow us to limit.",
    "",
    "## Changes",
    "",
    "We may change these terms. The version that applies to your order is the one " +
      "published when you placed it — a copy of it is recorded against your order " +
      "at the moment you accept it, so a later change cannot rewrite what you " +
      "agreed to.",
    "",
    "## Complaints",
    "",
    `Write to ${email} and we will answer.`,
  ];

  return { body: lines.join("\n"), gaps };
}

function privacyBody(facts: ShopPageFacts): { body: string; gaps: readonly string[] } {
  const { gaps, need } = factReader();
  const who = seller(facts, need);
  const email = need(facts.contactEmail, "a contact email address");

  const lines = [
    `_Last updated ${facts.generatedOn}._`,
    "",
    "## Who is responsible for your data",
    "",
    `**${who.name}**, at ${who.address}` +
      `${facts.country ? `, ${facts.country}` : ""}, is the controller of the ` +
      "personal data described here. Sailo hosts our shop and processes that data " +
      "on our instructions.",
    "",
    `Questions, or a request about your own data: ${email}.`,
    "",
    "## What we collect",
    "",
    "**When you order.** Your name, email address, and — where what you bought " +
      "needs it — your phone number and delivery address. What you ordered, what " +
      "you paid, and when.",
    "",
    "**Automatically, when you order.** The IP address and browser your order was " +
      "placed from, and the date and time you accepted our terms. We keep these " +
      "because a bank can reverse a payment months later and ask us to show the " +
      "order was genuine; without them we cannot answer.",
    "",
    "**Messages.** Emails we send you about an order, as they were sent, and any " +
      "conversation you have with us about it.",
    "",
    facts.usesAnalytics
      ? "**Measurement.** Our shop uses analytics and advertising tools that set " +
        "cookies to measure visits and adverts. They load only if you accept them " +
        "in the cookie banner, and declining changes nothing about your order."
      : "**Measurement.** We do not run analytics or advertising tools on our shop.",
    "",
    facts.extraDataCollected
      ? `**Anything else we ask for.** ${facts.extraDataCollected}`
      : "We ask for nothing beyond the above.",
    "",
    "## Why we are allowed to hold it",
    "",
    "- To perform our contract with you — taking, fulfilling and supporting your " +
      "order.\n" +
      "- To meet legal obligations — tax and invoicing records, which we must keep " +
      "for several years whatever else happens.\n" +
      "- Our legitimate interests — preventing fraud, and defending a payment " +
      "dispute.\n" +
      "- Your consent — marketing email, and any measurement tool, both of which " +
      "you can withdraw at any time.",
    "",
    "## Who else sees it",
    "",
    "Sailo, which hosts the shop. Stripe, if you pay by card. The carrier, if we " +
      "post you something. An email provider, to send you your receipt. Nobody " +
      "buys it, and we sell nothing to anybody.",
    "",
    "## How long we keep it",
    "",
    "Order and invoice records for as long as tax law requires — commonly six to " +
      "ten years. Marketing consent until you withdraw it. Records of an " +
      "unsubscribe are kept **permanently and on purpose**: it is how we know not " +
      "to email you again, and deleting it would put you back on the list.",
    "",
    "## Your rights",
    "",
    "You can ask for a copy of what we hold, ask us to correct it, ask us to " +
      "delete it, object to us using it, or ask for it in a portable form. Use the " +
      `"Request your data" link in our footer, or write to ${email}. We answer ` +
      "within one month.",
    "",
    "Some of it we must keep even when you ask us to delete it — an invoice is a " +
      "tax record and cannot be unmade. Where that applies we will tell you which " +
      "data, why, and for how long.",
    "",
    "You can also complain to your data protection authority.",
  ];

  return { body: lines.join("\n"), gaps };
}

function refundsBody(facts: ShopPageFacts): { body: string; gaps: readonly string[] } {
  const { gaps, need } = factReader();
  const email = need(facts.contactEmail, "a contact email address");

  const lines = [
    `_Last updated ${facts.generatedOn}._`,
    "",
    "## Our refund window",
    "",
    refundSentence(facts),
    "",
    "## How to ask",
    "",
    `Email ${email} with your order number and what went wrong. We will reply and ` +
      "tell you what happens next.",
    "",
    facts.shipsPhysicalGoods
      ? "## Returns\n\nSend the item back in the condition you received it. Tell us " +
        "before you post anything so we can give you the right address. We refund " +
        "to the payment method you used, normally within a few days of the item " +
        "arriving back."
      : "## Digital goods\n\nWhere the law gives you a right to cancel a digital " +
        "purchase, that right ends once you start downloading — you will be asked " +
        "to agree to that at checkout. If a file is wrong, broken, or not what was " +
        "described, that is our problem to fix and the window above does not apply.",
    "",
    "## Things we cannot refund",
    "",
    "Items made or personalised for you, and anything sealed for health reasons " +
      "that has been opened, unless what you received was faulty or not as " +
      "described.",
    "",
    "## If something is faulty",
    "",
    "Your statutory rights apply whatever this page says. A faulty or misdescribed " +
      "item can be returned for a refund, repair or replacement, and our own window " +
      "does not shorten that.",
  ];

  return { body: lines.join("\n"), gaps };
}

function aboutBody(facts: ShopPageFacts): { body: string; gaps: readonly string[] } {
  const { gaps, need } = factReader();
  const email = need(facts.contactEmail, "a contact email address");
  const lines = [
    `## ${facts.shopName}`,
    "",
    `We sell ${whatWeSell(facts)}.`,
    "",
    "Write two or three sentences here about who you are and why somebody should " +
      "buy from you. This block is yours — nothing on it is generated from a " +
      "template, and it is the one page on this list a buyer actually wants to read.",
    "",
    `Get in touch at ${email}.`,
  ];
  return { body: lines.join("\n"), gaps };
}

function faqBody(facts: ShopPageFacts): { body: string; gaps: readonly string[] } {
  const { gaps, need } = factReader();
  const email = need(facts.contactEmail, "a contact email address");

  /*
   * Question/answer pairs as `###` headings with a paragraph under each. The
   * storefront accordion parses exactly this shape, so the seller edits one
   * document rather than filling in a pair of fields per question — and a
   * heading they add by hand becomes an accordion row with no extra step.
   */
  const lines = [
    "### How long does delivery take?",
    "",
    facts.shipsPhysicalGoods
      ? "We post orders as soon as we can and send you tracking where the carrier " +
        "provides it. Replace this with your own timings."
      : "Your files or access details are released as soon as your payment clears.",
    "",
    "### Can I get a refund?",
    "",
    refundSentence(facts),
    "",
    "### How do I get in touch?",
    "",
    `Email ${email} and we will get back to you.`,
  ];

  return { body: lines.join("\n"), gaps };
}

const TEMPLATES: Readonly<
  Record<ShopPageKind, (facts: ShopPageFacts) => { body: string; gaps: readonly string[] }>
> = {
  terms: termsBody,
  privacy: privacyBody,
  refunds: refundsBody,
  about: aboutBody,
  faq: faqBody,
};

/**
 * Render one page from the facts.
 *
 * Deterministic: same facts, same bytes. That is what makes "regenerating warns
 * and offers a diff" a real offer rather than an approximation — the diff shown
 * is the diff that would be applied.
 */
export function renderShopPage(kind: ShopPageKind, facts: ShopPageFacts): RenderedPage {
  const { body, gaps } = TEMPLATES[kind](facts);
  return {
    kind,
    title: TITLES[kind],
    bodyMd: body,
    gaps,
    templateVersion: SHOP_PAGE_TEMPLATE_VERSION,
  };
}

/** Every page a generator run produces, in the order the admin lists them. */
export function renderShopPages(facts: ShopPageFacts): RenderedPage[] {
  return SHOP_PAGE_KINDS.map((kind) => renderShopPage(kind, facts));
}

/* -------------------------------------------------------------------------- */
/*  Reading a rendered FAQ back                                               */
/* -------------------------------------------------------------------------- */

export type FaqEntry = { question: string; answer: string };

/**
 * Pull question/answer pairs out of an FAQ body.
 *
 * The storefront accordion needs pairs and the seller edits one markdown
 * document, so this is the seam. `###` starts a question and everything until
 * the next `###` is its answer — which means a seller who types a new heading
 * gets a new row without learning a syntax.
 *
 * Anything before the first heading is dropped rather than shown as an
 * unlabelled panel: a preamble in an accordion is a row with no title, which
 * renders as a blank strip nobody can click.
 */
export function parseFaq(bodyMd: string | null | undefined): FaqEntry[] {
  if (!bodyMd) return [];
  const out: FaqEntry[] = [];
  let current: FaqEntry | null = null;

  for (const line of bodyMd.split(/\r?\n/)) {
    const question = /^#{2,4}\s+(.*\S)\s*$/.exec(line)?.[1];
    if (question) {
      if (current && current.answer.trim()) out.push(current);
      current = { question, answer: "" };
      continue;
    }
    if (current) current.answer += `${line}\n`;
  }
  if (current && current.answer.trim()) out.push(current);

  return out.map((entry) => ({ ...entry, answer: entry.answer.trim() }));
}
