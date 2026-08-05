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

  dashboard: {
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
    title: "Categories",
    description: "These become the filter chips at the top of your shop.",
    empty: "No categories yet",
    emptyBody:
      "Categories are optional — add a few once you have enough products to group.",
    namePlaceholder: "Mugs, Prints, Consulting…",
    nameLabel: "Category name",
  },

  orders: {
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
    title: "Clients",
    empty: "No clients yet",
    emptyBody:
      "Buyers appear here once they place their first order and leave an email or phone number.",
    all: "All clients",
    contact: "Contact",
    noDetails: "No details captured.",
    notes: "Private notes",
    saveNotes: "Save notes",
    noOrders: "No orders yet.",
    lifetimeValue: "Lifetime value",
    outstanding: "Outstanding",
    notesPlaceholder:
      "Prefers pickup. Allergic to nickel. Repeat wholesale buyer…",
  },

  reviews: {
    title: "Reviews",
    empty: "No reviews yet",
    emptyBody: "Buyers can leave a review on any product page.",
    approveReview: "Approve review",
    deleteReview: "Delete review",
  },

  coupons: {
    title: "Coupons",
    description: "Discount codes buyers enter at checkout.",
    lockTitle: "Discount codes",
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
    title: "Affiliates",
    description: "Pay people a share of what they sell for you.",
    lockTitle: "Referral programme",
    empty: "No affiliates yet",
    emptyBody: "Add someone above, or let buyers opt in after they order.",
    offHint: "Turn the programme on above to add affiliates and share links.",
    markPaid: "Mark paid",
    runProgramme: "Run a referral programme",
    publicSignup: "Let anyone apply",
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
    title: "Payments",
    description:
      "Turn on as many ways to order as you like. Buyers pick one at checkout.",
    nobodyCanOrder: "Nobody can order yet",
    payOnline: "Pay online",
    chatHandoff: "Chat handoff",
    manual: "Manual payment",
  },

  delivery: {
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
    freeOver: "Free over",
    physicalOnly:
      "Only physical products ask about delivery — digital downloads and services skip it. Collection options never ask the buyer for an address.",
  },

  settings: {
    title: "Settings",
    description: "Your shop details, plan and data.",
  },

  billing: {
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
