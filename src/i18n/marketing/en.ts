/**
 * The landing page's dictionary — the source every other locale is typed
 * against.
 *
 * Kept out of the storefront dictionary on purpose. That one is handed to
 * client components on every shop page, so it crosses the wire tens of
 * thousands of times a day; this is read once, on one server-rendered route,
 * by a visitor who has never seen Sailo before.
 *
 * Unlike the admin's dictionary, a locale here must be complete. A half-
 * translated back office shows a seller an English word they can live with;
 * a half-translated landing page is the first thing a stranger reads, so the
 * type below makes a gap a build error rather than a bad first impression.
 *
 * `{placeholders}` are substituted at render time.
 */
export const marketingEn = {
  nav: {
    how: "How it works",
    demos: "Live shops",
    features: "Features",
    pricing: "Pricing",
    faq: "Questions",
    signIn: "Sign in",
    createShop: "Create your shop",
    openMenu: "Open menu",
    closeMenu: "Close menu",
    skip: "Skip to content",
  },

  hero: {
    badge: "Free while in beta",
    /** `{highlight}` is emphasised in place, so it can land anywhere a language needs it. */
    title: "The link in your bio should be {highlight}.",
    titleHighlight: "taking orders",
    body: "Sailo turns it into a real shop — photos, prices, search, checkout — and sends every order to the chat app you're already answering.",
    ctaPrimary: "Create your shop — free",
    ctaSecondary: "Open a live shop",
    proof1: "Live in under a minute",
    proof2: "No card required",
    proof3: "No commission on sales",
    proof4: "35 languages",
    igBio: "Wood-fired pizza, Naples. Order below.",
    igPosts: "Posts",
    igFollowers: "Followers",
    igFollowing: "Following",
    igFollow: "Follow",
    igMessage: "Message",
    tapCaption: "One tap, and they're in the shop.",
  },

  rails: {
    title: "Get paid the way your buyers already pay you",
    body: "Card checkout through your own Stripe or Paystack account, or the rails people actually use where you are — with your instructions, in your words.",
  },

  compare: {
    eyebrow: "Why not just a link list",
    title: "A list of links sends people away. A shop sells.",
    body: "Both live at one short URL. Only one of them knows what you sell, what it costs and whether it's still in stock.",
    linkTitle: "A link-in-bio page",
    link1: "Sends people somewhere else to buy",
    link2: "No prices, no photos, no stock",
    link3: "Every order retyped by hand in a DM",
    link4: "You find out what sold from your bank app",
    shopTitle: "A Sailo shop",
    shop1: "People buy without leaving the page",
    shop2: "Photos, prices, variants and stock counts",
    shop3: "The order arrives already written out",
    shop4: "Visits, orders and repeat buyers, counted",
  },

  versus: {
    title: "One link. One shop. No compromise.",
    body: "A link page cannot take an order. A full store is a second job. Sailo is the middle everyone kept asking for.",
    us: "Sailo",
    r1: "One short link for your bio",
    r2: "Products with photos, prices and stock",
    r3: "Orders land in WhatsApp, no checkout to set up",
    r4: "Bookings and instant digital downloads",
    r5: "A free plan you can actually sell on",
    r6: "35 languages, right to left included",
    note: "How each tool positions itself, August 2026. Check current plans before you switch.",
  },

  steps: {
    eyebrow: "How it works",
    title: "Three things, and you're selling.",
    body: "There is no store to design, no theme to pick and no checkout to configure. The whole setup fits on a phone screen.",
    s1t: "Add what you sell",
    s1b: "A photo, a price, a line of description. Physical things, digital files or hours of your time — it's the same short form for all three.",
    s2t: "Put the link in your bio",
    s2b: "sailo.store/yourname goes in Instagram, TikTok, a WhatsApp status or a printed menu. Everything you sell sits behind it.",
    s3t: "Answer the order",
    s3b: "Buyers pay by card, or land in your WhatsApp with the order already written out — item, options, address, total. You never retype it.",
  },

  demos: {
    eyebrow: "Live shops",
    title: "Five real shops, running on this.",
    body: "Not mockups. Every one is a live Sailo shop you can open, filter and add to a basket — and the screenshots below were taken from those pages, not drawn to look like them.",
    proves: "What it shows",
    open: "Open {shop}",
    desktop: "On a laptop",
    phone: "On a phone",
    d1kicker: "Handmade goods",
    d1line: "Sizes with their own prices, stock counted per option, and a workshop you can book a seat at.",
    d2kicker: "Food, ordered on WhatsApp",
    d2line: "Two choices at once — size and crust — with stock counted for every combination and one of them sold out.",
    d3kicker: "Appointments",
    d3line: "A list layout, a date picker on every service, per-technician pricing and a small retail shelf.",
    d4kicker: "Services, in the dark",
    d4line: "Long bookings, a free consultation call, a dark palette and nothing at all to post.",
    d5kicker: "Digital downloads",
    d5line: "Files that unlock the moment payment is confirmed, licence options, and a free sample chapter.",
  },

  features: {
    eyebrow: "What you get",
    title: "A real shop, not a list of links.",
    body: "All of it is on by default. There is no plugin directory and nothing to install.",
    f1t: "Search and filters, built in",
    f1b: "Categories, price range, type and sort. A hundred products stay as browsable as five.",
    f2t: "Every way of getting paid",
    f2b: "Card through your own gateway, or bank transfer, cash on delivery and mobile money with instructions you write yourself.",
    f3t: "Variants and stock that add up",
    f3b: "Size, colour, grind, length — priced separately and counted separately, so you only sell out of what's actually gone.",
    f4t: "Bookings and downloads",
    f4b: "Sell an appointment with a date picker and a notice period, or a file that unlocks the moment you confirm payment.",
    f5t: "Reviews, coupons and referrals",
    f5b: "Buyers rate what they bought and you decide what goes live. Run a discount code, or let other people sell for you on commission.",
    f6t: "Numbers worth reading",
    f6b: "Visits, orders, repeat buyers and where the traffic came from — with invoices and CSV exports when you need the paperwork.",
  },

  languages: {
    eyebrow: "Anywhere you sell",
    title: "Thirty-five languages, right to left included.",
    body: "Your shop reads properly in Arabic, Japanese, Turkish or Polish — and so does the admin behind it. Visitors get their own language automatically; pin one instead if your buyers are all in the same place.",
    rtl: "The same shop, in Arabic",
    rtlNote: "Not a mirrored screenshot — the page lays itself out right to left, down to the search field and the filter rail.",
  },

  pricing: {
    eyebrow: "Pricing",
    title: "Free to start, and free to keep running.",
    body: "Sailo never takes a cut of your sales — not on the paid plans, and not on the free one.",
    freeTagline: "Everything you need to take your first orders.",
    proTagline: "Room to grow, and a shop that looks like your own.",
    bizTagline: "Card payments, promotions and referrals — the tools that grow revenue.",
    start: "Start free",
    choose: "Choose {plan}",
    everythingFree: "Everything in Free, plus",
    everythingPro: "Everything in Pro, plus",
  },

  faq: {
    eyebrow: "Questions",
    title: "The things people ask first.",
    q1: "Do I need a website?",
    a1: "No — Sailo is the website. You get sailo.store/yourname the moment you sign up, and it works on any phone without you touching a theme.",
    q2: "How do buyers actually pay me?",
    a2: "However you already take money. Card, through your own Stripe or Paystack account, so the charge lands with you directly. Or bank transfer, cash on delivery and mobile money, with instructions you write yourself. Sailo never holds the money.",
    q3: "Does Sailo take a commission?",
    a3: "No. Not on the free plan, not on the paid ones. What the buyer pays is what you keep, minus whatever your own payment provider charges.",
    q4: "Can I sell services or digital files?",
    a4: "Yes, and they behave properly. A service can carry a duration, a location and a date picker with a notice period. A digital product ships files that unlock as soon as you confirm payment, with download limits and expiry if you want them.",
    q5: "I already have a Linktree. Why swap?",
    a5: "Because a link list can't take an order. Sailo does the link part too — your socials sit at the top of the page — but underneath it there are prices, stock and a basket, so people buy instead of being sent somewhere else.",
    q6: "What language will my shop be in?",
    a6: "Whichever of thirty-five your visitor's browser asks for, or one you pin if your buyers are all in one place. Arabic and other right-to-left languages lay out properly rather than being mirrored.",
  },

  proof: {
    title: "Real shops, real links, live right now.",
  },

  stats: {
    s1: "languages, right to left included",
    s2: "commission — on every plan, including the free one",
    s3: "from signing up to a link you can share",
  },

  cta: {
    title: "You're already selling in the DMs.",
    body: "Sailo just gives it a front door — so people can browse, compare and see prices before they message you.",
    button: "Get your link",
    note: "Free while in beta · No card required",
  },

  footer: {
    tagline: "One link, your whole shop.",
    product: "Product",
    liveShops: "Live shops",
    rights: "All rights reserved.",
    legal: "Legal",
    privacy: "Privacy",
    terms: "Terms",
    refunds: "Refunds",
  },

  seo: {
    title: "Sailo — turn the link in your bio into a shop",
    description:
      "Sailo turns the link in your bio into a real shop. Sell products, digital files or services, take orders on WhatsApp or by card, in 35 languages. Free to start, and Sailo takes no commission.",
    ogTitle: "Sailo — one link, your whole shop",
    ogDescription:
      "Photos, prices, variants, stock, bookings and downloads behind a single link in bio. Orders land in WhatsApp or on your own card checkout.",
  },
} as const;

/**
 * Same key structure as the English source, every leaf widened to `string`.
 * Without this, `as const` would pin each value to its English literal and no
 * translation would typecheck.
 */
type Translated<T> = {
  [K in keyof T]: T[K] extends string ? string : Translated<T[K]>;
};

export type MarketingDictionary = Translated<typeof marketingEn>;
