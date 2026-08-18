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
    blog: "Blog",
    signIn: "Sign in",
    createShop: "Create your shop",
    openMenu: "Open menu",
    closeMenu: "Close menu",
    skip: "Skip to content",
  },

  hero: {
    /* The category we are claiming, said plainly, above the argument for it. */
    badge: "The one-link shop",
    /** `{highlight}` is emphasised in place, so it can land anywhere a language needs it. */
    /*
     * The headline borrows the reader's existing category and spends its whole
     * length on the delta.
     *
     * "Stop retyping orders from your DMs" led with the seller's admin, which
     * sells relief rather than sales, has no search demand behind it, and
     * sizes us like the order-form tools — OrderPage, Store.link, Quickzu,
     * onwhats.app — when we carry variants, stock, bookings, files and card.
     *
     * Claiming "one link" on its own is no better: it is Linktree's, Beacons'
     * and Stan's sentence too. So the phrase is demoted to `badge`, where a
     * category label belongs, and the headline names the one thing none of
     * them can do. `seo.ogTitle` repeats it word for word, and `seo.title`
     * shares its vocabulary — which is what stops Google rewriting a title.
     */
    title: "Your link in bio, but it {highlight}.",
    titleHighlight: "takes the orders",
    body: "One link in your bio, and everything you sell sits behind it — photos, prices, options, stock. Buyers browse and buy without being sent anywhere else, and every order arrives already written out, in the chat you're answering anyway. No website to build, and no commission except on card.",
    ctaPrimary: "Create your shop — free",
    ctaSecondary: "Open a live shop",
    proof1: "Live in under a minute",
    proof2: "No card required",
    // Was "chat and bank orders", which stopped being the whole list the day
    // Venmo, PayPal and cash on delivery shipped. Card is the only rail we
    // take anything on.
    proof3: "No commission except on card",
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
    body: "Card checkout through your own Stripe account, or the rails people actually use where you are — with your instructions, in your words.",
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
    /*
     * Named by exclusion, not by listing the rails.
     *
     * This said "chat, bank-transfer and cash", which was the whole list on the
     * day it was written and stopped being it the moment Venmo and PayPal
     * shipped — leaving two free rails looking like they carried a fee. Card is
     * the only thing we take anything on, so that is the sentence: it stays
     * true the next time a rail is added, which listing them never does.
     */
    body: "Every way of getting paid except card is yours in full, on every plan. Card sales carry {fee} of the goods — never delivery, never tax.",
    freeTagline: "Everything you need to take your first orders.",
    proTagline: "Room to grow, and a shop that looks like your own.",
    bizTagline: "The lowest card fee, promotions and referrals — the tools that grow revenue.",
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
    a2: "However you already take money. Card, through your own Stripe account, so the charge lands with you directly. Or bank transfer, cash on delivery and mobile money, with instructions you write yourself. Sailo never holds the money.",
    q3: "Does Sailo take a commission?",
    a3: "Only on card. WhatsApp, Venmo, PayPal, bank transfer and cash are yours in full, on every plan. Card sales carry {fee} of the goods, taken as a Stripe fee at checkout — never on delivery or tax.",
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
    s2: "commission on chat and bank-transfer orders",
    s3: "from signing up to a link you can share",
  },

  cta: {
    title: "You're already selling in the DMs.",
    body: "Sailo just gives it a front door — so people can browse, compare and see prices before they message you.",
    button: "Get your link",
    note: "Free while in beta · No card required",
  },

  blog: {
    title: "Notes on selling",
    intro:
      "How to sell from a link in your bio: photographs, pricing, delivery and the small decisions that turn a follower into an order.",
    empty: "Nothing published yet. Soon.",
    minuteRead: "min read",
    backToBlog: "All articles",
    pagination: "Pagination",
    previousPage: "Previous page",
    nextPage: "Next page",
  },

  footer: {
    tagline: "One link, your whole shop.",
    product: "Product",
    /*
     * Names the audience rather than the page, because that is what somebody
     * scanning a footer is looking for — "Developers" is where a person who
     * wants the REST API, the webhooks or the MCP server expects to find them,
     * and "Docs" alone reads as help articles for sellers.
     */
    docs: "Developers",
    liveShops: "Live shops",
    rights: "All rights reserved.",
    legal: "Legal",
    privacy: "Privacy",
    terms: "Terms",
    refunds: "Refunds",
    gdpr: "GDPR",
    antiSpam: "Anti-spam",
  },

  /*
   * `title` used to aim at "take orders online without a website". The phrase
   * describes the job correctly, but its results page is listicles — Jotform,
   * PaymentForm, ChowNow, Chowly — because the intent behind it is someone
   * reading up, not someone choosing. A homepage does not outrank a listicle
   * on a listicle query; a blog post does. That query is now the blog's job.
   *
   * What the homepage can win is the commercial-intent search next to it:
   * someone shopping for a link-in-bio tool who has actually outgrown one.
   * The earlier worry about that phrase was that it files us under creator
   * tools — true if it were the page's only topical signal, but the copy
   * around it is stock, variants, checkout and rails, and this is the highest
   * intent traffic on offer. It is also the deal we win: FAQ q5 is already
   * "I have a Linktree, why swap?".
   *
   * `title` is keyword-first rather than brand-first on purpose: brand-first
   * wins when people already search your name, and nobody searches ours yet.
   */
  seo: {
    title: "Link in bio shop — sell without a website | Sailo",
    description:
      "One link, and a real shop behind it: photos, prices, options, stock and checkout. Orders arrive already written out. Free, with no commission except on card.",
    /* Social, not search — so it repeats the headline rather than a keyword. */
    ogTitle: "Your link in bio, but it takes the orders",
    ogDescription:
      "A real shop behind one link — photos, prices, stock and checkout. Orders arrive already written out, and no marketplace takes a cut of the customers you found yourself.",
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
