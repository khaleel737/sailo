/**
 * The daily post library.
 *
 * Voice rule, inherited from `content/blog`: no hype, no "🚀 game changer", no
 * manufactured urgency. The posts that travel for a tool like this are the ones
 * that name a problem the seller already has, in their words, with a number
 * attached. Every claim here is one the product actually keeps — free tier at 20
 * products, WhatsApp ordering, no KYC — because a caption that oversells is a
 * refund request three days later.
 *
 * One entry per day, cycled by day-of-year, so nothing repeats inside three
 * weeks. Add entries freely; the rotation length is just `POSTS.length`.
 *
 * Hashtags: Instagram allows 30 but rewards relevance, not volume — each set is
 * 12-15 tags mixing broad reach, mid-tier and high-intent niche. LinkedIn is
 * capped at 4 by convention, X at 2, Facebook at 5, where more reads as spam.
 */

export type Template = "statement" | "playbook" | "phones" | "contrast" | "stat";

export type Post = {
  /** Stable slug — used in the blob path and the run log. */
  id: string;
  pillar: "ownership" | "catalogue" | "orders" | "proof" | "objection" | "global";
  template: Template;
  /** Fields consumed by the matching template in `templates.ts`. */
  art: Record<string, string | string[]>;
  caption: { instagram: string; facebook: string; linkedin: string; x: string };
  /** Alt text — accessibility, and Instagram indexes it. */
  alt: string;
  /** Optional deep link appended to the LinkedIn/Facebook caption. */
  link?: string;
};

const TAGS = {
  ownership: [
    "#linkinbio", "#smallbusiness", "#smallbusinessowner", "#creatorbusiness",
    "#socialselling", "#onlineselling", "#shopsmall", "#buildyourbrand",
    "#smallbiz", "#digitalstorefront", "#ownyouraudience", "#sellonline",
    "#businesstips", "#instagramshop",
  ],
  catalogue: [
    "#productphotography", "#smallbusinesstips", "#onlineshop", "#linkinbio",
    "#ecommercetips", "#shopsmall", "#smallbusiness", "#productcatalogue",
    "#sellonline", "#onlinestore", "#smallbizowner", "#craftbusiness",
    "#handmadebusiness", "#storefront",
  ],
  orders: [
    "#whatsappbusiness", "#smallbusiness", "#customerservice", "#onlineselling",
    "#dmtoorder", "#socialselling", "#shopsmall", "#smallbusinessowner",
    "#orders", "#linkinbio", "#sellonline", "#businessowner",
    "#smallbiztips", "#ecommerce",
  ],
  proof: [
    "#linkinbio", "#smallbusiness", "#onlineshop", "#shopsmall", "#foodbusiness",
    "#nailtech", "#massagetherapist", "#smallbusinessowner", "#storefront",
    "#sellonline", "#localbusiness", "#servicebusiness", "#bookings",
    "#onlinestore",
  ],
  objection: [
    "#smallbusiness", "#sellonline", "#onlineselling", "#cashondelivery",
    "#nocode", "#smallbusinesstips", "#shopsmall", "#ecommerce", "#linkinbio",
    "#businesstips", "#smallbizowner", "#startselling", "#sidehustle",
    "#onlinebusiness",
  ],
  global: [
    "#smallbusiness", "#whatsappbusiness", "#sellonline", "#globalbusiness",
    "#linkinbio", "#shopsmall", "#onlineselling", "#ecommerce",
    "#smallbusinessowner", "#entrepreneur", "#sidehustle", "#onlinestore",
    "#startselling", "#digitalstorefront",
  ],
} as const;

/** Instagram gets the full set; the other networks get a tighter slice. */
const ig = (p: keyof typeof TAGS) => TAGS[p].join(" ");
const fb = (p: keyof typeof TAGS) => TAGS[p].slice(0, 5).join(" ");
const li = (p: keyof typeof TAGS) => TAGS[p].slice(0, 4).join(" ");
const x = (p: keyof typeof TAGS) => TAGS[p].slice(0, 2).join(" ");

export const POSTS: Post[] = [
  {
    id: "link-that-takes-orders",
    pillar: "ownership",
    template: "statement",
    art: {
      eyebrow: "Link in bio",
      headline: "The link in your bio should be <em>taking orders</em>.",
      footnote: "sailo.store",
    },
    alt: "Sailo — the link in your bio should be taking orders.",
    caption: {
      instagram: `Most link-in-bio pages send people somewhere else.

That's the whole problem. Someone watches your reel, taps your link, and lands on a list of buttons — each one asking them to make another decision. Every extra tap is a place to lose them.

A shop doesn't ask. It shows what you sell, with prices, and a button that opens a message with the item already in it.

Same link. Same bio. It just closes instead of forwarding.

Free for your first 20 products → sailo.store

${ig("ownership")}`,
      facebook: `Most link-in-bio pages send people somewhere else — a list of buttons, each asking the customer to make another decision.

A shop doesn't ask. It shows what you sell, with prices, and a button that opens a WhatsApp message with the item already in it.

Same link in your bio. It just closes instead of forwarding.

Free for your first 20 products.

${fb("ownership")}`,
      linkedin: `Every link-in-bio tool optimises for routing. Almost none of them optimise for the order.

That gap is strange when you look at who actually uses these pages. A large share are sellers — physical goods, food, services — using a routing tool to do a catalogue's job, then finishing the sale manually in DMs.

Sailo is the catalogue: products with prices, categories, search, and an order button that opens WhatsApp with the item filled in. No checkout to configure, no merchant-of-record liability, no country restrictions.

${li("ownership")}`,
      x: `Your link in bio forwards people.

A shop takes the order.

Same link. sailo.store ${x("ownership")}`,
    },
    link: "https://sailo.store",
  },
  {
    id: "reach-is-a-loan",
    pillar: "ownership",
    template: "statement",
    art: {
      eyebrow: "Ownership",
      headline: "Reach is a loan the platform can <em>call in</em>.",
      footnote: "A link you own is not",
    },
    alt: "Reach is a loan the platform can call in.",
    caption: {
      instagram: `In February one of your reels did 180,000 views. In March you posted eleven times, changed nothing, and the best one did 900.

You didn't get worse. Nobody sent you a message explaining it, and nobody will.

Three things a platform can take away in an afternoon:

→ Your reach. Most common, least dramatic. Nothing is wrong with your account, fewer people just see you.
→ Your account. Rarer, far worse. An appeal form and a wait.
→ A feature you built on. The quiet one. If your whole order flow runs through one clever integration, a product update is an outage.

What survives all three is a name people can type and a page that's still there when they type it.

The reason to have one isn't this month's orders. It's next March's.

${ig("ownership")}`,
      facebook: `In February a reel did 180,000 views. In March you posted eleven times, changed nothing, and the best one did 900.

You didn't get worse. Reach is a loan, and the platform can call it in without telling you.

What survives is a name people can type and a page that's still there when they type it.

${fb("ownership")}`,
      linkedin: `A pattern worth naming for anyone building a business on social distribution.

Three assets sit outside your control, and only one of them comes with a warning:

1. Reach — decided by a ranking system that changes without notice.
2. Account access — enforcement sweeps are automated, appeals are a form and a wait.
3. Platform features — the messaging API or link format your order flow depends on can be deprecated in a release.

The insurance is unglamorous: a domain people can type, a page that resolves, and a record of who has bought from you before. Everything else is rented.

${li("ownership")}`,
      x: `Reach is a loan the platform can call in.

Your link isn't. ${x("ownership")}`,
    },
    link: "https://sailo.store/en/blog/algorithms-change-your-link-does-not",
  },
  {
    id: "position-one",
    pillar: "catalogue",
    template: "playbook",
    art: {
      eyebrow: "Catalogue",
      number: "01",
      headline: "Position one earns more than positions six to twenty combined.",
      lines: [
        "This week’s post goes first",
        "Your bestseller goes second",
        "No categories under ~15 products",
      ],
    },
    alt: "Catalogue rule: position one earns more than positions six to twenty combined.",
    caption: {
      instagram: `"Everything I sell is on the page and people still message me asking if I have it."

They're not being difficult. They got to a grid of 34 items, all roughly the same size, in an order that made sense to you and to nobody else. They gave it about six seconds and decided it was easier to type a question.

The fix is ordering, not adding.

→ Put this week's post first. Whatever brought them here should be the first thing they see.
→ Bestseller second.
→ Don't create a single category until you have more than about 15 products and at least four things to go in each one.

Attention on a phone falls off a cliff, and it falls off faster than anyone building the page believes.

${ig("catalogue")}`,
      facebook: `"Everything I sell is on the page and people still message me asking if I have it."

They gave your grid about six seconds. The fix is ordering, not adding:

• This week's post first
• Bestseller second
• No categories until you're past ~15 products

${fb("catalogue")}`,
      linkedin: `A merchandising rule that transfers cleanly from retail shelves to a phone screen: position one earns more than positions six to twenty combined.

Most small sellers order their catalogue by when they added things. The customer reads it like a shelf — top-down, six seconds, then they leave or they ask a question you've already answered on the page.

Two changes, no new products required:
• Lead with whatever brought them there (this week's post).
• Bestseller second.

Hold off on categories until roughly 15 products with four-plus items each. Below that, categories add a tap and remove the thing you wanted seen.

${li("catalogue")}`,
      x: `Your catalogue is read like a shelf, not a database.

Position one earns more than six through twenty combined. ${x("catalogue")}`,
    },
    link: "https://sailo.store/en/blog/building-a-catalogue-people-can-scan",
  },
  {
    id: "no-card-payments",
    pillar: "objection",
    template: "contrast",
    art: {
      eyebrow: "Objection",
      headline: "You don’t need card payments to start selling.",
      leftLabel: "The usual advice",
      leftLines: ["Register a business", "Apply for a gateway", "Wait on approval", "Pass KYC", "Then sell"],
      rightLabel: "What actually works",
      rightLines: ["Post your catalogue", "Take the order on WhatsApp", "Get paid how you already do"],
    },
    alt: "You don't need card payments to start selling — take the order on WhatsApp.",
    caption: {
      instagram: `The advice is always: register the business, apply for a payment gateway, wait for approval, pass KYC, then start selling.

Meanwhile there are sellers in dozens of countries doing steady numbers on cash on delivery, bank transfer and mobile money — because that's what their customers already use and trust.

Card payments are a convenience, not a permission slip. If a gateway won't take you yet, or your country isn't supported, or the paperwork is six weeks out, none of that has to stop the order.

Put the catalogue up. Take the order in the chat. Get paid the way you already get paid.

You can add cards later, when the volume makes the paperwork worth it.

${ig("objection")}`,
      facebook: `Card payments are a convenience, not a permission slip.

Sellers in dozens of countries run steady businesses on cash on delivery, bank transfer and mobile money — because that's what their customers already use.

Put the catalogue up. Take the order in the chat. Add cards later, if the volume makes the paperwork worth it.

${fb("objection")}`,
      linkedin: `A quiet assumption in most commerce tooling: that accepting cards is step one.

For a large share of the world's small sellers it is closer to step five, and the four steps before it — business registration, gateway application, underwriting, KYC — are where the business stalls. Some never clear them. Some are in countries the major processors don't serve at all.

Ordering over chat sidesteps the whole sequence. No merchant-of-record liability, no onboarding, no country gate. The seller gets paid the way their customers already pay.

Cards remain worth adding. They just aren't worth waiting for.

${li("objection")}`,
      x: `Card payments are a convenience, not a permission slip.

Catalogue up. Order in the chat. Paid how you already get paid. ${x("objection")}`,
    },
    link: "https://sailo.store/en/blog/do-you-need-card-payments-to-sell-online",
  },
  {
    id: "five-shops",
    pillar: "proof",
    template: "phones",
    art: {
      eyebrow: "Live shops",
      headline: "One template. Every kind of seller.",
      shops: ["lumi", "forno", "serene"],
    },
    alt: "Three live Sailo shops: a nail bar, a pizzeria and a massage studio.",
    caption: {
      instagram: `A nail bar, a pizzeria and a massage studio — same template, three completely different businesses.

That's deliberate. Sailo is the neutral frame; your products are the colour. Your photos, your prices, your name in the URL. Nothing on the page is competing with what you sell.

Physical goods, digital downloads, or time-based services — all of it works the same way. Products with prices, categories once you need them, search, and an order button that opens a chat.

sailo.store/lumi · sailo.store/forno · sailo.store/serene

Go look at them. They're real pages, not mockups.

${ig("proof")}`,
      facebook: `A nail bar, a pizzeria and a massage studio — same template, three very different businesses.

Sailo is the neutral frame; your products are the colour.

Real live pages, not mockups: sailo.store/lumi · sailo.store/forno · sailo.store/serene

${fb("proof")}`,
      linkedin: `A design constraint we committed to early: one template, no themes.

Three live examples — a nail bar, a pizzeria, a massage studio — run the identical layout. The differentiation comes from the seller's photography, pricing and category structure, not from configuration.

The reasoning is that theme choice is a tax paid by every seller at setup, in exchange for a decision most of them don't want to make and can't evaluate. Removing it takes onboarding to roughly three minutes.

sailo.store/lumi · sailo.store/forno · sailo.store/serene

${li("proof")}`,
      x: `A nail bar, a pizzeria, a massage studio.

Same template. Sailo is the frame, your products are the colour.

sailo.store/lumi ${x("proof")}`,
    },
    link: "https://sailo.store",
  },
  {
    id: "three-minutes",
    pillar: "global",
    template: "stat",
    art: {
      eyebrow: "Setup",
      value: "3",
      unit: "minutes",
      headline: "From signing up to a link you can post.",
      footnote: "No checkout to configure. No KYC. Any country.",
    },
    alt: "Three minutes from signing up to a link you can post.",
    caption: {
      instagram: `Three minutes. That's signup to a link you can put in your bio.

There's no checkout to configure, because orders go to WhatsApp. No payment onboarding, because you get paid the way you already do. No shipping matrix, no tax settings, no theme to choose.

Upload what you sell. Set prices. Copy the link.

The reason this matters isn't the three minutes — it's that most sellers who try to set up a "proper" store never finish. They stall on the gateway application or the shipping rules and the shop stays half-built in a tab.

A page that exists beats a better page that doesn't.

${ig("global")}`,
      facebook: `Three minutes from signing up to a link you can post.

No checkout to configure, no payment onboarding, no shipping matrix, no theme to choose. Upload what you sell, set prices, copy the link.

Most half-built stores stall on the gateway application. A page that exists beats a better page that doesn't.

${fb("global")}`,
      linkedin: `Onboarding time is the most underrated metric in commerce tooling.

The full-platform products in this category — checkout, shipping, inventory, tax — ask a seller for a day of configuration before the first order is possible. A meaningful share never finish. The store sits half-built and the seller goes back to taking orders in DMs.

Sailo's setup is roughly three minutes because the hard parts are deliberately absent: ordering happens over WhatsApp, so there is no checkout to configure, no payment onboarding and no merchant-of-record liability.

Fewer capabilities, finished more often.

${li("global")}`,
      x: `3 minutes from signup to a link you can post.

No checkout to configure. No KYC. Any country. ${x("global")}`,
    },
    link: "https://sailo.store",
  },
  {
    id: "same-three-questions",
    pillar: "orders",
    template: "playbook",
    art: {
      eyebrow: "Orders",
      number: "02",
      headline: "You answer the same three questions every day. Put the answers on the page.",
      lines: ["How much is it?", "Do you have it in stock?", "Do you deliver to me?"],
    },
    alt: "Put the answers to your three most-asked questions on the page.",
    caption: {
      instagram: `Open your DMs and scroll back a week. Count how many messages are one of these three:

"How much is it?"
"Do you still have it?"
"Do you deliver to me?"

For most sellers it's the majority. Every one of those is a message you have to answer before the real conversation starts — and if you're asleep, it's a customer who found someone else by morning.

None of them need you. Prices on the page. Sold-out items marked. Delivery areas written once, in the description.

What's left in your inbox is the conversation that's actually worth your time: the person who's decided, and wants to buy.

${ig("orders")}`,
      facebook: `Scroll back a week in your DMs and count the messages that are just "how much?", "still available?" or "do you deliver to me?"

For most sellers that's the majority — and if you're asleep, it's a customer who found someone else by morning.

Prices on the page. Sold-out marked. Delivery areas written once.

What's left is the conversation worth having.

${fb("orders")}`,
      linkedin: `A useful audit for any business taking orders through chat: categorise a week of inbound messages.

Three questions usually dominate — price, availability, delivery area. None require the owner. All of them sit between the customer and the purchase, and they arrive at every hour, including the ones you're asleep for.

Moving those three answers onto the catalogue page does two things: it removes the latency that loses overnight buyers, and it changes what the inbox is for. The remaining messages are from people who have already decided.

${li("orders")}`,
      x: `"How much?" "Still available?" "Do you deliver here?"

Three questions. Most of your DMs. None of them need you. ${x("orders")}`,
    },
    link: "https://sailo.store/en/blog/answering-messages-when-you-are-asleep",
  },
  {
    id: "free-at-twenty",
    pillar: "objection",
    template: "stat",
    art: {
      eyebrow: "Pricing",
      value: "20",
      unit: "products",
      headline: "Free to start. Free to stay.",
      footnote: "No card required. No trial clock.",
    },
    alt: "Free for your first 20 products — no card required.",
    caption: {
      instagram: `Twenty products, free. Not a trial — there's no clock running and no card to enter.

Most sellers we talk to have somewhere between eight and thirty things they actually sell. So for a lot of people the free tier isn't a sample, it's the whole shop, indefinitely.

We'd rather you outgrow it than get billed before you've made a sale.

Put your catalogue up this week. If it never costs you anything, that's a fine outcome.

sailo.store

${ig("objection")}`,
      facebook: `Twenty products, free. Not a trial — no clock, no card required.

Most small sellers have between eight and thirty things they actually sell, so for a lot of people that's the whole shop, indefinitely.

We'd rather you outgrow it than get billed before you've made a sale.

${fb("objection")}`,
      linkedin: `On free tiers that are actually free.

Sailo's is 20 products with no time limit and no card at signup. That number wasn't chosen to force an upgrade — it was chosen because it covers the real catalogue size of most small sellers, which sits somewhere between eight and thirty items.

The bet is straightforward: sellers who are never billed still bring the sellers who will be. A trial that expires before the first sale converts nobody and costs you the referral.

${li("objection")}`,
      x: `20 products, free. No trial clock, no card.

For most small sellers that's the whole shop. ${x("objection")}`,
    },
    link: "https://sailo.store",
  },
  {
    id: "six-seconds",
    pillar: "catalogue",
    template: "stat",
    art: {
      eyebrow: "Attention",
      value: "6",
      unit: "seconds",
      headline: "That’s how long your grid gets before they’d rather just ask.",
      footnote: "Order it like a shelf, not a database",
    },
    alt: "Six seconds — how long a customer gives your product grid.",
    caption: {
      instagram: `Six seconds. That's roughly what a customer gives a grid of products before deciding it's easier to type a question than keep scrolling.

Which is why "I've put everything on the page" doesn't stop the DMs. Everything being there isn't the same as anything being findable.

Three things that buy you back those seconds:

→ One clear photo per product, same crop, same light. A grid that looks consistent reads faster than a grid of better individual photos.
→ Prices visible without a tap.
→ The thing you posted about today, first.

You're not designing a database. You're stocking a shelf, and people read shelves top-down and fast.

${ig("catalogue")}`,
      facebook: `Six seconds — roughly what a customer gives your product grid before deciding it's easier to just ask.

"I've put everything on the page" doesn't stop the DMs. Everything being there isn't the same as anything being findable.

One clear photo per product, same crop. Prices without a tap. Today's post first.

${fb("catalogue")}`,
      linkedin: `Consistency beats quality in a product grid, and it's not close.

A set of twelve photos shot the same way — same crop, same background, same light — scans faster than twelve individually better photos shot differently. The eye is comparing, and inconsistent framing makes comparison expensive.

This is the cheapest available conversion win for a small seller: no new products, no new equipment, one afternoon of reshooting against the same wall.

${li("catalogue")}`,
      x: `Six seconds. That's what your product grid gets before they'd rather just ask you.

Consistency beats quality in a grid. Same crop, same light. ${x("catalogue")}`,
    },
    link: "https://sailo.store/en/blog/how-to-photograph-what-you-sell",
  },
  {
    id: "works-everywhere",
    pillar: "global",
    template: "contrast",
    art: {
      eyebrow: "Global",
      headline: "Why WhatsApp ordering travels.",
      leftLabel: "Checkout platforms need",
      leftLines: ["A supported country", "A registered business", "Processor approval", "Seller KYC"],
      rightLabel: "Sailo needs",
      rightLines: ["A phone number", "Something to sell"],
    },
    alt: "Checkout platforms need a supported country and KYC. Sailo needs a phone number.",
    caption: {
      instagram: `Every checkout platform has a list of countries it serves. If you're not on it, the answer is no, and there's no appeal.

That list is why so much commerce software quietly doesn't work for most of the world. Not because the seller isn't ready — because a processor hasn't opened a market yet.

Ordering over WhatsApp has no list. The buyer taps the item, a message opens with the product already in it, and the two of you sort out payment and delivery the way you already do.

No merchant-of-record liability. No seller KYC. No country restrictions.

If you can receive a message, you can take an order.

${ig("global")}`,
      facebook: `Every checkout platform has a list of countries it serves. If you're not on it, there's no appeal.

Ordering over WhatsApp has no list. The buyer taps the item, a message opens with the product in it, and you sort out payment and delivery the way you already do.

If you can receive a message, you can take an order.

${fb("global")}`,
      linkedin: `The country list is the most consequential and least discussed constraint in commerce software.

Processor coverage — not seller readiness — decides who gets to use most of these tools. A capable seller in an unsupported market is simply told no, with no appeal path.

Routing orders through chat removes the dependency entirely. There is no merchant of record, no seller underwriting, no geographic gate. Payment and fulfilment are settled between two people who were already talking.

It's a smaller product. It works in materially more of the world.

${li("global")}`,
      x: `Every checkout platform has a country list. If you're not on it, no appeal.

WhatsApp ordering has no list. ${x("global")}`,
    },
    link: "https://sailo.store",
  },
  {
    id: "bestseller-seventh",
    pillar: "catalogue",
    template: "statement",
    art: {
      eyebrow: "Catalogue",
      headline: "Your bestseller is probably <em>seventh</em> on your page.",
      footnote: "Because you added it in March",
    },
    alt: "Your bestseller is probably seventh on your page.",
    caption: {
      instagram: `Go and look. Most sellers' catalogues are ordered by upload date, which means the ordering is a record of your admin, not a recommendation.

Your bestseller went up in March, so it sits seventh. The thing nobody buys went up last week, so it's first.

This is the easiest sale you'll make all month, and it costs nothing:

→ Open your page on your phone, as a customer would
→ Screenshot the first screen without scrolling
→ Ask whether those items are the ones you'd hand someone walking in

If not, reorder. That's the whole job.

${ig("catalogue")}`,
      facebook: `Most catalogues are ordered by upload date — a record of your admin, not a recommendation.

Your bestseller went up in March, so it's seventh. The thing nobody buys went up last week, so it's first.

Open your page on your phone. Screenshot the first screen. Are those the items you'd hand someone walking in?

${fb("catalogue")}`,
      linkedin: `Default sort order is a silent business decision, and almost nobody revisits it.

Catalogues ordered by upload date encode the seller's admin history rather than any commercial priority. The predictable result: the bestseller sits below the fold while a slow mover leads, purely because of when each was added.

The diagnostic takes a minute — open the page on a phone, screenshot the first viewport, ask whether those are the items you would put in a customer's hands first. The fix is free.

${li("catalogue")}`,
      x: `Your catalogue is sorted by upload date.

Which means your bestseller is seventh and your worst seller is first. ${x("catalogue")}`,
    },
    link: "https://sailo.store/en/blog/building-a-catalogue-people-can-scan",
  },
  {
    id: "sell-anything",
    pillar: "proof",
    template: "playbook",
    art: {
      eyebrow: "What you can sell",
      number: "03",
      headline: "Physical, digital or your time. Same page.",
      lines: ["Goods — ship it or hand it over", "Downloads — delivered on payment", "Services — book the slot"],
    },
    alt: "Sell physical goods, digital downloads or services from the same page.",
    caption: {
      instagram: `Most link-in-bio shops are built for one kind of seller — usually the course-and-ebook crowd. If you sell physical things, you get a tool that has no idea what stock is.

Sailo takes all three:

→ Physical goods. Photos, prices, categories, search. Ship it or hand it over.
→ Digital downloads. Delivered automatically once payment lands, no manual sending.
→ Services. A slot, a duration, a price — for the nail techs, therapists and photographers.

Plenty of sellers do two of these at once. The florist who also runs workshops. The baker selling cakes and a recipe PDF. Same page, no second tool.

${ig("proof")}`,
      facebook: `Most link-in-bio shops are built for courses and ebooks. If you sell physical things, you get a tool that has no idea what stock is.

Sailo takes all three — goods, downloads, and services — on the same page.

The florist who also runs workshops. The baker selling cakes and a recipe PDF. No second tool.

${fb("proof")}`,
      linkedin: `A gap in the link-in-bio category worth naming: nearly all of it is built for digital products.

Courses, coaching, ebooks — well served. Physical sellers get tools with no concept of stock, and service providers get no concept of a bookable slot. The ones that do serve physical sellers went the other way entirely, into full store platforms with checkout, shipping and tax configuration.

Sailo covers all three product types on one page: goods, downloads delivered on payment, and time-based services. Mixed catalogues are common — the florist who runs workshops, the baker with a recipe PDF — and they shouldn't require two products.

${li("proof")}`,
      x: `Physical goods, digital downloads, or your time.

Same page. Most link-in-bio tools only do the middle one. ${x("proof")}`,
    },
    link: "https://sailo.store",
  },
  {
    id: "asleep",
    pillar: "orders",
    template: "statement",
    art: {
      eyebrow: "Orders",
      headline: "Your shop should still be <em>selling</em> at 2am.",
      footnote: "Even when you're not answering",
    },
    alt: "Your shop should still be selling at 2am.",
    caption: {
      instagram: `The order doesn't arrive when you're free. It arrives at 11pm, or during the school run, or while you're already serving someone.

If the answer to "how much is this?" lives only in your head, every one of those is a delay — and some of them are a lost sale to whoever replied first.

A page with prices on it works the hours you don't. The customer decides at 2am, sends the message with the item already in it, and you wake up to an order instead of a question.

You're not trying to be always-on. You're trying to make being offline cost nothing.

${ig("orders")}`,
      facebook: `Orders don't arrive when you're free. They arrive at 11pm, or during the school run.

If "how much is this?" only lives in your head, every one of those is a delay — and some are a lost sale to whoever answered first.

A page with prices works the hours you don't.

${fb("orders")}`,
      linkedin: `Response latency is a conversion variable that most small sellers can't fix by working harder.

Enquiries arrive continuously; the owner is available intermittently. The gap between those two facts is where sales go, and the usual advice — reply faster — asks a one-person business to be a support team.

The structural fix is to move the answers that cause the delay onto the page. Price, availability and delivery area published means the customer completes their decision unassisted and arrives already committed.

Not always-on. Just offline at no cost.

${li("orders")}`,
      x: `Orders arrive at 11pm, not when you're free.

A page with prices on it works the hours you don't. ${x("orders")}`,
    },
    link: "https://sailo.store/en/blog/answering-messages-when-you-are-asleep",
  },
  {
    id: "empty-middle",
    pillar: "ownership",
    template: "contrast",
    art: {
      eyebrow: "Category",
      headline: "Neither of these fits a<br>small physical seller.",
      leftLabel: "Link-in-bio tools",
      leftLines: ["Built for courses", "No real catalogue", "No categories or search"],
      rightLabel: "Store platforms",
      rightLines: ["Checkout to configure", "Shipping and tax", "A day of setup"],
      // Both columns are the problem here, so the right one must not wear the
      // green "recommended" bullets the template gives it by default.
      rightTone: "muted",
      footnote: "Sailo sits in the empty middle",
    },
    alt: "Link-in-bio tools are built for courses; store platforms need a day of setup. Sailo sits between.",
    caption: {
      instagram: `There are two kinds of tool for selling online and neither fits a small physical seller.

On one side: link-in-bio pages built for digital products. Courses, coaching, ebooks. No real catalogue — no categories, no filters, no search, no reviews. Fine if you sell one thing.

On the other: full store platforms. Checkout, shipping, inventory, tax. Powerful, and a full day of configuration before your first order is even possible.

The empty middle is a catalogue page as simple as a link-in-bio, that actually knows what a product is.

That's the whole idea. One template, no checkout to configure, works in every country.

${ig("ownership")}`,
      facebook: `Two kinds of tool for selling online, and neither fits a small physical seller.

Link-in-bio pages: built for courses, no real catalogue.
Store platforms: checkout, shipping, tax, a full day of setup.

The empty middle is a catalogue page as simple as a link-in-bio that actually knows what a product is.

${fb("ownership")}`,
      linkedin: `Positioning note, for anyone who thinks about category gaps.

Every incumbent in link-in-bio commerce optimises for digital products — courses, coaching, ebooks. None ship a real product catalogue: no categories, no filters, no search, no reviews.

Everyone who does serve physical sellers went heavy: Big Cartel, Dukaan, Shopier, Salla, Zid — full store platforms with checkout, shipping, inventory and tax.

The middle is empty. A catalogue page as simple as Linktree, with ordering over WhatsApp so it works in every country without processor coverage or seller KYC.

Small categories with no occupant are usually small for a reason. Occasionally they're just unbuilt.

${li("ownership")}`,
      x: `Link-in-bio tools: built for courses, no real catalogue.
Store platforms: a day of setup before your first order.

The middle is empty. ${x("ownership")}`,
    },
    link: "https://sailo.store",
  },
];

/**
 * Deterministic pick, so two runs on the same day produce the same post and a
 * retry after a failure never double-posts something different.
 */
export function postForDate(date: Date): Post {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  const day = Math.floor((date.getTime() - start) / 86_400_000);
  const post = POSTS[((day % POSTS.length) + POSTS.length) % POSTS.length];
  if (!post) throw new Error("POSTS is empty — nothing to publish");
  return post;
}
