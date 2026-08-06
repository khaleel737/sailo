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
    shopHandlePlaceholder: "yourshop",
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
    price: "Price",
    product: "Product",
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
    serviceHint:
      "Services skip delivery. Add a duration and let buyers pick a time below.",
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
    inStock: "In stock",
    inStockBody: "Turn off to show a Sold out badge and disable ordering.",
    featured: "Featured",
    featuredBody: "Pins this product to the top of your shop.",
    published: "Published",
    publishedBody: "Uncheck to hide it from your shop while you work on it.",
    added: "Product added.",
    updated: "Product updated.",
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
  },

  clients: {
    outstandingLabel: "Outstanding",
    saveNotesLabel: "Save notes",
    noOrdersYet: "No orders yet.",
    paid: "Paid",
    delete: "Delete",
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
    lockBody:
      "Run promotions with percentage or fixed discounts, minimum spend, usage caps and expiry dates.",
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
    buttonText: "Button text",
    buttonTextHint: "defaults to \"{name}\"",
    showOnShop: "Show on my shop",
    fillInFirst: "Fill in the details above before turning this on.",
    cardTitle: "Card payments",
    cardBody: "Buyers pay by card, Apple Pay or Google Pay without leaving the checkout. The money goes straight into your own Stripe account — Sailo never holds it, and keeps 1% of the goods on each card sale.",
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
  },

  settings: {
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
    taxId: "Tax ID",
    taxIdHint: "optional — printed on invoices",
    shopIsLive: "Shop is live",
    shopIsLiveBody: "Turn this off to take your page offline. Visitors will see a 404.",
    title: "Settings",
    description: "Your shop details, plan and data.",
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
