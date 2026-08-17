import "server-only";
import { appOrigin } from "@sailo/core/origin";
import { HERO_DEMO } from "../demos";
import { lifecycleGap, type LifecycleStepId } from "./steps";
import type { LifecycleState } from "./state";
import { MARKETING, sender, type Message } from "@sailo/email/transport";
import {
  button,
  esc,
  fine,
  mutedPara,
  para,
  sailoLayout,
  well,
} from "@sailo/email/markup";

/**
 * The words. Every lifecycle email Sailo sends a seller, and nothing else —
 * no scheduling, no eligibility, no sending. `lib/lifecycle/steps.ts` decides
 * who gets which; this decides what it says.
 *
 * ONE COPY SOURCE, TWO RENDERINGS. Each template returns a `Draft` of plain
 * sentences, and `render` turns that into both the HTML part and the
 * plain-text part. Writing the two by hand is how they drift, and a marketing
 * email with no text part — or with a stale one — is scored as bulk mail by
 * every provider that looks. Plain sentences also mean the templates cannot
 * accidentally emit unescaped markup: `render` escapes everything on the way
 * out, so a seller whose shop is called `<script>` is a rendering detail
 * rather than an incident.
 *
 * WHY THE COPY IS SHORT AND UNEXCITED. These land beside order notifications
 * from the same domain. Every exclamation mark spent here is borrowed against
 * the mail that tells a seller they have been paid, so the voice is the same
 * one the rest of the product uses: say the thing, name the next action, stop.
 */

/**
 * A message before it is HTML.
 *
 * `paras` and `bullets` are plain text and are escaped by `render`. `cta` is
 * the one action the email is asking for — at most one, always, because a
 * message with two buttons is a message that decided nothing.
 */
type Draft = {
  subject: string;
  heading: string;
  /** The line the inbox shows under the subject. Never a repeat of it. */
  preheader: string;
  paras: string[];
  bullets?: string[];
  /** Set off in a box — the seller's own link, mostly. */
  highlight?: string;
  cta?: { href: string; label: string };
  fine?: string;
};

const admin = (path = "") => `${appOrigin()}/admin${path}`;
const shopUrl = (handle: string) => `${appOrigin()}/${handle}`;
const demoUrl = () => `${appOrigin()}/${HERO_DEMO.handle}`;

/** "product" / "products", without dragging in an i18n dependency for one word. */
const plural = (n: number, one: string, many = `${one}s`) =>
  n === 1 ? one : many;

/** The seller's first name, when we have something usable to greet them with. */
function firstName(state: LifecycleState): string | null {
  const first = state.name.trim().split(/\s+/)[0];
  return first && first.length <= 40 ? first : null;
}

/**
 * "Amira — your shop is live", or "Your shop is live" when there is no name
 * worth using. The sentence is written lower-case so it reads as a
 * continuation after the name, and is capitalised here when it has to stand
 * on its own instead.
 */
const greet = (state: LifecycleState, rest: string) => {
  const name = firstName(state);
  if (name) return `${name} — ${rest}`;
  return rest.charAt(0).toUpperCase() + rest.slice(1);
};

/* -------------------------------------------------------------------------- */
/*  The ladder, in words                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Signed up, no shop. Two hours in.
 *
 * The most valuable email in the pipeline and the one most likely to be
 * resented, because the person receiving it started something two hours ago
 * and may simply have been interrupted. So it is short, it does not scold,
 * and it says how little is left to do rather than how much they are missing.
 */
function noShop1(state: LifecycleState): Draft {
  return {
    subject: "Your shop is about two minutes away",
    heading: "Finish setting up your shop",
    preheader: "A name, a handle, and what you sell. That's the whole form.",
    paras: [
      greet(
        state,
        "your Sailo account is ready, but there's no shop on it yet.",
      ),
      "It's one screen: a name, the handle your link ends in, and roughly what you sell. You get a working page and a link you can paste into a bio the moment you save it — and everything on it can be changed afterwards.",
    ],
    cta: { href: `${appOrigin()}/onboarding`, label: "Set up my shop" },
    fine: "Nothing to install, and no card needed to start selling.",
  };
}

/**
 * Two days in. Shows rather than tells: the fastest way to explain a
 * link-in-bio shop is to open one, and there are five real ones on the
 * marketing site already.
 */
function noShop2(state: LifecycleState): Draft {
  return {
    subject: `What a Sailo shop looks like`,
    heading: "Here's one that's live",
    preheader: `${HERO_DEMO.name} takes orders from a single link in a bio.`,
    paras: [
      greet(state, "your account is still waiting on a shop, so here is what one looks like finished."),
      `${HERO_DEMO.name} sells from one link in their ${HERO_DEMO.instagram ? "Instagram" : "social"} bio. Everything a buyer needs — the products, the prices, and the way they pay — is on that one page.`,
    ],
    bullets: [
      "Physical things, with delivery or collection",
      "Digital files, delivered the moment they're paid for",
      "Appointments and events, with the times you're actually free",
    ],
    highlight: demoUrl(),
    cta: { href: `${appOrigin()}/onboarding`, label: "Build mine" },
  };
}

/**
 * Nine days in, and the last word on the subject.
 *
 * The promise is kept by the ladder itself: nothing further is scheduled for
 * somebody who never builds a shop, so this can say "last" without it being a
 * negotiating tactic. Saying it is what keeps this out of the spam folder —
 * the alternative is a pipeline that never admits it is finished, and people
 * stop those with the report button rather than the unsubscribe link.
 */
function noShop3(state: LifecycleState): Draft {
  return {
    subject: "Last email about setting up",
    heading: "We'll leave it there",
    preheader: "Your account stays open. Come back whenever you want.",
    paras: [
      greet(state, "this is the last we'll write about setting up a shop."),
      "Your account stays open and nothing expires, so if the moment comes — a thing to sell, a bio that needs a link — it's still here and it still takes about two minutes.",
    ],
    cta: { href: `${appOrigin()}/onboarding`, label: "Set up my shop" },
    fine: "You'll still get order and account emails if you start selling.",
  };
}

/**
 * The shop exists. The only rung that is not a nudge.
 *
 * What it exists to do is put the seller's public link somewhere they can
 * find it again, in an inbox they already search. Everything else in it is
 * secondary to that one line.
 */
function shopLive(state: LifecycleState): Draft {
  const handle = state.shop?.handle ?? "";
  return {
    subject: `${state.shop?.name ?? "Your shop"} is live`,
    heading: "Your shop is live",
    preheader: `${shopUrl(handle).replace(/^https?:\/\//, "")} — your link, ready to share.`,
    paras: [
      greet(state, "your shop is up and open to anyone with the link."),
      "This is the link. It belongs in the one place people already look for it — the bio of whichever account you post from.",
    ],
    highlight: shopUrl(handle),
    bullets: [
      "Add a product, so there's something to buy",
      "Switch on how you take money — cash, transfer, chat or card",
      "Put the link in your bio",
    ],
    cta: { href: admin(), label: "Open my dashboard" },
  };
}

/** Two days with a shop and nothing in it. */
function noProduct1(state: LifecycleState): Draft {
  return {
    subject: "Your shop has nothing in it yet",
    heading: "Add your first product",
    preheader: "A photo, a price, and a name. You can edit it later.",
    paras: [
      greet(state, `${state.shop?.name ?? "your shop"} is live, but there's nothing on the page for anyone to buy.`),
      "One product is enough to open. A photo, a name and a price is the whole form, and nothing about it is permanent — most sellers rewrite their first listing within a week.",
    ],
    cta: { href: admin("/products/new"), label: "Add a product" },
    fine: "Physical, digital, a service or an event — the form adapts to which.",
  };
}

/** Eight days with a shop and nothing in it. Different angle, same ask. */
function noProduct2(state: LifecycleState): Draft {
  return {
    subject: "One product is enough to open",
    heading: "Start with one",
    preheader: "The full catalogue can wait. The first listing can't.",
    paras: [
      greet(state, "the thing that stops most shops opening is trying to list everything at once."),
      "It isn't necessary. Put up the one thing you'd sell today — the best photo you already have, the price you'd charge a friend — and share the link. The rest of the catalogue is easier to build once something is actually selling.",
    ],
    cta: { href: admin("/products/new"), label: "Add one product" },
  };
}

/**
 * Something to sell, no way to be paid for it.
 *
 * The most expensive gap in the funnel: the seller believes they are open,
 * their link works, their products look right, and the buy button has nowhere
 * to send anybody. Named plainly for that reason.
 */
function noRail(state: LifecycleState): Draft {
  const n = state.productCount;
  return {
    subject: "Nobody can pay you yet",
    heading: "Turn on a way to get paid",
    preheader: "Your products are up, but checkout has nowhere to send anyone.",
    paras: [
      greet(
        state,
        `${state.shop?.name ?? "your shop"} has ${n} ${plural(n, "product")} up, but no way for a buyer to pay.`,
      ),
      "Until one is switched on, someone who wants to buy gets as far as the button and stops. It takes a minute, and you can turn on as many as you like.",
    ],
    bullets: [
      "Cash on delivery — nothing to set up",
      "Bank transfer — your details, shown at checkout",
      "WhatsApp, Telegram or Instagram — the order lands in your chat",
      "Card payments, through your own Stripe account",
    ],
    cta: { href: admin("/payments"), label: "Set up payments" },
  };
}

/** Ready to sell, nobody has arrived. Three days. */
function noOrders1(state: LifecycleState): Draft {
  const handle = state.shop?.handle ?? "";
  return {
    subject: "Your shop's ready — now it needs people",
    heading: "Getting the first order",
    preheader: "Everything's set up. What's missing is traffic.",
    paras: [
      greet(state, "your shop is set up properly: products up, payment on, link working."),
      "What's left is the part Sailo can't do for you — getting people to the page. Nearly every first order comes from somewhere the seller already had an audience, not from strangers.",
    ],
    bullets: [
      "Put the link in your bio, not in a post — posts scroll away",
      "Tell the people who already ask you for prices, one by one",
      "Pin a post that says what you sell and where to buy it",
    ],
    highlight: shopUrl(handle),
    cta: { href: shopUrl(handle), label: "See my shop" },
  };
}

/** Twelve days, still nothing. More concrete, less encouragement. */
function noOrders2(state: LifecycleState): Draft {
  return {
    subject: "Three things that get a first order",
    heading: "What tends to work",
    preheader: "Specific things, from shops that got past this point.",
    paras: [
      greet(state, "still no orders — so here are the three things that most often change that."),
    ],
    bullets: [
      "Message ten people who have asked you about prices before. Not a broadcast — ten separate messages with the link.",
      "Post the thing, not the shop. \"New batch, six left, link in bio\" outsells \"check out my store\" every time.",
      "Print the QR code from your dashboard and put it wherever you already meet people — a market stall, a counter, a business card.",
    ],
    cta: { href: admin(), label: "See who's visiting" },
    fine: "Your dashboard counts visits even when nobody buys — that's what tells you whether the problem is traffic or the page.",
  };
}

/**
 * A day after the first sale.
 *
 * The order notification already went out when it happened; this is the
 * different thing worth saying, which is what the sale means and what to do
 * with the momentum. Sent a day later precisely so it does not compete with
 * the mail that carries the order itself.
 */
function firstSale(state: LifecycleState): Draft {
  return {
    subject: "That's your first sale",
    heading: "You've made your first sale",
    preheader: "The hard part is behind you. Here's what tends to come next.",
    paras: [
      greet(state, `${state.shop?.name ?? "your shop"} has taken its first order.`),
      "That's the part most shops never get to. The second order is much easier than the first, and it usually comes from doing one of these while the first buyer is still pleased with you.",
    ],
    bullets: [
      "Ask them for a review — it goes on the product page and sells the next one",
      "Add something that pairs with what they bought",
      "Post that you sold one. Proof does more than a discount",
    ],
    cta: { href: admin("/orders"), label: "Open my orders" },
  };
}

/**
 * The only rung that asks for money, and it asks after three sales.
 *
 * Pitched on what the seller has already proved they do rather than on a
 * feature list: somebody with orders on the board wants the constraint
 * removed, not a tour.
 */
function upgrade(state: LifecycleState): Draft {
  const n = state.orderCount;
  return {
    subject: `${n} orders in — worth a look at Pro`,
    heading: "What Pro adds",
    preheader: "Card payments, coupons, affiliates, and your name on your own mail.",
    paras: [
      greet(state, `${state.shop?.name ?? "your shop"} has taken ${n} ${plural(n, "order")}. It works.`),
      "Everything below is the sort of thing that only matters once a shop is actually selling, which is why it isn't on the free plan and why we haven't mentioned it until now.",
    ],
    bullets: [
      "Card payments at checkout, straight into your own Stripe account",
      "Discount codes, and affiliates who get paid for what they sell",
      "Your own name on your shop and your emails, with the Sailo badge off",
      "Longer analytics history, and CSV export of everything",
    ],
    cta: { href: admin("/settings/billing"), label: "Compare the plans" },
    fine: "The free plan isn't going anywhere. Staying on it is a fine answer.",
  };
}

/**
 * The one email for everybody the ladder arrived too late for.
 *
 * It reads the seller's current state and names the single thing in their way,
 * rather than pretending to be the rung they missed. That is the only honest
 * thing to send somebody who signed up months ago: not "welcome", not "your
 * shop is live", but "here is where you actually stopped".
 */
function catchUp(state: LifecycleState): Draft {
  const gap = lifecycleGap(state);
  const name = state.shop?.name ?? "your shop";

  if (gap === "shop") {
    return {
      subject: "Your Sailo account is still here",
      heading: "Your account is still open",
      preheader: "No shop on it yet — it's a two-minute form whenever you want.",
      paras: [
        greet(state, "you opened a Sailo account a while back and never built the shop."),
        "It's still here, and it still takes about two minutes: a name, a handle, and what you sell. If you've since found somewhere better to sell, that's genuinely fine — this is the only reminder.",
      ],
      cta: { href: `${appOrigin()}/onboarding`, label: "Set up my shop" },
    };
  }

  if (gap === "product") {
    return {
      subject: `${name} is live but empty`,
      heading: "Your shop has nothing in it",
      preheader: "One product is enough to open it properly.",
      paras: [
        greet(state, `${name} is live, but there's nothing on the page to buy.`),
        "One listing is enough to open — a photo, a name, a price. Nothing about it is permanent.",
      ],
      cta: { href: admin("/products/new"), label: "Add a product" },
    };
  }

  if (gap === "rail") {
    return {
      subject: "Nobody can pay you yet",
      heading: "Turn on a way to get paid",
      preheader: "Your products are up. Checkout has nowhere to send anyone.",
      paras: [
        greet(state, `${name} has products up, but no way for a buyer to pay for them.`),
        "Cash on delivery, a bank transfer, a WhatsApp handoff or card payments — any one of them opens the checkout, and switching one on takes a minute.",
      ],
      cta: { href: admin("/payments"), label: "Set up payments" },
    };
  }

  return {
    subject: "Your shop is ready — it just needs people",
    heading: "Everything's set up",
    preheader: "What's left is traffic, and that part is worth ten minutes.",
    paras: [
      greet(state, `${name} is set up properly and hasn't had an order yet.`),
      "That's almost always traffic rather than the shop. The first order nearly always comes from an audience you already have, not from strangers finding the page.",
    ],
    bullets: [
      "Put the link in your bio, not in a post",
      "Message the people who have asked you for prices before",
      "Print the QR code from your dashboard for wherever you meet people",
    ],
    highlight: state.shop ? shopUrl(state.shop.handle) : undefined,
    cta: { href: admin(), label: "Open my dashboard" },
  };
}

/**
 * Every step has copy, checked by the compiler.
 *
 * `satisfies Record<LifecycleStepId, …>` is the whole reason this is a record
 * and not a switch: adding a rung to the ladder without writing its email is
 * a type error at build time rather than a `undefined is not a function` on
 * the first tick after deploy.
 */
const DRAFTS = {
  no_shop_1: noShop1,
  no_shop_2: noShop2,
  no_shop_3: noShop3,
  shop_live: shopLive,
  no_product_1: noProduct1,
  no_product_2: noProduct2,
  no_rail: noRail,
  no_orders_1: noOrders1,
  no_orders_2: noOrders2,
  first_sale: firstSale,
  upgrade,
  catch_up: catchUp,
} satisfies Record<LifecycleStepId, (state: LifecycleState) => Draft>;

/* -------------------------------------------------------------------------- */
/*  Rendering                                                                  */
/* -------------------------------------------------------------------------- */

const bulletList = (items: string[]) =>
  `<ul style="margin:0 0 16px;padding-left:20px;font-size:15px;line-height:1.7;color:#565664;">${items
    .map((item) => `<li style="margin:0 0 6px;">${esc(item)}</li>`)
    .join("")}</ul>`;

function html(draft: Draft, unsubscribeUrl: string): string {
  const blocks = [
    ...draft.paras.map((text, i) =>
      // The first paragraph carries the news and reads as body text; the rest
      // is context and steps back a shade, the same way the order mails do it.
      i === 0 ? mutedPara(esc(text)) : para(esc(text)),
    ),
    draft.highlight ? well(draft.highlight) : "",
    draft.bullets ? bulletList(draft.bullets) : "",
    draft.cta ? button(draft.cta.href, draft.cta.label) : "",
    draft.fine ? fine(esc(draft.fine)) : "",
  ];

  return sailoLayout(draft.heading, blocks.join("\n"), {
    preheader: draft.preheader,
    unsubscribeUrl,
  });
}

/**
 * The plain-text part, built from the same draft.
 *
 * Not a courtesy. A message with only an HTML part is scored as bulk by every
 * provider that looks at the multipart structure, and it renders as nothing
 * at all in the text-only clients that still exist behind corporate mail
 * gateways. The unsubscribe line is repeated here because a person reading
 * the text part cannot click the footer they cannot see.
 */
function plainText(draft: Draft, unsubscribeUrl: string): string {
  const parts = [
    draft.heading,
    "",
    ...draft.paras.flatMap((p) => [p, ""]),
    ...(draft.highlight ? [draft.highlight, ""] : []),
    ...(draft.bullets ? [...draft.bullets.map((b) => `- ${b}`), ""] : []),
    ...(draft.cta ? [`${draft.cta.label}: ${draft.cta.href}`, ""] : []),
    ...(draft.fine ? [draft.fine, ""] : []),
    "—",
    `Unsubscribe from tips like this: ${unsubscribeUrl}`,
    "Order, billing and account emails are separate and keep arriving.",
  ];
  return parts.join("\n");
}

/**
 * One lifecycle email, ready to hand to the transport.
 *
 * Returns a `Message` rather than sending it, unlike every other builder in
 * this folder. The send pass has to claim a row, send, and write the
 * provider's id back to that row, and splitting the send away from the claim
 * would put the two on either side of a function boundary that a future
 * caller could skip. Here the caller cannot send without having claimed.
 *
 * `oneClickUrl` and `pageUrl` are two views of the same token: the header the
 * mail client presses, and the page a human opens. Both are required — a
 * missing header costs deliverability at Gmail, and a missing footer link
 * costs the trust of the person who wanted to leave and had to go hunting.
 */
export function lifecycleMessage(opts: {
  step: LifecycleStepId;
  state: LifecycleState;
  /** The `List-Unsubscribe` target: a POST route, per RFC 8058. */
  oneClickUrl: string;
  /** The confirm page the footer links to. */
  pageUrl: string;
}): Message {
  const draft = DRAFTS[opts.step](opts.state);

  return {
    from: sender("Sailo", MARKETING),
    to: opts.state.email,
    subject: draft.subject,
    html: html(draft, opts.pageUrl),
    text: plainText(draft, opts.pageUrl),
    headers: {
      /*
       * RFC 8058. The pair is what puts a one-click unsubscribe in Gmail's
       * own chrome, and Gmail requires it on bulk mail — a sender without it
       * is a sender whose mail goes to spam, which for this domain means a
       * seller's order confirmations going with it.
       */
      "List-Unsubscribe": `<${opts.oneClickUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  };
}
