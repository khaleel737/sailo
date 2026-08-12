/**
 * The admin's own dictionary.
 *
 * Kept apart from the storefront's: a shop's customers and its owner are
 * different audiences, the storefront's copy is chosen by the seller for their
 * buyers, and this is chosen for the seller themselves. Splitting them also
 * means a locale can translate the admin gradually — `getAdminDictionary`
 * falls back to these strings key by key, so a half-finished translation shows
 * English words rather than blank ones.
 */
export const adminEn = {
  common: {
    save: "Save",
    saveChanges: "Save changes",
    cancel: "Cancel",
    delete: "Delete",
    edit: "Edit",
    add: "Add",
    optional: "optional",
    private: "private",
    unlimited: "Unlimited",
    active: "Active",
    inactive: "Inactive",
    pending: "Pending",
    disabled: "Disabled",
    disable: "Disable",
    live: "Live",
    off: "Off",
    hidden: "Hidden",
    featured: "Featured",
    soldOut: "Sold out",
    paid: "Paid",
    approve: "Approve",
    view: "View",
    viewAll: "View all",
    visit: "Visit",
    name: "Name",
    email: "Email",
    code: "Code",
    type: "Type",
    status: "Status",
    expires: "Expires",
    day: "Day",
    viewAsTable: "View as table",
  },

  /**
   * Column headings for the list tables. Kept together rather than under each
   * page's own section: they are one- and two-word labels that recur across
   * lists, and a translator does a better job seeing them side by side.
   */
  columns: {
    actions: "Actions",
    category: "Category",
    client: "Client",
    code: "Code",
    discount: "Discount",
    expires: "Expires",
    never: "Never",
    orders: "Orders",
    product: "Product",
    price: "Price",
    products: "Products",
    spent: "Spent",
    status: "Status",
    stock: "Stock",
    used: "Used",
    where: "Where",
  },

  shell: {
    suspended: "Your shop is suspended.",
    staffNotice: "You're signed in as Sailo staff.",
    openHq: "Open HQ",

    /**
     * Shown until a shop has one rail a buyer could actually pay through.
     * Phrased as the consequence — no orders — rather than as the missing
     * setting, because a seller who hasn't set one up doesn't yet know that
     * "payment method" is the thing standing between them and a sale.
     */
    noRail: "Your shop can't take orders yet.",
    noRailBody:
      "Turn on at least one way to get paid and buyers can start checking out.",
    noRailCta: "Set up payments",

    /**
     * Shown until the seller clicks the confirmation link sign-up mailed
     * them. Not a gate — the admin keeps working — but until it's clicked the
     * account is only a claim to an inbox, so the banner stays until the
     * address is proven theirs.
     */
    verifyEmail: "Confirm your email address.",
    verifyEmailBody:
      "We sent a link to your inbox when you signed up — one click proves this address is yours.",
    verifyEmailCta: "Resend email",
    verifyEmailSent: "Sent — check your inbox.",
    /**
     * Names the room. /admin and /hq share a rail now, so the label carries
     * the distinction the colour used to — see the note in the sidebar.
     */
    role: "Shop admin",

    /**
     * The panel footer. A seller signs the terms here, not on the marketing
     * site, so this is where the documents have to be reachable from.
     */
    legal: "Legal",
    privacy: "Privacy",
    terms: "Terms",
    refunds: "Refunds",
    gdpr: "GDPR",
  },

  /**
   * Sidebar group headings. They name what a seller is trying to do, not what
   * the pages under them are — "Catalogue" and "Selling" read as tasks where
   * "Products, Categories" would just repeat the links underneath.
   */
  navGroups: {
    catalogue: "Catalogue",
    selling: "Selling",
    growth: "Growth",
    setup: "Setup",
  },

  dashboard: {
    views: "Views",
    visitors: "Visitors",
    sales: "Sales",
    refunds: "Refunds",
    net: "Net",
    noVisits: "No visits yet — share your link.",
    noRevenue: "No revenue yet.",
    visitsRange: "Visits · last {days} days",
    revenueRange: "Revenue · last {days} days",
    shopLink: "Your shop link",
    recentOrders: "Recent orders",
    visits: "Visits",
    uniqueVisitors: "Unique visitors",
    orders: "Orders",
    netRevenue: "Net revenue",
    noOrders: "No orders yet",
    noOrdersBody:
      "When someone taps Order on your shop, their details land here — even before they message you.",
    /** Chart titles when the window is a picked date range, not a preset. */
    visitsCustom: "Visits · {range}",
    revenueCustom: "Revenue · {range}",
  },

  /** The date-range control above the dashboard. */
  range: {
    custom: "Custom",
    from: "From",
    to: "To",
    apply: "Apply",
  },

  /** The per-product table: Views · Orders · Conversion · Revenue. */
  performance: {
    title: "Product performance",
    conversion: "Conversion",
    revenue: "Revenue",
    /** Never a silent cap: the seller is told the table is a page of a whole. */
    showingTop: "Showing top {shown} of {total} products",
    empty: "No product views or sales in this range yet.",
    previous: "Previous",
    next: "Next",
  },

  products: {
    title: "Products",
    description: "Anything you sell — physical, digital or a service.",
    add: "Add product",
    addFirst: "Add your first product",
    edit: "Edit product",
    viewOnShop: "View on shop",
    empty: "No products yet",
    emptyBody:
      "Add your first item and it appears on your shop link immediately.",
    deleteProduct: "Delete product",
    newSubtitle: "It goes live on your shop as soon as you save.",
    variantCount: "{count} variants",
    variantCountOne: "1 variant",
    inStockCount: "{count} in stock",
  },

  productForm: {
    titleLabel: "Title",
    titlePlaceholder: "Speckled stoneware mug",
    descriptionLabel: "Description",
    descriptionPlaceholder:
      "Wheel-thrown, glazed in matte oatmeal. Holds 350ml. Dishwasher safe.",
    photos: "Photos",
    price: "Price ({currency})",
    compareAt: "Compare-at price",
    kind: "Type",
    category: "Category",
    noCategory: "No category",
    tags: "Tags",
    tagsHint: "comma separated, used by search",
    tagsPlaceholder: "handmade, ceramic, gift",
    physicalHint: "Physical products ask the buyer how they'd like it delivered.",
    digitalHint:
      "Digital products skip delivery and are sent as a private download link.",
    eventHint:
      "Events sell tickets. Stock is the capacity, variants are the tiers, and sales close when the doors open.",
    serviceHint:
      "Services skip delivery. Add a duration and let buyers pick a time below.",
    membershipHint:
      "Memberships renew every month or year until cancelled. With Stripe connected the card is charged automatically; on your other payment options Sailo asks the member to pay and you confirm it, exactly like any other order.",

    membershipTitle: "Membership billing",
    membershipBody: "How often the member is charged, and whether they get a run-up first.",
    membershipNeedsStripe:
      "Without Stripe connected, members pay the same way your other buyers do — Sailo raises the next period's order a few days early, emails them, and you mark it paid. Connect Stripe if you'd rather the card was charged automatically.",
    membershipPriceNote:
      "The price above is what they pay each interval, in {currency}. Changing it later applies to new members only: people already subscribed keep the price they signed up at until they cancel and rejoin.",
    billingInterval: "Charge them",
    billingIntervalHint: "Stripe bills the card automatically on this cycle.",
    everyMonth: "Every month",
    everyYear: "Every year",
    trialDays: "Free trial",
    trialDaysHint: "Days before the first charge. Leave blank for none.",
    /* Said where the field is, because a setting that quietly does nothing is
       worse than one that isn't offered. */
    trialDaysCardOnly:
      "Free trials need Stripe. On your other payment options the first period is due at signup — leave this blank.",
    optionsTitle: "Options & stock",
    optionsBody:
      "Sizes, colours, session lengths — anything the buyer chooses between.",
    trackStock: "Track stock",
    trackStockBody:
      "Counts units down with every order and stops sales at zero.",
    filesTitle: "Files to deliver",
    filesBody:
      "Buyers get a private download page as soon as the order is released.",
    releaseOnPayment: "Release only after payment is confirmed",
    releaseOnPaymentBody:
      "Every payment option here settles outside Sailo, so leaving this on stops someone taking the file without paying. Free products unlock straight away either way.",
    downloadLimit: "Download limit",
    downloadLimitHint: "blank = unlimited",
    downloadExpiry: "Link expires after (days)",
    downloadExpiryHint: "blank = never",
    serviceTitle: "Service details",
    serviceBody:
      "How long it takes, where it happens, and whether buyers book a time.",
    duration: "Duration (minutes)",
    where: "Where",
    inPerson: "In person",
    online: "Online",
    serviceLocation: "Location or joining details",
    serviceLocationHint: "optional, shown after ordering",
    serviceLocationPlaceholder:
      "12 Rue Lafayette, Paris — studio on the second floor",
    bookingEnabled: "Let buyers pick a date and time",
    bookingEnabledBody:
      "Adds a preferred date and time to checkout. You confirm the slot afterwards.",
    bookingLead: "Notice needed (hours)",
    bookingLeadHint: "the picker won't offer anything sooner",
    eventTitle: "Event details",
    eventBody: "When it happens, where to turn up, and when tickets unlock.",
    eventStartsAt: "Starts at",
    eventStartsAtHint: "in your own time zone \u2014 ticket sales close at this moment",
    eventVenue: "Venue or joining details",
    eventVenuePlaceholder: "Warehouse 7, Marina Bay \u2014 doors 19:00",
    eventReleaseOnPayment: "Release tickets only after payment is confirmed",
    eventReleaseOnPaymentBody:
      "Every payment option here settles outside Sailo, so leaving this on stops someone walking in without paying. Free events admit straight away either way.",
    eventCapacityHint:
      "Capacity is stock: turn on Track stock above and set how many can come. Ticket tiers \u2014 General, VIP \u2014 are variants with their own price and count.",
    inStock: "In stock",
    inStockBody: "Turn off to show a Sold out badge and disable ordering.",
    featured: "Featured",
    featuredBody: "Pins this product to the top of your shop.",
    published: "Published",
    publishedBody: "Uncheck to hide it from your shop while you work on it.",
    added: "Product added.",
    updated: "Product updated.",
    eventWhere: "Where it happens",
    eventInPerson: "At a venue",
    eventOnline: "Online",
    eventJoinUrl: "Join link",
    eventJoinUrlHint: "Zoom, Meet, Teams — anything with a link. Buyers only see it once their payment is confirmed.",
  },

  variants: {
    untick: "Untick",
    notSold: "This combination isn't sold",
    option: "Option",
    values: "Values",
    addOptions: "Add options",
    addAnother: "Add another option",
    intro:
      "Sizes for a pizza, colours for a shirt, session lengths for a consultation. Each combination gets its own price and stock — leave a price blank and it uses the product price above.",
    unitsInStock: "Units in stock",
    unitsHint: "blank = don't count",
    photo: "Photo",
    variant: "Variant",
    priceIn: "Price ({currency})",
    compareAt: "Compare at",
    stock: "Stock",
    sku: "SKU",
    forSale: "For sale",
    restore: "Bring back {count} removed combinations",
    restoreOne: "Bring back 1 removed combination",
    limitReached:
      "{max} combinations is the limit. Past that, separate products are easier for buyers to browse.",
    footnote:
      "Untick For sale to show a combination as sold out; delete it if you never sell it at all. A photo here replaces the product's when a buyer picks that combination.",
    optionNamePlaceholder: "Size",
    optionNamePlaceholderTwo: "Colour",
    optionValuesPlaceholder: "Small, Medium, Large",
    optionValuesPlaceholderTwo: "Red, Blue, Black",
    valuesNudge:
      "This reads as one value. Separate values with commas: 0.5 kg, 1 kg, 2 kg.",
    stockHint:
      "To count units left for each combination, turn on Track stock above.",
  },

  support: {
    title: "Support",
    description:
      "Stuck, found a bug, or something looks wrong? Tell us — we read every ticket and reply by email.",
    topic: "Topic",
    subject: "Subject",
    subjectPlaceholder: "What's it about?",
    message: "What's happening?",
    messagePlaceholder:
      "Tell us what you expected and what happened instead. The more detail, the faster we can help.",
    screenshots: "Screenshots",
    screenshotsHint: "optional, up to {max}",
    addImage: "Add a screenshot",
    removeImage: "Remove screenshot {n}",
    send: "Send to support",
    previous: "Your tickets",
    emptyBody:
      "Nothing yet. When you send a ticket, it shows up here with its status.",
    open: "Open",
    closed: "Closed",
    helpLabel: "Help & support",
  },

  /** Read by key — `a.supportTopics[topic]` — so the whole section is live. */
  checkin: {
    title: "Check-in",
    description: "Pick the event you're working the door for.",
    codeLabel: "Ticket code",
    scanHint: "or scan it with the camera",
    submit: "Check in",
    wrongEvent: "That ticket is for {event}, not this door.",
    wrongEventUnknown: "That ticket is for a different event.",
    revoked: "Cancelled — this ticket was refunded or withdrawn.",
    cancel: "Cancel",

    /* The picker */
    noEvents: "No events yet",
    noEventsBody: "Set a product's type to Event and its door opens here.",
    inOf: "{checkedIn} of {issued} in",
    startsAt: "Starts {when}",

    /* The console */
    tabScan: "Scan",
    tabList: "Guest list",
    tabManual: "Type a code",
    statIn: "Checked in",
    statOut: "Still to come",
    statIssued: "Tickets",
    statCapacity: "Capacity",
    scanStarting: "Starting the camera…",
    scanReady: "Point at a ticket",
    scanBlocked: "No camera here",
    scanBlockedBody:
      "Allow camera access in your browser, or use the guest list and the keypad instead.",

    /* The list */
    searchLabel: "Search by name, email or code",
    searchPlaceholder: "Name, email or code…",
    filterAll: "Everyone",
    filterIn: "Checked in",
    filterOut: "Not in yet",
    filterRevoked: "Cancelled",
    allTiers: "All tiers",
    emptyList: "Nobody here yet",
    emptyListBody: "Sold tickets and imported guests both show up in this list.",
    noMatches: "Nobody matching that",
    showingOf: "Showing {shown} of {total}",
    admit: "Let in",
    undo: "Undo",
    revoke: "Cancel this ticket",
    reinstate: "Restore ticket",
    unpaid: "Unpaid",
    comp: "Guest list",
    walkUp: "Walk-up",
    inAt: "In at {time}",
    byWhom: "by {name}",

    /* Walk-ups */
    addGuest: "Add someone at the door",
    addGuestBody:
      "Writes them onto the list and lets them in. Recorded as a walk-up, not a sale.",
    guestName: "Name",
    guestEmail: "Email (optional)",
    addAndAdmit: "Add and let in",

    /* Guest list CSV */
    importTitle: "Import a guest list",
    importBody:
      "Comps, VIPs, sponsor allocations, anyone who paid you outside the shop. Re-uploading the same file adds only what's new.",
    exportDoorList: "Download door list",

    /* Door passes */
    passes: "Door passes",
    passesBody:
      "A link that opens this door and nothing else — no orders, no customers, no payouts. Give one to each person working the door, so you can see who admitted whom, and revoke it when the night is over.",
    passName: "Who's holding it",
    passNamePlaceholder: "Front gate — Ana",
    passExpiry: "Stops working after",
    passHours: "{count} hours",
    passWeek: "A week",
    passCreate: "Create pass",
    passScope: "Which door",
    passThisEvent: "This event only",
    passAllEvents: "Every event",
    passRevoke: "Revoke",
    passRevoked: "Revoked",
    passExpired: "Expired",
    passNeverUsed: "Never used",
    passUsed: "{count} checked in",
    passNone: "No passes yet.",
    passCopy: "Copy link",
    passCopied: "Copied",
    checkedIn: "Checked in \u2014 let them through.",
    alreadyUsed: "Already used.",
    alreadyUsedAt: "Already used at {time}.",
    notReleased: "Not valid \u2014 this order isn't paid yet.",
    notFound: "No ticket with that code in your shop.",
  },

  supportTopics: {
    technical: "Technical problem",
    billing: "Plan & billing",
    payments: "Payments & payouts",
    orders: "Orders & delivery",
    account: "Account & login",
    other: "Something else",
  },

  files: {
    add: "Add a file",
    addAnother: "Add another file",
    uploading: "Uploading",
    hint: "PDF, zip, documents, audio, video or images · up to 100 MB each · buyers get a private link, never the file's address.",
    failed: "Upload failed.",
    failedNetwork: "Upload failed. Check your connection.",
  },

  images: {
    cover: "Cover",
    add: "Add",
    uploading: "Uploading",
    hint: "JPG, PNG, WebP or GIF · up to 8 MB each · first image is the cover",
  },

  categories: {
    nameLabelText: "Category name",
    title: "Categories",
    description: "These become the filter chips at the top of your shop.",
    empty: "No categories yet",
    emptyBody:
      "Categories are optional — add a few once you have enough products to group.",
    namePlaceholder: "Mugs, Prints, Consulting…",
  },

  /** The order lifecycle, as a seller reads it. Keys match the stored enum. */
  orderStatus: {
    new: "New",
    confirmed: "Confirmed",
    shipped: "Shipped",
    completed: "Completed",
    cancelled: "Cancelled",
    refunded: "Refunded",
  },

  orders: {
    carrier: "Carrier",
    trackingNumber: "Tracking number",
    trackingNumberPlaceholder: "JD0002890124",
    trackingLink: "Tracking link",
    trackingLinkPlaceholder: "https://dhl.com/track?id=…",
    markShipped: "Mark as shipped",
    refundAmountHint: "blank = full",
    refundReason: "Reason",
    refundReasonPlaceholder: "Arrived damaged",
    recordRefund: "Record refund",
    statusLabel: "Order status",
    paymentStatusLabel: "Payment status",
    confirmPayment: "Confirm payment",
    unpaid: "Unpaid",
    track: "Track",
    addTracking: "Add tracking",
    editTracking: "Edit tracking",
    refund: "Refund",
    title: "Orders",
    empty: "No orders yet",
    emptyBody: "Share your shop link and orders will show up here.",
    description:
      "Captured the moment someone taps Order — before they even send the message.",
    awaiting: "{count} buyers say they've paid — confirm to mark as paid.",
    awaitingOne: "1 buyer says they've paid — confirm to mark as paid.",
    deleteOrder: "Delete order",
    collectFrom: "Collect from",
    transferRef: "Transfer ref",
    items: "Items",
    delivery: "Delivery",
    refunded: "Refunded",
    andMore: "+ {count} more",
    filesReleased: "Files released",
    filesHeld: "Files held until you mark this paid",
    downloadedTimes: "downloaded {count}×",
    downloadedOf: "{count}/{limit} downloaded",
    paymentMethodLabel: "Payment method",
    coupon: "Coupon",
    clearFilters: "Clear",
    filtered: "{count} orders match these filters.",
    noMatches: "No orders match",
    noMatchesBody: "Clear a filter to see more.",
  },

  clients: {
    outstandingLabel: "Outstanding",
    saveNotesLabel: "Save notes",
    noOrdersYet: "No orders yet.",
    paid: "Paid",
    privateNotes: "Private notes",
    title: "Clients",
    empty: "No clients yet",
    emptyBody:
      "Buyers appear here once they place their first order and leave an email or phone number.",
    all: "All clients",
    contact: "Contact",
    noDetails: "No details captured.",
    lifetimeValue: "Lifetime value",
    notesPlaceholder:
      "Prefers pickup. Allergic to nickel. Repeat wholesale buyer…",
    tags: "Tags",
    tagsHint: "Comma separated. Used to pick who a broadcast goes to.",
    allTags: "Everyone",
    noneTagged: "Nobody with that tag",
    noneTaggedBody: "Add the tag to a customer and they'll show up here.",
    add: "Add contact",
    addBody: "Somebody who hasn't ordered yet — from a fair, a DM, a business card.",
    addConsentNote: "Contacts you add yourself can't receive broadcasts. Only people who ticked the marketing box at checkout, or signed up through your own signup page, can.",
    email: "Email",
    phone: "Phone",
    note: "Note",
  },

  reviews: {
    awaiting: "{count} waiting for your approval — only approved reviews show on your shop.",
    allApproved: "Only approved reviews show on your shop.",
    title: "Reviews",
    empty: "No reviews yet",
    emptyBody: "Buyers can leave a review on any product page.",
    approveReview: "Approve review",
    deleteReview: "Delete review",
  },

  coupons: {
    usageLimitPlaceholder: "Unlimited",
    discountCodes: "Discount codes",
    discountCodesBody: "Run promotions with percentage or fixed discounts, minimum spend, usage caps and expiry dates.",
    title: "Coupons",
    description: "Discount codes buyers enter at checkout.",
    empty: "No coupons yet",
    emptyBody: "Create a code above and share it with your customers.",
    expired: "Expired",
    usedUp: "Used up",
    percentOff: "Percentage off",
    fixedOff: "Fixed amount off",
    codePlaceholder: "WELCOME10",
    usageLimit: "Usage limit",
    minSpend: "Minimum spend",
    amount: "Amount",
  },

  affiliates: {
    statusActive: "Active",
    statusPending: "Pending",
    statusDisabled: "Disabled",
    letAnyoneApply: "Let anyone apply",
    programme: "Referral programme",
    programmeBody: "Give people a link, pay them a commission on what it brings in. Buyers can opt in to their own link right after ordering.",
    turnOnFirst: "Turn the programme on above to add affiliates and share links.",
    title: "Affiliates",
    description: "Pay people a share of what they sell for you.",
    empty: "No affiliates yet",
    emptyBody: "Add someone above, or let buyers opt in after they order.",
    markPaid: "Mark paid",
    runProgramme: "Run a referral programme",
    defaultCommission: "Default commission",
    commissionHint: "% of each order, before delivery",
    terms: "Programme terms",
    termsPlaceholder:
      "Commission is paid monthly by bank transfer once you reach $50.",
    saveSettings: "Save settings",
    namePlaceholder: "Amara Okafor",
    emailPlaceholder: "amara@example.com",
    codeHint: "auto if blank",
    codePlaceholder: "AMARA",
    commissionPercent: "Commission %",
    payoutNotes: "Payout notes",
    // What the affiliate entered on their portal — shown in full here only.
    payoutLabel: "Payout",
    payoutBank: "Bank transfer",
    payoutPaypal: "PayPal",
    payoutOther: "Other",
    payoutPlaceholder: "Pays out to GTB 0123456789",
    clicks: "Clicks",
    reportLink: "Their report:",
    copyReport: "Copy report link",
    sales: "Sales",
    earned: "Earned",
    unpaid: "Unpaid",
  },

  payments: {
    stripeErrorTitle: "Stripe couldn't start the setup",
    stripeNoResponse: "Stripe did not respond. Try again in a moment.",
    waysToOrder: "{count} ways to order",
    waysToOrderOne: "1 way to order",
    nothingLive: "Nothing live",
    liveCount: "{count} live",
    nobodyCanOrderBody: "Set up at least one option below — until you do, the Order buttons on your shop stay disabled.",
    payOnlineBody: "The buyer pays on the spot and the order confirms itself — no chasing, no marking things paid by hand.",
    chatHandoffBody: "The buyer is sent to a chat app with their order written out. Nothing is charged online — you agree payment between yourselves.",
    manualBody: "The buyer stays on your shop and sees your instructions. You confirm the payment from the Orders page.",
    notSetUp: "Not set up",
    unavailableHere: "Not available",
    /*
     * Names the shop's own currency as well as the supported ones, because
     * "PayPal settles in 22 currencies" reads as trivia and "your shop is in
     * JOD" reads as the reason.
     */
    currencyOnly:
      "{method} doesn't support {currency}, so it can't be switched on. It settles in: {currencies}.",
    buttonText: "Button text",
    buttonTextHint: "defaults to \"{name}\"",
    showOnShop: "Show on my shop",
    fillInFirst: "Fill in the details above before turning this on.",
    cardTitle: "Card payments",
    cardBody: "Buyers pay by card, Apple Pay or Google Pay without leaving the checkout. The money goes straight into your own Stripe account — Sailo never holds it, and keeps {fee} of the goods on each card sale.",
    stripeVerifying: "Stripe is verifying",
    finishSetup: "Finish setup",
    notConnected: "Not connected",
    seePlans: "See plans",
    cardOnPlan: "Card payments are part of {plan}.",
    connectStripe: "Connect Stripe",
    connectHint: "Opens Stripe. You'll need your bank details and an ID — Sailo never sees either.",
    account: "Account",
    country: "Country",
    continueOnStripe: "Continue on Stripe",
    payoutsOnStripe: "Payouts on Stripe",
    refreshStatus: "Refresh status",
    disconnect: "Disconnect",
    disconnectHint: "Disconnecting stops new card orders. Your Stripe account, its payouts and its records stay exactly where they are.",
    stripeNeedsDetails: "Stripe still needs some details before you can take payments.",
    stripeChecking: "Stripe has your details and is checking them. This is usually quick, and the card option turns on by itself.",
    title: "Payments",
    description:
      "Turn on as many ways to order as you like. Buyers pick one at checkout.",
    nobodyCanOrder: "Nobody can order yet",
    payOnline: "Pay online",
    chatHandoff: "Chat handoff",
    manual: "Manual payment",
  },

  delivery: {
    kind: "Type",
    freeOverLabel: "Free over",
    addOptionBody: "Standard, express, international or collection in person.",
    liveOfCount: "{live} of {total} live",
    title: "Delivery",
    description:
      "Add as many options as you like — Standard, Express, pickup. Buyers pick one at checkout.",
    empty: "No delivery options yet",
    emptyBody:
      "Add one below. Without any, physical orders are taken with no delivery choice and no fee.",
    only: "Only",
    needsPickup: "Needs a pickup address",
    addOption: "Add an option",
    editExisting: "Edit existing",
    offerAtCheckout: "Offer at checkout",
    nameBuyersSee: "Name buyers see",
    physicalOnly:
      "Only physical products ask about delivery — digital downloads and services skip it. Collection options never ask the buyer for an address.",
    shipsTo: "Ships to",
    zoneHelp:
      "Buyers anywhere else won't be offered this rate. Anywhere means worldwide.",
    zoneAnywhere: "Anywhere",
    zoneSelected: "Selected countries",
    zoneEu: "European Union",
    zoneEea: "EEA",
    zoneEurope: "Europe",
    zoneNorthAmerica: "North America",
    zoneClear: "Clear",
    zoneSearch: "Search countries",
    zoneNone: "No countries match that.",
    zoneCountOne: "{count} country",
    zoneCount: "{count} countries",
  },

  weekdays: {
    sunday: "Sunday",
    monday: "Monday",
    tuesday: "Tuesday",
    wednesday: "Wednesday",
    thursday: "Thursday",
    friday: "Friday",
    saturday: "Saturday",
  },

  settings: {
    tabDetails: "Shop details",
    tabBilling: "Plan & billing",
    tabSecurity: "Security",
    tabData: "Import & export",

    /* Seller-facing email switches. Every one defaults to on. */
    notifications: "Email notifications",
    notificationsBody:
      "What Sailo emails you about your own shop. Your buyers' emails are unaffected.",
    notifySentTo: "Sent to {email}",
    notifyOrderPlaced: "New orders",
    notifyOrderPlacedBody: "Someone bought something — including what and how much.",
    notifyBookingRequested: "Booking requests",
    notifyBookingRequestedBody:
      "Someone asked for an appointment and is waiting for you to confirm the time.",
    notifyOrderNeedsAction: "Payments to confirm",
    notifyOrderNeedsActionBody:
      "A buyer says they've sent a bank transfer, so the money needs checking.",
    notifyProductTips: "Tips & product news",
    notifyProductTipsBody: "Occasional email from Sailo about getting set up and selling more. Never about your orders.",
    taxIdPlaceholder: "GB123456789",
    identity: "Identity",
    appearance: "Appearance",
    ordersContact: "Orders & contact",
    socialLinks: "Social links",
    socialLinksBody: "Leave blank to hide. Icons appear under your description.",
    shopName: "Shop name",
    shopDescription: "Description",
    profilePicture: "Profile picture",
    profilePictureHint: "shown as a circle",
    logo: "Logo",
    logoHint: "replaces the shop name",
    accentColour: "Accent colour",
    customAccent: "Custom accent colour",
    useColour: "Use {color}",
    theme: "Theme",
    themeLight: "Light",
    themeDark: "Dark",
    productLayout: "Product layout",
    layoutGrid: "Grid",
    layoutList: "List",
    currency: "Currency",
    storefrontLanguage: "Storefront language",
    storefrontLanguageHint: "what visitors see by default",
    matchBrowser: "Match the visitor's browser",
    contactEmail: "Contact email",
    location: "Location",
    locationPlaceholder: "Portland, Oregon",
    collectAddress: "Ask for a delivery address",
    collectAddressBody: "Shown on physical products only. Turn off if you sell digital goods or services.",
    waysToOrderLiveIn: "Ways to order live in",
    tax: "Tax",
    taxBody: "Only turn this on if you are registered to charge it. Existing orders keep the rate they were placed at.",
    chargeTax: "Charge tax",
    chargeTaxBody: "Adds a tax line to checkout and to every invoice.",
    taxName: "Tax name",
    taxNameHint: "what buyers see — VAT, GST, Sales tax",
    taxRate: "Rate",
    taxRateHint: "percent, e.g. 20 or 7.5",
    taxShown: "How prices are shown",
    taxExclusive: "Prices exclude tax — added at checkout (US sales tax)",
    taxInclusive: "Prices already include tax (EU VAT, UK, most of Asia)",
    taxOnDelivery: "Tax the delivery fee",
    taxOnDeliveryBody: "Shipping is taxable in most places. Uncheck if yours is exempt.",
    compliance: "Checkout compliance",
    complianceBody: "Ask buyers to agree to your terms, and to opt in to marketing email.",
    requireTerms: "Require agreement to your terms",
    requireTermsBody: "Buyers tick a box before they can order. Orders without it are refused.",
    termsUrl: "Link to your terms",
    termsUrlHint: "optional — a public https:// address",
    askMarketingConsent: "Ask for marketing consent",
    askMarketingConsentBody: "An optional box, never pre-ticked. Only buyers who tick it may be emailed offers.",
    taxId: "Tax ID",
    taxIdHint: "optional — printed on invoices",
    tracking: "Analytics & pixels",
    trackingBody: "Connect your own tracking tools to measure visits and ad campaigns on your shop. Paste the ID, not the code snippet.",
    trackingConsentNote: "Adding any of these puts a cookie banner on your shop, as the law requires. The tools load only after a buyer accepts, and each buyer's choice is remembered for your shop alone.",
    ga4Label: "Google Analytics",
    ga4Hint: "GA4 measurement ID — G-ABC12DE3F4",
    gtmLabel: "Google Tag Manager",
    gtmHint: "container ID — GTM-ABC123",
    metaPixelLabel: "Meta Pixel",
    metaPixelHint: "numeric pixel ID from Meta Events Manager",
    tiktokPixelLabel: "TikTok Pixel",
    tiktokPixelHint: "pixel ID from TikTok Events Manager",
    booking: "Booking",
    bookingBody: "When you take appointments. Buyers only ever see times you are open and have not already filled.",
    timeZone: "Time zone",
    timeZoneHint: "Opening hours are read in this zone, so a booking means the same time to both of you.",
    openingHours: "Opening hours",
    opensAt: "opens at",
    closesAt: "closes at",
    closed: "Closed",
    closesBeforeOpens: "Closing time must be after opening time.",
    slotSpacing: "Slot spacing",
    slotSpacingHint: "How far apart appointments start. Leave as the service length unless you want tighter starts.",
    slotFollowsDuration: "Follow the service length",
    shopIsLive: "Shop is live",
    shopIsLiveBody: "Turn this off to take your page offline. Visitors will see a 404.",
    title: "Settings",
    description: "Your shop details, plan and data.",
    calendarSync: "Calendar sync",
    calendarSyncBody: "Block booking slots with busy time from your own calendar. Read-only — Sailo never writes to it.",
    calendarFeedUrl: "Calendar link",
    calendarFeedUrlHint: "In Google Calendar: Settings → your calendar → Secret address in iCal format. Apple and Outlook publish one too.",
    calendarFeedReplace: "Replace the calendar link",
    calendarFeedRemove: "Disconnect this calendar",
    calendarSyncConnected: "Connected to {host}",
    calendarSyncBroken: "This calendar isn't loading — no times are being blocked.",
    calendarSyncPrivacy: "Only busy times are read. Titles, guests and descriptions are never fetched or stored.",
    calendarSyncLocked: "Calendar sync is available on a paid plan.",
  },

  billing: {
    productSlots: "Product slots used",
    active: "Active",
    slotsUsed: "{used} of {limit} products used",
    zeroFee: "0% fee on card payments",
    accessEnds: "Access ends",
    renews: "Renews",
    atLimit: "You've used every product slot on {plan}. Existing products keep working — upgrade to add more.",
    perMonth: "/month",
    billedYearly: "{amount} billed yearly",
    upgradeTo: "Upgrade to {plan}",
    switchTo: "Switch to {plan}",
    free: "Free",
    monthly: "Monthly",
    yearly: "Yearly",
    cancelAnyTime: "Cancel any time. Downgrading never deletes products — you just can't add more until you're under the limit.",
    cancelled: "Checkout cancelled — nothing was charged.",
    currentPlan: "Current plan",
    paymentFailed: "Payment failed",
    cancelsAtPeriodEnd: "Cancels at period end",
    manageBilling: "Manage billing",
    notConfigured: "Billing isn't configured — set",
    popular: "Popular",
    current: "Current",
    yourPlan: "Your plan",
    downgrade: "Downgrade",
  },

  data: {
    exportsOnPlan: "Exports are available on {plan}",
    noFileSelected: "No file selected",
    imported: "Imported",
    importAnother: "Import another file",
    whichColumns: "Which columns are used?",
    export: "Export",
    downloadCsv: "Download CSV",
    import: "Import",
    importProducts: "Import products",
    importProductsBody:
      "Existing products are matched on Handle and updated; anything new is created.",
    importClients: "Import customers",
    importClientsBody:
      "Matched on email, or phone when there's no email. Existing details are never blanked by a missing column.",
    chooseCsv: "Choose CSV",
  },

  traffic: {
    referringSites: "Referring sites",
    geoEdge:
      "Geography is resolved at the edge — it appears once your shop is live.",
    noLocation: "No location data yet.",
    cityEdge: "Appears on your live shop, not in local previews.",
    noCity: "No city data yet.",
    allDirect: "Everyone arrived directly — no referring site.",
    campaignHint: "Tag a link with ?utm_campaign=spring to track it here.",
    noVisits: "No visits yet",
    rangeSummary: "Last {days} days · {count} visits",
    title: "Where your visitors come from",
    countries: "Countries",
    cities: "Cities",
    howTheyFound: "How they found you",
    devices: "Devices",
    campaigns: "Campaigns",
    referrers: "Referrers",
    noData: "No data yet",
    destinations: "Where they go next",
    destinationsEmpty:
      "No outbound clicks yet — taps on your social icons and contact handoffs count here.",
  },
  /**
   * Where the money for one order currently stands, as opposed to where the
   * order does. Read by bracket in `payment-status-select`, so the coverage
   * test counts this section wholesale.
   */
  paymentStatus: {
    unpaid: "Unpaid",
    pending: "Payment sent",
    paid: "Paid",
    refunded: "Refunded",
    /** Not a status the seller may set — the bank already decided. */
    disputed: "Chargeback",
  },

  /**
   * Settings → Security: two-factor verification, the devices signed in to
   * this account, and deleting it. The copy here is deliberately plain about
   * consequences — every control on that tab either locks someone out or
   * throws something away.
   */
  security: {
    title: "Two-factor verification",
    body: "Ask for a code from your phone as well as your password. It's the single best protection against someone who has learned your password.",
    on: "On",
    off: "Off",
    turnOn: "Turn on",
    turnOff: "Turn off",
    yourPassword: "Your password",
    confirmPassword: "Confirm it's you",
    confirmPasswordBody: "Enter your password to start setting up two-factor verification.",
    scanTitle: "Scan this with your authenticator app",
    scanBody:
      "Use Google Authenticator, 1Password, Authy — any of them. Then type the six-digit code it shows.",
    cantScan: "Can't scan? Enter this key by hand:",
    codeLabel: "Six-digit code",
    confirmTurnOn: "Confirm and turn on",
    backupTitle: "Save your backup codes",
    backupBody:
      "Each code works once, and gets you in if you lose your phone. This is the only time they are shown.",
    backupWarning: "Store them somewhere safe and away from your phone. Without your phone or a backup code, nobody can let you back in.",
    copyCodes: "Copy codes",
    codesCopied: "Copied",
    backupSaved: "I've saved them",
    regenerate: "New backup codes",
    regenerateBody:
      "Replaces the codes you have now — the old ones stop working immediately.",
    turnOffTitle: "Turn off two-factor verification",
    turnOffBody:
      "Your password alone will get into this account again. We ask for a code as well as your password, because someone who only has your password must not be able to switch this off.",
    codeOrBackup: "Code, or a backup code",
    changeSignsOutOthers:
      "Turning this on or off signs out every other device, and we email you about it.",

    sessionsTitle: "Login sessions",
    sessionsBody: "Everywhere this account is signed in right now.",
    colLocation: "Location",
    colDevice: "Device",
    colIp: "IP address",
    colWhen: "Signed in",
    currentSession: "Current session",
    terminate: "Terminate",
    signOutOthers: "Sign out all other sessions",
    unknownLocation: "Unknown",
    noSessions: "No other devices are signed in.",

    deleteTitle: "Delete my account",
    deleteBody:
      "Deletes your shop, your products and your files, and closes your account. This cannot be undone.",
    deleteKeeps:
      "Records of orders you have already taken are kept without your personal details, because invoices that document real payments must survive for tax purposes.",
    deleteReleases: "Your handle @{handle} is released, and your page goes offline.",
    deleteConfirmLabel: "Type {handle} to confirm",
    deleteConfirmMismatch: "That doesn't match your handle.",
    deleteButton: "Delete my account permanently",
    deleteBlockedTitle: "Finish your open orders first",
    deleteBlockedBody:
      "You have paid orders that haven't been delivered yet. Fulfil or refund them, then come back — deleting now would take money for goods nobody will send.",
  },

  /**
   * The "Store setup" card on the dashboard. Four steps, derived from the
   * shop itself — see `lib/onboarding.ts` for why publishing isn't one.
   */
  setup: {
    title: "Store setup",
    body: "A few things between you and a shop that can take an order.",
    count: "{done} of {total}",
    dismiss: "Hide this",
    photo: "Add your photo",
    photoHint: "A face or a logo at the top of your shop.",
    product: "Add your first product",
    productHint: "Anything you sell — physical, digital or a service.",
    paid: "Turn on a way to get paid",
    paidHint: "Cash, bank transfer, a chat handoff or card. One is enough.",
    social: "Connect a social",
    socialHint: "So people who find your shop can find you too.",
  },

  /** Refer-a-creator: the seller's own share card on the dashboard. */
  referral: {
    title: "Refer a creator",
    body: "Share your link and keep {share} of what they pay Sailo, every month, for as long as they stay.",
    copy: "Copy link",
    copied: "Copied",
    referred: "Signed up",
    paying: "Now paying",
    earned: "Earned",
    unpaid: "Unpaid",
    /** The threshold, stated rather than discovered. */
    terms: "We send your earnings once they pass {minimum}. Referring yourself doesn't count.",
    /** The card's four states — see `ReferralCard`. */
    join: "Become a partner",
    underReview: "Your partner application is with us — we'll email you when it's reviewed.",
    notActive: "Your partner account isn't active. Open the partner portal for details.",
    dashboard: "Open the partner portal",
  },

  /** Words for the bars-or-line control, handed to `<Chart shape={a.chart}>`. */
  chart: {
    bar: "Bars",
    line: "Line",
    legend: "Chart shape",
  },

  /** The Stripe balance card on the Payments page. */
  payouts: {
    title: "Payouts",
    description:
      "What Stripe is holding for you and what's on its way to your bank. Sailo never touches it.",
    available: "Available",
    pending: "Pending",
    recent: "Recent payouts",
    noneYet:
      "No payouts yet — Stripe sends the first one a few days after your first card sale.",
    arrives: "Arrives {date}",
    requirementsTitle: "Stripe needs more information",
    requirementsBody:
      "Until it's provided, payouts can pause. It takes a few minutes on Stripe — the link below goes straight there.",
    pausedTitle: "Payouts are paused",
    pausedBody:
      "Stripe isn't sending money to your bank right now. Finish the steps on Stripe to resume.",
    finishOnStripe: "Finish on Stripe",
    unavailable:
      "Couldn't reach Stripe just now. Your balance is safe — try again in a moment.",
  },

  /** Read by bracket — `a.payoutStatus[payout.status]` — keys are Stripe's. */
  payoutStatus: {
    paid: "Paid",
    pending: "Pending",
    in_transit: "In transit",
    failed: "Failed",
    canceled: "Cancelled",
  },


  broadcasts: {
    title: "Broadcasts",
    compose: "New broadcast",
    composeBody: "Written in Markdown, sent with your shop's look.",
    reach: "{count} contacts have opted in to marketing email.",
    empty: "No broadcasts yet",
    emptyBody: "Tell your customers about a new drop, a sale, an event.",
    lockedBody: "Email the customers who opted in — with unsubscribe and bounce handling built in.",
    subject: "Subject",
    audience: "Audience",
    everyone: "Everyone who opted in",
    body: "Message",
    bodyHint: "Markdown: **bold**, *italic*, [links](https://…), - lists.",
    consentNote: "Only contacts who opted in receive this, and every message carries a working unsubscribe link. People who unsubscribe or bounce are never mailed again.",
    testSend: "Send a test to myself",
    duplicate: "Duplicate",

    // The preview line — the second-most-read words in any campaign.
    previewText: "Preview line",
    previewTextHint: "The sentence inboxes show after the subject. Blank repeats the subject.",

    // The editor
    write: "Write",
    preview: "Preview",
    toolbarBold: "Bold",
    toolbarItalic: "Italic",
    toolbarHeading: "Heading",
    toolbarLink: "Link",
    toolbarList: "List",
    toolbarQuote: "Quote",
    toolbarImage: "Image",
    toolbarDivider: "Divider",
    mergeTags: "Personalise",
    mergeFirstName: "First name",
    mergeName: "Full name",
    mergeShop: "Shop name",
    mergeCode: "Discount code",
    mergeHint: "{tag} becomes the contact's own — with a fallback when it's missing.",
    readTime: "About {seconds}s to read",
    emptyPreview: "Nothing written yet.",

    // The promotion
    promotion: "Promotion",
    promotionBody: "A code, the things it's for, and one button.",
    discountCode: "Discount code",
    noDiscount: "No code",
    noCoupons: "Create a code first and it'll appear here.",
    featured: "Featured products",
    featuredHint: "Up to {count}, shown as cards under your message.",
    addProduct: "Add a product",
    // No silent caps: a seller scrolling for a product that is not in the list
    // must be able to tell a missing product from a full one.
    onlyRecent: "Showing your {count} most recent products.",
    remove: "Remove",
    buttonLabel: "Button",
    buttonLabelPlaceholder: "Visit the shop",
    buttonUrl: "Button link",
    buttonUrlHint: "Blank points at your shop's front page.",

    // Scheduling
    schedule: "Schedule",
    scheduleFor: "Send at",
    scheduleHint: "In your shop's time zone ({zone}).",
    scheduledFor: "Scheduled for {when}",
    scheduleIt: "Schedule it",
    cancelSchedule: "Cancel schedule",
    sendNow: "Send now",

    // The audience builder
    matchAll: "Match all",
    matchAny: "Match any",
    addCondition: "Add a condition",
    add: "Add",
    groupWho: "Who they are",
    groupBought: "What they bought",
    groupDid: "What they've done",
    matches: "{count} of your contacts match",
    matchesOne: "{count} contact matches",
    noMatches: "Nobody matches yet — try a wider condition.",
    counting: "Counting…",
    deletedItem: "a deleted item",
    pickProduct: "Choose a product",
    pickCategory: "Choose a category",
    pickCoupon: "Choose a code",
    pickTag: "Choose a tag",
    pickSource: "Choose a source",
    pickKind: "Choose a type",
    countryHint: "Two-letter country code — GB, DE, AE.",
    days: "days",
    orders: "orders",

    // What each condition says once it's on the list
    ruleTag: "Tagged {value}",
    ruleNotTag: "Not tagged {value}",
    ruleSource: "Joined by {value}",
    ruleCountry: "In {value}",
    ruleProduct: "Bought {value}",
    ruleNotProduct: "Never bought {value}",
    ruleCategory: "Bought from {value}",
    ruleKind: "Bought a {value}",
    ruleCoupon: "Used code {value}",
    ruleAttended: "Turned up to {value}",
    ruleOrdered: "Has ordered",
    ruleNeverOrdered: "Never ordered",
    ruleMinOrders: "{n} orders or more",
    ruleMinSpend: "Spent {n} or more",
    ruleOrderedWithin: "Ordered in the last {n} days",
    ruleLapsed: "No order in {n} days",
    ruleAbandoned: "Left an unpaid order in {n} days",
    ruleJoinedWithin: "Joined in the last {n} days",
    ruleSubscribedWithin: "Subscribed in the last {n} days",

    sourceOrder: "an order",
    sourceSubscribe: "the signup form",
    sourceManual: "you, by hand",
    sourceImport: "an import",
    kindPhysical: "physical product",
    kindDigital: "download",
    kindService: "booking",
    kindEvent: "event ticket",
    kindMembership: "membership",

    // Where people join the list
    grow: "Growing your list",
    growBody: "A broadcast can only reach people who asked to hear from you. This is where they ask.",
    signupLink: "Your signup page",
    copyLink: "Copy link",
    copied: "Copied",
    showCard: "Show a signup box on my shop page",
    showCardBody: "Under your products, where somebody who browsed and didn't buy will see it.",
    incentive: "What they get for signing up",
    incentiveHint: "Shown on the form. Send the code itself in your first broadcast.",
    incentivePlaceholder: "10% off your first order",
    subscribers: "{count} joined from the signup form",
  },

  /** The members list, and the states a subscription passes through. */
  members: {
    title: "Members",
    description: "Everyone paying you on a recurring basis.",
    empty: "No members yet",
    emptyBody:
      "Add a product, set its type to Membership, and share it. Subscribers show up here.",
    lockedBody:
      "Sell memberships — a gym month, a club, a course — and let Stripe bill the card every month.",
    renews: "Renews",
    monthly: "{amount}/month",
    yearly: "{amount}/year",
    activeMembers: "Active members",
    monthlyRevenue: "Monthly",
    revenueHint: "Roughly what active memberships bill each month — a yearly one counts as a twelfth.",
    endsOn: "Ends {date}",
    cancelling: "Cancelling",
    cancel: "Cancel membership",
    noEmail: "No email on file",
    /* Which of the two cycles a member is on — a card that charges itself, or
       money the seller collects and confirms. */
    byCard: "Card",
    byHand: "You collect",
    awaitingPayment: "Waiting on payment",
  },

  memberStatus: {
    incomplete: "Not started",
    trialing: "Trial",
    active: "Active",
    past_due: "Payment failed",
    canceled: "Cancelled",
    unpaid: "Unpaid",
  },

  broadcastStatus: {
    draft: "Draft",
    scheduled: "Scheduled",
    queuing: "Preparing",
    sending: "Sending",
    sent: "Sent",
  },

  deliveryStatus: {
    sent: "Sent",
    queued: "Waiting",
    sending: "Unconfirmed",
    failed: "Failed",
    suppressed: "Opted out",
  },

  integrations: {
    title: "Integrations",
    body: "Connect your shop to Zapier, n8n, Make — or to an AI assistant.",
    upgrade: "Webhooks and the API are available on {plan}.",
    alsoTitle: "Also connected",
    alsoBody: "Analytics tags and your calendar feed live on the Details tab.",
    alsoLink: "Open Details",

    webhooksTitle: "Webhooks",
    webhooksBody:
      "We POST signed JSON to your address when something happens. Any tool that accepts a webhook — Zapier, n8n, Make — can receive it.",
    addEndpoint: "Add endpoint",
    urlLabel: "Endpoint URL",
    urlHint: "https:// on port 443. Paste the URL your tool gave you.",
    nameLabel: "Name",
    nameHint: "For you — “Zapier, new orders”.",
    eventsLabel: "Events",
    eventsHint: "Only ticked events are sent.",
    noEndpoints: "No endpoints yet.",
    endpointLimit: "{count} of {max} endpoints used.",
    active: "Active",
    disabled: "Switched off",
    disabledBecause: "Switched off after repeated failures: {reason}",
    lastAttempt: "Last attempt {when}",
    neverSent: "Nothing sent yet",
    sendTest: "Send test",
    rotate: "Rotate secret",
    remove: "Delete",
    save: "Save",

    secretTitle: "Signing secret",
    secretBody:
      "Copy this now — it is not shown again. Verify with any Standard Webhooks library.",
    tokenTitle: "Your API key",
    tokenBody: "Copy this now — it is not shown again.",
    copy: "Copy",
    copied: "Copied",

    logTitle: "Recent deliveries",
    logBody: "The last 20 attempts. Rows are kept for 30 days.",
    logEmpty: "Nothing delivered yet.",
    colEvent: "Event",
    colStatus: "Status",
    colWhen: "When",
    colResult: "Result",
    attemptCount: "Attempt {n}",

    keysTitle: "API keys",
    keysBody:
      "A key reads your orders, products and contacts over the REST API — and is what an AI assistant uses to reach your shop.",
    addKey: "Create key",
    keyNameLabel: "What is it for?",
    keyNameHint: "For you — “Zapier”, “my dashboard”.",
    scopeRead: "Read",
    scopeReadHint: "Orders, products and contacts. Always granted.",
    scopeWrite: "Write",
    scopeWriteHint: "Add contacts and change their tags.",
    noKeys: "No keys yet.",
    keyLimit: "{count} of {max} keys used.",
    revoke: "Revoke",
    lastUsed: "Last used {when}",
    neverUsed: "Never used",
    readable: "{count} contacts are readable with a key.",

    mcpTitle: "AI assistants",
    mcpBody:
      "Point Claude or any MCP client at this address and give it a key above. It can then read your shop and answer questions about it.",
    mcpUrlLabel: "MCP server URL",

    docsTitle: "How to connect",
    docsBody: "Endpoints, payload shapes and how to verify a signature.",
    docsLink: "Read the guide",
  },

} as const;

/** Every leaf widened to `string`, so translations aren't pinned to English. */
type Widen<T> = {
  [K in keyof T]: T[K] extends string ? string : Widen<T[K]>;
};

export type AdminDictionary = Widen<typeof adminEn>;

/** What a locale may supply: any subset, filled in from English. */
export type PartialAdminDictionary = {
  [K in keyof AdminDictionary]?: Partial<AdminDictionary[K]>;
};
