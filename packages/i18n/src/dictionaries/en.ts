/**
 * The source dictionary. Every other locale is typed against this shape, so a
 * missing or misspelled key is a compile error rather than a blank on screen.
 *
 * `{placeholders}` are substituted at render time.
 */
export const en = {
  /**
   * The error boundaries. Client components, so they cannot await a
   * dictionary — the root layout hands them these five strings instead.
   */
  errors: {
    title: "Something went wrong",
    body: "This page didn't load. It is usually temporary, so trying again is worth a go.",
    retry: "Try again",
    home: "Go to the homepage",
    reference: "Reference",
  },

  common: {
    save: "Save",
    cancel: "Cancel",
    close: "Close",
    delete: "Delete",
    edit: "Edit",
    done: "Done",
    back: "Back",
    loading: "Loading…",
    optional: "optional",
    free: "Free",
    search: "Search",
    language: "Language",
  },

  consent: {
    manage: "Cookie settings",
    customise: "Choose",
    save: "Save choices",
    essential: "Essential",
    essentialBody: "Always on — sign-in and your language.",
    analytics: "Analytics",
    analyticsBody: "Google Analytics on our own pages.",
    title: "Cookies on our own pages",
    body: "We measure Sailo's own pages with Google Analytics — never a seller's shop. Decline and nothing is stored.",
    accept: "Accept",
    decline: "Decline",
    privacy: "Privacy Policy",
    // A seller's storefront. The tools are the seller's, the seller is the
    // controller, and the copy has to say so — reusing the Sailo strings
    // above would make the banner claim the wrong party is measuring.
    shopTitle: "Cookies on this shop",
    shopBody: "{shop} uses marketing tools that store cookies on your device to measure visits and ads. None of them load unless you accept.",
    shopEssentialBody: "Always on — your language and this choice.",
    marketing: "Marketing & analytics",
    marketingBody: "Tools chosen by {shop}. Loaded only if you accept.",
  },

  shop: {
    searchPlaceholder: "Search products…",
    clearSearch: "Clear search",
    filters: "Filters",
    all: "All",
    type: "Type",
    sortBy: "Sort by",
    priceRange: "Price range ({currency})",
    min: "Min",
    max: "Max",
    inStockOnly: "In stock only",
    resetFilters: "Reset all filters",
    itemCount: "{count} items",
    itemCountOne: "{count} item",
    noProducts: "No products yet",
    noProductsBody: "{shop} hasn't added anything yet. Check back soon.",
    noMatches: "Nothing matches that",
    noMatchesBody: "Try clearing a filter or searching for something else.",
    soldOut: "Sold out",
    salesClosed: "Sales closed",
    sale: "Sale",
    order: "Order",
    orderNow: "Order now",
    unavailable: "Unavailable",
    joinOnSailo: "Join {shop} on Sailo", loadMore: "Load more",
    earnBySharing: "Earn {percent}% by sharing this shop",
    /*
     * The currency switcher's accessible name — spec 53.
     *
     * One key, because the control's faces are currency symbols and its
     * options' names come from `Intl.DisplayNames`, which already ships every
     * currency translated into all thirty-five languages. A dictionary entry
     * per currency would be nine more keys to translate for something the
     * platform already knows.
     */
    currencyLabel: "Currency",
    // A badge answers "what happens after I pay?", not "what category is
    // this?". `kind*` is the product page; `label*` is the smaller card badge,
    // where physical is the unmarked default.
    kindPhysical: "Ships to you",
    kindDigital: "Instant download",
    kindService: "Book a time",
    kindEvent: "Event ticket",
    // The badge answers "what happens after I pay?" — and for a membership
    // the answer people most need before paying is that it happens again.
    kindMembershipMonth: "Renews monthly",
    kindMembershipYear: "Renews yearly",
    perMonth: "per month",
    perYear: "per year",
    subscribeNow: "Subscribe",
    labelDigital: "Download",
    labelService: "Booking",
    from: "From {price}",
    // The heart on a card and the sheet it fills. "Saved", not "wishlist" —
    // the buyer is keeping a thing in mind, not writing to Santa.
    favorites: "Favourites",
    favoritesEmpty: "Nothing saved yet",
    favoritesEmptyBody: "Tap the heart on a product and it'll wait for you here.",
    saveToFavorites: "Save to favourites",
  },

  sort: {
    featured: "Featured",
    newest: "Newest",
    priceAsc: "Price: low to high",
    priceDesc: "Price: high to low",
    rating: "Top rated",
    // How the buyer receives it, in their words. "Physical" is warehouse
    // language — a shopper is deciding between something arriving, something
    // downloading now, and something they have to book.
    allTypes: "Everything",
    physical: "Products",
    digital: "Downloads",
    services: "Bookings",
    events: "Events",
  },

  product: {
    reviews: "Reviews",
    noReviews: "No reviews yet — be the first.",
    noReviewsShort: "No reviews yet",
    writeReview: "Write a review",
    yourRating: "Your rating",
    yourName: "Your name",
    howWasIt: "How was it?",
    postReview: "Post review",
    reviewThanks: "Thanks! Your review is awaiting approval.",
    star: "{count} star",
    stars: "{count} stars",
  },

  /**
   * What a price *is*, when it is not simply a number — spec 43.
   *
   * Its own section rather than more keys inside `checkout`, and the reason is
   * mechanical rather than editorial: `checkout` is one of the protected money
   * sections, which `i18n:fill` refuses to write into at all — so a new key
   * there is a hole in thirty-four locales that no filler may ever close, and a
   * storefront hole is a compile error. These strings are money-adjacent and
   * should join the protected list once a human has read them in every
   * language; until then they are fillable, which is the difference between a
   * feature that ships translated and one that does not ship.
   */
  pricing: {
    payWhatYouWant: "Pay what you want",
    nameYourPrice: "Name your price",
    atLeast: "At least {amount}",
    /* A floor of zero is the seller saying this may be free, which is the whole
       of a donation. "At least £0.00" would read as a bug on the one product
       where free is the point. */
    payAnything: "Pay whatever you like, including nothing",
    notYetOnSale: "Not on sale yet",
    noLongerAvailable: "No longer available",
    opensOn: "Opens {date}",
    closesOn: "Sales close {date}",
  },

  /**
   * Wanting something there is none of — spec 33.
   *
   * Its own section rather than keys inside `checkout` or `cart`, for the
   * mechanical reason `pricing` above gives: both of those are protected money
   * sections that `i18n:fill` refuses to write into, so a new key there is a
   * hole in thirty-four locales that nothing can close — and a storefront hole
   * is a compile error.
   *
   * Every string here is written to be true whether or not a row was written.
   * "You'll hear from us" is the answer in all cases, because a reply that
   * varied would say which of a seller's variants exist and who is watching
   * them.
   */
  stock: {
    tellMe: "Tell me when it's back",
    emailPlaceholder: "you@example.com",
    contactPlaceholder: "Email or phone",
    notifyMe: "Notify me",
    queued: "You'll hear from us when it's back. We haven't held one for you — anyone can buy it.",
    onceOnly: "One message, when it returns. Nothing else. {shop}",
    /* Nothing was written, and this says only that. Never anything about
       stock — a buyer told "you'll hear from us" when nothing was recorded is
       a buyer who waits for ever. */
    tryAgain: "Couldn't do that just now. Try again shortly.",
    /* A preorder's date is shown *before* the buyer commits. Null is not a
       blank: "no date given" is an honest answer and a blank reads as one that
       failed to load. */
    preorder: "Preorder",
    expected: "Expected {date}",
    noDate: "No date yet — the seller will confirm",
    refundNote: "If it never ships, {shop}'s refund policy applies.",
  },

  /**
   * A companion product, offered after the receipt — spec 36.
   *
   * Its own section rather than keys in `checkout` or `cart`, for the same
   * mechanical reason `pricing` and `stock` above give: both are protected money
   * sections a filler may not write into, and a storefront hole is a compile
   * error nothing can close.
   */
  offers: {
    alsoLike: "You might also like",
    addIt: "Add it",
    noThanks: "No thanks",
  },

  checkout: {
    failedSafe: "Something went wrong. You haven't been charged — please try again.",
    failedUnsure: "Something went wrong. Your order may have gone through — check your email before trying again.",
    taxIncluded: "Includes {amount} {name} ({percent}%)",
    taxAtCheckout: "Calculated at checkout",
    quantity: "Quantity",
    increase: "Increase quantity",
    decrease: "Decrease quantity",
    howReceive: "How would you like to receive it?",
    howOrder: "How would you like to order?",
    yourName: "Your name",
    email: "Email",
    phone: "Phone",
    emailOptional: "Email (optional)",
    phoneOptional: "Phone (optional)",
    contactHint: "Give at least one so {shop} can reach you about this order.",
    deliveryAddress: "Delivery address",
    street: "Street address",
    apartment: "Apartment, suite (optional)",
    city: "City",
    region: "State / region",
    postalCode: "Postal code",
    country: "Country",
    shipTo: "Where are we sending it?",
    noShippingTo: "{shop} doesn't ship to {country} yet.",
    chooseCountryFirst: "Choose a country to see delivery options.",
    notes: "Size, colour, delivery notes…",
    discountCode: "Discount code",
    apply: "Apply",
    saveFailed: "Couldn't save that.",
    remove: "Remove",
    applied: "applied",
    subtotal: "Subtotal",
    discount: "Discount",
    total: "Total",
    each: "{price} each",
    freeOver: "Free over {amount}",
    contactHandoffNote:
      "Your order details are sent along so you don't have to type them.",
    manualNote: "The seller gets your order and confirms payment.",
    orderSent: "Order sent to {shop}",
    paidBy: "Paid by {method}.",
    payWith: "Pay with {method}",
    pasteNote: "{method} can't fill in a message, so copy your order and paste it into the chat.",
    yourOrder: "Your order",
    openApp: "Open {method}",
    bankInstructions:
      "Transfer the total using the details below, then add your reference.",
    bankDetails: "Bank details",
    copy: "Copy",
    copied: "Copied",
    transferReference: "Transfer reference",
    sentPayment: "I've sent the payment",
    confirmSoon: "Thanks — {shop} will confirm your payment shortly.",
    invoice: "Invoice {number}",
    view: "View",
    questions: "Questions? {email}",
    earnReferral: "Earn {percent}% on referrals",
    earnReferralBody:
      "Share your link. When someone buys from {shop} through it, you earn {percent}% of their order.",
    choose: "Choose {option}",
    onlyLeft: "Only {count} left",
    preferredTime: "Preferred date and time",
    bookingHint: "{shop} confirms your slot after you order.",
    slotsLoading: "Finding available times…",
    slotsNoneToday: "Nothing left on this day.",
    slotsNoneAtAll: "No times available at the moment. Message the shop and they'll find you one.",
    slotsFailed: "Couldn't load available times. Try again in a moment.",
    duration: "Takes {duration}",
    online: "Online",
    inPerson: "In person",
    /* "What you bought" rather than "your download": the same line now covers
       a link and an access code, and neither of those is a download. */
    downloadAfterPayment:
      "What you bought unlocks as soon as {shop} confirms your payment.",
    getFiles: "Get your files",
    termsAgree: "I agree to the terms and conditions",
    termsView: "Read them",
    marketingOptIn: "Email me news and offers",
  },

  cart: {
    title: "Your basket",
    add: "Add to basket",
    added: "Added",
    buyNow: "Buy now",
    view: "Basket",
    itemCount: "{count} in your basket",
    empty: "Your basket is empty",
    emptyBody: "Add something and it'll show up here.",
    keepShopping: "Keep shopping",
    remove: "Remove",
    someGone:
      "Something in your basket has sold out and has been left out of the total.",
  },

  /**
   * The share sheet on a storefront and on each product. Channel names
   * (WhatsApp, Telegram, X, Facebook) are brand names and stay untranslated
   * in the component; these are the words around them.
   */
  share: {
    shopTitle: "Share this shop",
    productTitle: "Share this product",
    copyLink: "Copy link",
    copied: "Copied",
    email: "Email",
    more: "More",
    scanToOpen: "Scan to open",
    downloadQr: "Download QR code",
  },

  download: {
    title: "Your download",
    file: "Download",
    expires: "This link works until {date}.",
    expired: "This link has expired. Get in touch with {shop} for a new one.",
    remaining: "Downloads left: {count}",
    usedUp:
      "You've used every download on this link. Get in touch with {shop} if you need it again.",
    notReady: "Your files unlock once {shop} confirms your payment.",
    /*
     * A digital product that is a link or a code rather than a file. Same
     * gate, same page, different noun — "Download" would be a button that
     * downloads nothing.
     */
    linkLabel: "Your link",
    codeLabel: "Your access details",
    open: "Open",
    visitShop: "Visit {shop}",
  },

  /*
   * A licence key, and what it is good for — spec 48.
   *
   * Its own section rather than four more keys inside `download`, and the
   * reason is the glossary rather than tidiness: `download` is a protected
   * money section, so nothing may be machine-translated into it. These strings
   * are not money — they are the delivery labels on a credential, the same
   * kind of thing `tickets` holds and for the same reader — so they belong
   * where a filler can reach them. Nothing here names a price, a refund or a
   * charge, and nothing here should ever start to.
   */
  license: {
    title: "Your licence key",
    /** `{count}` is the seat count, not how many are left. */
    activations: "Works on up to {count} machines",
    unlimited: "Works on any number of machines",
    expires: "Valid until {date}",
  },

  /*
   * Spec 41 — the chrome around a seller's own hosted documents.
   *
   * The chrome only. The documents themselves are English and stay English:
   * a template in thirty-five languages is thirty-five legal documents, and a
   * machine-translated refund clause is precisely the case Decision A says is
   * never machine-translatable. What is translated here is the frame — the
   * link back to the shop, the section headings, and the disclaimer, which is
   * the one sentence on the page that has to be understood by everybody.
   */
  pages: {
    /*
     * Not optional and not dismissible, on every generated legal page and at
     * the top of the generator. The register is borrowed from Easytools' own
     * tax wizard, and it is the right one: it respects the reader, it does not
     * pretend the output is advice, and it puts responsibility where it sits.
     */
    disclaimer:
      "This document was produced from a template and edited by the shop. It is a starting point, not legal advice.",
    /** The heading over the FAQ accordion, when the seller left theirs blank. */
    faq: "Frequently asked questions",
    /** The label on the footer row holding the shop's own documents. */
    shopPolicies: "Shop policies",
    visitShop: "Visit {shop}",
  },

  /*
   * Spec 52 — a buyer asking what a shop holds about them.
   *
   * Every string here is read by somebody with no account, cold, from a link in
   * a footer. The three that matter most are `received`, `unavailable` and
   * `badLink`, and they are worded against three different mistakes:
   *
   *   `received` is the **only** thing the form ever says on success, whether
   *   the address is known, unknown or suppressed. A form that answered
   *   differently would be a customer-list oracle, on a form whose subject is
   *   literally whether somebody is in a database.
   *
   *   `unavailable` is not an answer about the request. Decision B has this
   *   endpoint failing closed, and a throttled or degraded refusal has to read
   *   as "we could not check" — the same rule `COUPON_MESSAGES.unavailable`
   *   follows.
   *
   *   `badLink` never says whether the request existed, only that the link does
   *   not work.
   */
  dataRequest: {
    title: "Request your data",
    body: "Ask {shop} for a copy of what they hold about you, or ask them to delete it.",
    emailLabel: "The email address you used",
    kindLabel: "What are you asking for?",
    kindAccess: "A copy of what you hold about me",
    kindPortability: "A portable copy I can take elsewhere",
    kindErasure: "Delete what you hold about me",
    cta: "Send my request",
    received:
      "Thanks. If we hold anything for that address, we've sent a link there to confirm it's you. Nothing happens until you click it.",
    note: "This covers this shop only. Other shops on Sailo keep their own separate records and have to be asked separately.",
    confirmed: "Confirmed — thank you",
    confirmedBody:
      "{shop} has {days} days to answer. We'll email you at this address when they do.",
    badLink: "This link doesn't open anything",
    badLinkBody:
      "It may have expired, or already been used. Ask {shop} again from their shop page and a new link will be sent.",
    unavailable: "We couldn't check that just now. Try again in a moment.",
    /** The storefront footer's own link. Short: it sits beside five others. */
    footerLink: "Request your data",
  },

  /*
   * Spec 44 — the page that asks a buyer whether their parcel arrived.
   *
   * Deliberately its own section rather than part of `orderStatus`: this is a
   * standalone page reached from a link in a shipping email, by somebody with no
   * session who may not remember the order. Every string here has to make sense
   * cold.
   *
   * The copy carries a load nothing else on the storefront does. A confirmation
   * here becomes evidence submitted to a card network, so it must be
   * unmistakable what is being confirmed — "yes, this arrived" and nothing
   * vaguer — and it must never read as a request the buyer is obliged to answer.
   */
  arrival: {
    title: "Did your order arrive?",
    body: "{shop} sent this on {date}. Letting them know it arrived takes one tap and helps them keep their records straight.",
    confirm: "Yes, it arrived",
    confirmed: "Thanks — we've recorded that it arrived.",
    already: "You've already confirmed this one. Nothing more to do.",
    /*
     * Not "invalid link". A buyer holding a real link that we could not check —
     * an expired signing key, a cold cache — must not be told their order is
     * wrong, which is the same rule the coupon path follows.
     */
    unavailable: "We couldn't check that link just now. Try again in a moment.",
    notFound: "This link doesn't open anything. If your order hasn't arrived, get in touch with {shop}.",
    /** The one thing the page must never imply is that a complaint is closed. */
    problem: "Something wrong with it? Get in touch with {shop}.",
  },

  tickets: {
    title: "Your tickets",
    notReady: "Your tickets unlock once {shop} confirms your payment.",
    admitOne: "Admit one",
    showAtDoor: "Show this at the door.",
    used: "Used",
    online: "Online event",
    inPerson: "In person",
    join: "Join the event",
    joinLocked: "Your join link appears here once {shop} confirms your payment.",
    joinMissing: "The organiser hasn't added a join link yet.",
  },

  /**
   * Buyer-facing labels for the checkout rails. The admin-side defs in
   * `lib/payments.ts` stay seller-oriented ("Buyer sees your account
   * details…"); these are what the shopper reads.
   */
  rails: {
    cardName: "Card",
    cardAction: "Pay by card",
    /*
     * Every wallet Stripe can settle by itself, named — because a button that
     * says only "card" is a button an Apple Pay user scrolls past looking for
     * their own. Which ones actually appear is Stripe's decision at runtime
     * from the buyer's country and device, so the sentence promises the set
     * and not any one of them.
     */
    cardDesc:
      "Card, Apple Pay, Google Pay, Link and Cash App Pay — you'll see the ones available where you are.",
    whatsappAction: "Order on WhatsApp",
    whatsappDesc: "Opens WhatsApp with your order already written out.",
    telegramAction: "Order on Telegram",
    telegramDesc: "Opens a Telegram chat with your order already written out.",
    instagramName: "Instagram DM",
    instagramAction: "Order via Instagram",
    instagramDesc: "Opens a DM. Copy the details from the next screen.",
    emailName: "Email",
    emailAction: "Order by email",
    emailDesc: "Opens your mail app with the order written out.",
    phoneName: "Phone call",
    phoneAction: "Call to order",
    phoneDesc: "Shows the shop's number and dials it on mobile.",
    bankName: "Bank transfer",
    bankAction: "Pay by bank transfer",
    bankDesc: "Send the money to the account shown next, then add a reference.",
    codName: "Cash on delivery",
    codAction: "Pay on delivery",
    codDesc: "Pay when the order reaches you.",
    venmoAction: "Pay with Venmo",
    venmoDesc: "Opens Venmo with the amount filled in. Come back here to confirm.",
    paypalAction: "Pay with PayPal",
    paypalDesc: "Opens PayPal with the amount filled in. Come back here to confirm.",
    shippingName: "Shipping",
    shippingDesc: "Delivered to your address.",
    collectionName: "Collection",
    collectionDesc: "Pick it up in person.",
  },

  affiliate: {
    yourName: "Your name",
    yourEmail: "Your email",
    applyThanks: "Thanks! We'll be in touch with your link.",
    title: "Earn {percent}% sharing {shop}",
    intro: "Share what you love and take a cut of every order from your link.",
    step1: "Get your link",
    step1Signup: "Sign up below and we'll send you a personal link.",
    step1Buyer: "Buy something and you'll be offered your own link at checkout.",
    step2: "Share it",
    step2Body: "Post it, message it, put it in your own bio — anywhere your people are.",
    step3: "Earn {percent}%",
    step3Body: "Every order placed through your link earns you {percent}% of the order value.",
    applyTitle: "Apply to join",
    applyButton: "Apply to join",
    inviteOnly:
      "This programme is invite-only right now — place an order and you'll get your link automatically.",
    terms: "Terms",
  },

  /** The affiliate's own report — reached by a private link, no account. */
  partner: {
    title: "Your referrals",
    subtitle: "{name} · {percent}% of every order through your link to {shop}",
    yourLink: "Your link",
    unpaid: "Owed to you",
    earned: "Earned",
    orders: "Orders",
    clicks: "Clicks",
    conversionLine: "{orders} of {clicks} clicks turned into an order — {percent}%.",
    noClicksYet: "No clicks on your link yet.",
    salesLine: "{amount} of sales sent so far.",
    last30: "Commission · last 30 days",
    allShops: "Shops you promote",
    viewing: "viewing",
    earnedLower: "earned",
    unpaidLower: "owed",
    recent: "Recent orders",
    noOrders: "Nothing yet. Share your link and orders will show up here.",
    andMore: "+ {count} more",
    paid: "Paid out",
    awaitingPayout: "Awaiting payout",
    privateNote: "This page is private to you. {shop} pays out commission.",
    signInTitle: "Find your referral report",
    signInBody:
      "Enter the email you signed up with and we'll send your private link — one for every shop you promote.",
    signInAction: "Email me my link",
    signInDone:
      "If that address is registered, the link is on its way. Check your inbox.",
    signInEmail: "Your email",
    // The commission chart's readout.
    commission: "Commission",
    noActivity: "Nothing earned in this window yet.",
    // Payout details — the affiliate telling the seller where money goes.
    payoutTitle: "Getting paid",
    payoutIntro:
      "Tell {shop} where to send your commission. It sits next to what they owe you, so paying you is one less question.",
    payoutMethodLabel: "How",
    payoutBank: "Bank transfer",
    payoutPaypal: "PayPal",
    payoutOther: "Other",
    payoutDetailsLabel: "Where",
    payoutBankHint: "Account or IBAN, and the name on the account",
    payoutPaypalHint: "The email on your PayPal account",
    payoutOtherHint: "Tell {shop} how to pay you",
    payoutSave: "Save payout details",
    payoutSaved: "Saved — {shop} sees this next to what they owe you.",
    payoutOnFile: "On file: {method} · {details}",
    payoutNone: "Nothing on file yet.",
    // The link is the only credential there is, so the page says so.
    securityTitle: "Keep this link to yourself",
    securityBody:
      "This link is the only key to this page: anyone who has it can read your earnings and change how you're paid. Don't post it anywhere public. Think someone else has it? Reset it — the old link stops working straight away, and the new one is emailed to you.",
    securityReset: "Reset my link",
    securityResetDone:
      "Done — this is your new link, and the old one is dead. Save this page again wherever you keep it.",
  },

  invoice: {
    tax: "Tax",
    includes: "Includes",
    invoice: "Invoice",
    billedTo: "Billed to",
    details: "Details",
    item: "Item",
    qty: "Qty",
    price: "Price",
    amount: "Amount",
    payment: "Payment",
    delivery: "Delivery",
    pickup: "Pickup",
    reference: "Ref",
    note: "Note",
    paid: "Paid",
    unpaid: "Unpaid",
    refunded: "Refunded",
    paymentSent: "Payment sent",
    downloadPdf: "Download PDF",
    print: "Print or save PDF",
    taxId: "Tax ID",
    /** The company number, which is a different number from the VAT one. */
    registrationNumber: "Reg. no",
    /** Shown when the registered entity is not the name the buyer bought from. */
    tradingAs: "Trading as {name}",
    /*
     * The sentence that makes a zero-VAT B2B invoice compliant. Worded as the
     * EU directive words it — the *recipient* accounts for the tax — rather
     * than as "no VAT charged", which states the effect and omits the reason.
     */
    reverseCharge: "Reverse charge — VAT to be accounted for by the recipient.",
    customerTaxId: "Customer tax ID",
  },

  auth: {
    welcomeBack: "Welcome back",
    signInSubtitle: "Sign in to manage your shop.",
    createShop: "Create your shop",
    signupSubtitle: "Free, and live in under a minute.",
    yourName: "Your name",
    email: "Email",
    password: "Password",
    minChars: "8 characters minimum",
    signIn: "Sign in",
    createMyShop: "Create my shop",
    haveShop: "Already have a shop?",
    newHere: "New to Sailo?",
    createOne: "Create one free",
    somethingWrong: "Something went wrong. Try again.",
    // Password reset. The "sent" line never says whether the address had an
    // account — that answer would turn this form into a way to find out who
    // sells on Sailo.
    forgotPassword: "Forgot your password?",
    forgotTitle: "Reset your password",
    forgotSubtitle: "We'll email you a link to set a new one.",
    sendResetLink: "Email me a link",
    resetSent:
      "If that address has an account, the link is on its way. It expires in an hour.",
    backToSignIn: "Back to sign in",
    resetTitle: "Choose a new password",
    resetSubtitle: "Last step — pick something you'll remember.",
    newPassword: "New password",
    confirmPassword: "Confirm password",
    passwordsDiffer: "Those two passwords don't match.",
    updatePassword: "Update password",
    resetDone: "Password updated. You can sign in with it now.",
    resetInvalid:
      "That link has expired or has already been used. Ask for a new one.",

    /*
     * The second step of a password sign-in, for accounts with two-factor on.
     * Nothing here says whether the account exists or whether the password was
     * right — reaching this screen at all already answers both, and only the
     * person who got here can see it.
     */
    twoFactorTitle: "Enter your code",
    twoFactorSubtitle: "Open your authenticator app and type the six digits it shows.",
    twoFactorCode: "Six-digit code",
    twoFactorVerify: "Verify and sign in",
    twoFactorUseBackup: "Use a backup code instead",
    twoFactorBackupTitle: "Use a backup code",
    twoFactorBackupSubtitle:
      "Enter one of the codes you saved when you turned two-factor on. Each one works once.",
    twoFactorBackupCode: "Backup code",
    twoFactorUseApp: "Use your authenticator app instead",
    twoFactorExpired: "That took too long. Sign in again to get a new code prompt.",
  },

  onboarding: {
    /** Stands in on the live preview until the seller has typed a name. */
    shopNameFallback: "Your shop",
    /** A stand-in handle, so the shape of the URL is visible before typing. */
    handlePlaceholder: "yourshop",
    claimTitle: "Claim your link",
    claimSubtitle:
      "This is the address you'll put in your bio. You can change it later.",
    yourLink: "Your Sailo link",
    shopName: "Shop name",
    shortDescription: "Short description",
    currency: "Currency",
    whatsapp: "WhatsApp",
    whatsappHint: "Include your country code, no + or spaces. This is where orders land.",
    stepOf: "Step {current} of {total}",
    continue: "Continue",
    shopTitle: "Name your shop",
    shopSubtitle: "This is what buyers see at the top of your page.",
    ordersTitle: "Where orders land",
    ordersSubtitle: "Price in your currency, and tell buyers how to reach you.",
    location: "Where you are",
    preview: "Your shop, so far",
    createMyShop: "Create my shop",
  },

  handle: {
    label: "Shop link",
    available: "{handle} is available",
    hint: "Letters, numbers, hyphens and underscores.",
    current: "This is your current link. Changing it breaks any links already shared.",
    tryInstead: "Try:",
  },

  nav: {
    overview: "Overview",
    products: "Products",
    categories: "Categories",
    orders: "Orders",
    clients: "Clients",
    reviews: "Reviews",
    coupons: "Coupons",
    affiliates: "Affiliates",
    payments: "Payments",
    delivery: "Delivery",
    settings: "Settings",
    checkin: "Check-in",
    viewShop: "View shop",
    signOut: "Sign out",
    upgrade: "Upgrade",
    openMenu: "Open menu",
    closeMenu: "Close menu",
    broadcasts: "Broadcasts",
    members: "Members",
    /** Spec 41 — the seller's own terms, privacy policy, refunds, about, FAQ. */
    legal: "Legal pages",
    /** Spec 52 — the statutory queue. Never abbreviated: "DSARs" is jargon. */
    dataRequests: "Data requests",
    /** Spec 35. Beside Reviews, because both are queues somebody moderates. */
    testimonials: "Testimonials",
  },

  notifications: {
    aBuyer: "A buyer",
    title: "Notifications",
    markAllRead: "Mark all read",
    empty: "All caught up",
    emptyBody: "New orders and reviews will appear here.",
    dismiss: "Dismiss",
    newOrder: "New order",
    paymentToConfirm: "Payment to confirm",
    paymentBody: "{name} says they've paid {amount} for {product}.",
    reviewPending: "Review awaiting approval",
    reviewBody: "{name} left {rating}.",
    affiliateApplication: "Affiliate application",
    affiliateBody: "{name} wants to promote your shop.",
    payoutUpdated: "Payout details updated",
    payoutUpdatedBody: "{name} set how they'd like to be paid.",
    readyToShip: "Ready to ship",
    shipBody: "{product} for {name} — add tracking when you post it.",
    justNow: "just now",
  },

  settings: {
    storefrontLanguage: "Storefront language",
    storefrontLanguageHint: "what visitors see by default",
  },
  highlights: {
    free1: "10 products",
    free2: "Unlimited categories",
    free3: "WhatsApp, Telegram, Instagram, email ordering",
    free4: "Bank transfer and cash on delivery",
    free5: "Shipping and collection options",
    free6: "Reviews, search and filters",
    free7: "PDF invoices",
    free8: "Import your products and customers",
    free9: "7 days of analytics",
    pro1: "100 products",
    pro2: "No Sailo badge",
    pro3: "Export products, orders and customers",
    pro4: "A year of analytics",
    pro5: "Email support",
    biz1: "Unlimited products",
    biz2: "Card payments through your own Stripe",
    biz3: "Discount codes",
    biz4: "Referral programme with commissions",
    biz5: "Three years of analytics",
    biz6: "Priority support",
  },
  billing: {
    cardTitle: "Take card payments",
    cardBody: "Let buyers pay by card through your own Stripe account. The money lands in your account, not ours — Sailo keeps {fee} of card sales.",
    couponsTitle: "Run discount codes",
    couponsBody: "Percentage or fixed discounts, with minimum spend, usage caps and expiry dates.",
    affiliatesTitle: "Start a referral programme",
    affiliatesBody: "Pay people a commission for sales they send you. Buyers can opt in right after ordering.",
    exportTitle: "Export your data",
    exportBody: "Download products, orders and customers as CSV, ready for Excel or another platform.",
    badgeTitle: "Remove the Sailo badge",
    badgeBody: "Your shop, your branding — nothing of ours in the footer.",
    upgradeTitle: "Upgrade your plan",
    upgradeBody: "More room, better branding and the tools that grow revenue.",
    monthly: "Monthly",
    yearly: "Yearly",
    perMonth: "/month",
    billedYearly: "{amount} billed yearly",
    upgradeTo: "Upgrade to {plan}",
    yourPlan: "Your plan",
    currentPlan: "Current plan",
    unlocksThis: "Unlocks this",
    bestValue: "Best value",
    cancelAnyTime: "Cancel any time. Chat and bank-transfer orders are always yours in full; card sales carry a {fee} fee.",
    planFeature: "{plan} feature",
    paidFeature: "Paid feature",
    youAreOn: "You're on {plan}",
  },

  unsubscribe: {
    link: "Unsubscribe",
    title: "Stop marketing emails from {shop}?",
    body: "{email} will stop receiving marketing emails from {shop}. Order confirmations and receipts still arrive as usual.",
    confirm: "Yes, unsubscribe me",
    doneTitle: "You're unsubscribed",
    doneBody: "{shop} won't send you marketing emails again. Order confirmations still arrive as usual.",
    invalidTitle: "This link has expired",
    invalidBody: "Reply to any email from the shop and ask them to remove you, and they will.",
    sailoTitle: "Stop marketing emails from Sailo?",
    sailoBody: "{email} will stop receiving tips and product news from Sailo. Order, billing and account emails still arrive as usual.",
    sailoDoneBody: "Sailo won't send you tips or product news again. Order, billing and account emails still arrive as usual.",
    sailoInvalidBody: "Email support@sailo.store and we'll take you off the list.",
  },

  /*
   * The mailing list, from both ends: the form somebody joins it with, the
   * page that confirms they meant it, and the few words a shop's marketing
   * email wears that are ours rather than the seller's.
   *
   * The seller writes the body of a broadcast and we never translate it —
   * they know what language their customers read. Everything here is chrome
   * around it, and chrome follows the shop's own language.
   */
  /** A member's own view of what they pay for, on their delivery page. */
  membership: {
    title: "Your membership",
    activeUntil: "Active — renews {date}.",
    endingOn: "Ends {date}. You keep access until then.",
    pastDue: "We couldn't take the last payment. We'll retry — update your card to be sure.",
    ended: "This membership has ended.",
    manage: "Manage or cancel",
    manualRenew: "Time to renew — your access runs to {date}. Pay the shop and they'll confirm it.",
    manualPending: "You arrange payment directly with the shop — there's no card on file.",
    pass: "Your member pass",
  },

  mailing: {
    title: "Join the list",
    body: "New arrivals, offers and news from {shop} — straight to your inbox.",
    emailLabel: "Email address",
    nameLabel: "First name",
    cta: "Subscribe",
    // Deliberately the same sentence whether the address was already on the
    // list, never seen, or blocked. The form is not an address checker.
    checkInbox: "Almost there — open the email we just sent and tap confirm.",
    invalidEmail: "That address doesn't look right.",
    // Throttled is unknown, never "check your inbox": one office or one
    // mobile network is many people behind one address, and a first-time
    // subscriber can trip the limit having done nothing.
    tooMany: "Too many sign-ups from here just now — try again in a few minutes.",
    privacyNote: "Unsubscribe any time. Your address is never sold or shared.",
    confirmTitle: "Confirm your subscription",
    confirmBody: "Tap below and {shop} can email you news and offers. Order emails are separate and arrive either way.",
    confirmCta: "Yes, subscribe me",
    confirmedTitle: "You're on the list",
    confirmedBody: "{shop} will be in touch when there's something worth knowing.",
    expiredTitle: "This link has expired",
    expiredBody: "Confirmation links last a few days. Sign up again and we'll send a fresh one.",
    confirmSubject: "Confirm your subscription to {shop}",
    confirmEmailBody: "someone asked to hear from {shop} at this address. Tap below and you're on the list. If it wasn't you, ignore this email — nothing has been added anywhere.",
    // The promotion block a broadcast carries.
    amountOff: "{amount} off",
    useCode: "Use code {code}",
    endsOn: "Ends {date}",
    minSpend: "Minimum spend {amount}",
    shopNow: "Visit the shop",
    /** What a merge tag says when the contact has no name on file. */
    friend: "there",
  },
  /*
   * Spec 07 — the form a lead product shows instead of a buy panel.
   *
   * Six keys, and the two "thanks" are two on purpose: a magnet with a file
   * genuinely does put something in an inbox, and one without does not.
   * Saying "check your email" to somebody who will never get one is the small
   * lie that makes a seller's support inbox fill up.
   *
   * Which of the two is shown depends on the *product*, never on the row that
   * was just written. A message that changed with whether the address was
   * already known would be an address checker with extra steps.
   */
  lead: {
    submit: "Send it to me",
    sending: "Sending…",
    thanks: "Thanks! Check your inbox — it's on its way.",
    thanksNoFile: "Thanks! {shop} has your details.",
    answerRequired: "Please answer: {question}",
    privacy: "Your details go to this shop only, and you can ask them to delete them at any time.",
  },

  /*
   * Spec 35 — the page somebody the seller asked writes a testimonial on.
   *
   * The embed and the storefront strip carry no copy of their own: they render
   * what people wrote, and a heading there is the seller's `headline` rather
   * than a translated string. So this section is only the invitation page.
   */
  testimonial: {
    title: "A few words for {shop}?",
    body: "They asked because you bought something. It takes a minute, and they'll read it.",
    yourRole: "What you do",
    words: "What would you say?",
    video: "Or a video",
    videoHint: "A YouTube or Vimeo link. Nothing else works here.",
    send: "Send it",
    thanks: "Thank you — the shop will take a look.",
    moderated: "They choose what goes on their page, and you can ask them to remove it later.",
    wallTitle: "What people say",
  },

} as const;

/**
 * Same key structure as the English source, but every leaf widened to `string`.
 * A missing or misspelled key is still a compile error; the translated text
 * itself is free. Without this, `as const` would pin values to their English
 * literals and no translation would typecheck.
 */
type Translated<T> = {
  [K in keyof T]: T[K] extends string ? string : Translated<T[K]>;
};

export type Dictionary = Translated<typeof en>;
