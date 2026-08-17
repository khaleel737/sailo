/**
 * Seeds a public demo shop at /demo so the template can be viewed with real
 * content. Idempotent — re-running wipes and recreates the demo data only.
 *
 *   npm run db:seed
 */
import { neon } from "@neondatabase/serverless";
import { firstRow, present } from "@sailo/core/invariant";
import { drizzle } from "drizzle-orm/neon-http";
import { eq } from "drizzle-orm";
import { hashPassword } from "better-auth/crypto";
import * as schema from "@sailo/db/schema";
import { slugify } from "@sailo/core/slug";
import { computeTotals } from "@sailo/core/pricing";

const {
  account,
  affiliates,
  categories,
  clients,
  coupons,
  deliveryMethods,
  invoices,
  orders,
  orderItems,
  paymentMethods,
  productFiles,
  productImages,
  products,
  productVariants,
  reviews,
  shops,
  user,
  visits,
} = schema;

const DEMO_EMAIL = "demo@sailo.store";
const DEMO_PASSWORD = "demo12345";
const DEMO_HANDLE = "demo";

/**
 * Product photography, hosted by Unsplash and requested at the size we render.
 * Ids rather than random seeds: this shop is one of the five the landing page
 * shows off, and a "speckled mug" illustrated by a photo of a car park reads
 * as a broken product, not a placeholder.
 */
const img = (id: string, size = 900) =>
  `https://images.unsplash.com/${id}?w=${size}&h=${size}&fit=crop&q=80`;

const CATEGORIES = [
  { name: "Mugs", slug: "mugs" },
  { name: "Bowls & plates", slug: "bowls-plates" },
  { name: "Prints", slug: "prints" },
  { name: "Workshops", slug: "workshops" },
];

type SeedProduct = {
  title: string;
  category: string;
  kind: string;
  priceCents: number;
  compareAtCents?: number;
  description: string;
  tags: string[];
  images: string[];
  featured?: boolean;
  inStock?: boolean;

  options?: { name: string; values: string[] }[];
  variants?: {
    options: Record<string, string>;
    priceCents?: number;
    stock?: number;
    sku?: string;
    available?: boolean;
    /** This combination's own photo — the charcoal apron, not the apron. */
    image?: string;
  }[];
  trackInventory?: boolean;
  stockQuantity?: number;

  files?: { name: string; url: string; sizeBytes?: number; contentType?: string }[];
  releaseOnPayment?: boolean;
  downloadLimit?: number;
  downloadExpiryDays?: number;

  durationMinutes?: number;
  serviceMode?: string;
  serviceLocation?: string;
  bookingEnabled?: boolean;
  bookingLeadHours?: number;
};

const PRODUCTS: SeedProduct[] = [
  {
    title: "Speckled stoneware mug",
    category: "mugs",
    kind: "physical",
    priceCents: 2400,
    compareAtCents: 3200,
    description:
      "Wheel-thrown and glazed in matte oatmeal with a raw clay foot. Dishwasher and microwave safe.",
    tags: ["handmade", "ceramic", "gift"],
    images: ["photo-1514228742587-6b1558fcca3d", "photo-1544787219-7f47ccb76574"],
    featured: true,
    // One axis, priced per size — the shape most sellers start with.
    options: [{ name: "Size", values: ["250ml", "350ml", "450ml"] }],
    trackInventory: true,
    variants: [
      { options: { Size: "250ml" }, priceCents: 2200, stock: 14, sku: "MUG-250" },
      { options: { Size: "350ml" }, stock: 9, sku: "MUG-350" },
      { options: { Size: "450ml" }, priceCents: 2800, stock: 3, sku: "MUG-450" },
    ],
  },
  {
    title: "Cobalt dip mug",
    category: "mugs",
    kind: "physical",
    priceCents: 2600,
    description:
      "Half-dipped in a deep cobalt glaze that pools at the base. Every one comes out slightly different.",
    tags: ["handmade", "ceramic", "blue"],
    images: ["photo-1610632380989-680fe40816c6", "photo-1567016376408-0226e4d0c1ea"],
  },
  {
    title: "Wide breakfast bowl",
    category: "bowls-plates",
    kind: "physical",
    priceCents: 3800,
    description:
      "A generous 18cm bowl for porridge, ramen or a very large salad. Sold individually.",
    tags: ["handmade", "ceramic", "kitchen"],
    images: ["photo-1610701596007-11502861dcfa", "photo-1565193566173-7a0ee3dbe261"],
    // Counted on the product itself, since there's nothing to choose between.
    trackInventory: true,
    stockQuantity: 6,
  },
  {
    title: "Side plate — set of 2",
    category: "bowls-plates",
    kind: "physical",
    priceCents: 5200,
    description: "Two 20cm plates with a soft rolled edge. Stacks neatly.",
    tags: ["handmade", "set"],
    images: ["photo-1578500494198-246f612d3b3d"],
    inStock: false,
  },
  {
    title: "Kiln Notes — risograph print",
    category: "prints",
    kind: "physical",
    priceCents: 3500,
    description:
      "A2 two-colour risograph on 120gsm recycled stock. Signed, edition of 50.",
    tags: ["print", "art", "limited"],
    images: ["photo-1544967082-d9d25d867d66", "photo-1513519245088-0e12902e5a38"],
  },
  {
    title: "Glaze recipe pack (PDF)",
    category: "prints",
    kind: "digital",
    priceCents: 1200,
    description:
      "Twelve tested cone-6 glaze recipes with photos of each on white and dark clay bodies.",
    tags: ["digital", "download", "glaze"],
    images: ["photo-1490312278390-ab64016e0aa9"],
    files: [
      {
        name: "Cone 6 glaze recipes.pdf",
        url: "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf",
        sizeBytes: 13_264,
        contentType: "application/pdf",
      },
    ],
    releaseOnPayment: true,
    downloadLimit: 5,
    downloadExpiryDays: 60,
  },
  {
    title: "Beginner wheel throwing — 3 hours",
    category: "workshops",
    kind: "service",
    priceCents: 8500,
    description:
      "Small group class, maximum six people. Clay, tools, firing and a coffee included. You take home two pieces.",
    tags: ["workshop", "class", "in-person"],
    images: ["photo-1493106641515-6b5631de4bb9", "photo-1554941829-202a0b2403b8"],
    featured: true,
    durationMinutes: 180,
    serviceMode: "in_person",
    serviceLocation:
      "Unit 4, Kiln Yard, 22 Bridge Street — ring the bell on the blue door.",
    bookingEnabled: true,
    bookingLeadHours: 48,
    // Two people can book the same slot at different lengths.
    options: [{ name: "Seats", values: ["One seat", "Two seats"] }],
    variants: [
      { options: { Seats: "One seat" } },
      { options: { Seats: "Two seats" }, priceCents: 16000 },
    ],
  },
  {
    title: "Private studio session",
    category: "workshops",
    kind: "service",
    priceCents: 16000,
    description:
      "Two hours one-to-one on the wheel, shaped around whatever you want to make. Weekdays only.",
    tags: ["workshop", "private"],
    images: ["photo-1517686469429-8bdb88b9f907"],
    durationMinutes: 120,
    serviceMode: "in_person",
    serviceLocation: "Unit 4, Kiln Yard, 22 Bridge Street.",
    bookingEnabled: true,
    bookingLeadHours: 24,
  },
  // Kept last so the review and order fixtures below keep their indices.
  {
    title: "Studio apron",
    category: "bowls-plates",
    kind: "physical",
    priceCents: 4200,
    description:
      "Heavy cotton canvas with a split leg and a deep tool pocket. Softens with every wash.",
    tags: ["apron", "studio", "cotton"],
    images: ["photo-1618354691373-d851c5c3a990", "photo-1620799140408-edc6dcb6d633"],
    // Two axes: every size in every colour, counted separately. The charcoal
    // ones carry their own photo, which is what the gallery follows when a
    // buyer picks the colour.
    options: [
      { name: "Size", values: ["S", "M", "L"] },
      { name: "Colour", values: ["Natural", "Charcoal"] },
    ],
    trackInventory: true,
    variants: [
      { options: { Size: "S", Colour: "Natural" }, stock: 4, sku: "APR-S-NAT" },
      {
        options: { Size: "S", Colour: "Charcoal" },
        stock: 2,
        sku: "APR-S-CHR",
        image: "photo-1503341504253-dff4815485f1",
      },
      { options: { Size: "M", Colour: "Natural" }, stock: 7, sku: "APR-M-NAT" },
      {
        options: { Size: "M", Colour: "Charcoal" },
        stock: 5,
        sku: "APR-M-CHR",
        image: "photo-1503341504253-dff4815485f1",
      },
      // Sold out in one combination only — the picker greys it out.
      { options: { Size: "L", Colour: "Natural" }, stock: 0, sku: "APR-L-NAT" },
      {
        options: { Size: "L", Colour: "Charcoal" },
        stock: 3,
        sku: "APR-L-CHR",
        priceCents: 4500,
        image: "photo-1503341504253-dff4815485f1",
      },
    ],
  },
  {
    title: "Studio glaze log — printable",
    category: "prints",
    kind: "digital",
    priceCents: 0,
    description:
      "The sheet we use to record every test tile: recipe, cone, clay body, result. Free, no strings.",
    tags: ["digital", "free", "template"],
    images: ["photo-1584589167171-541ce45f1eea"],
    files: [
      {
        name: "Glaze log.pdf",
        url: "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf",
        sizeBytes: 13_264,
        contentType: "application/pdf",
      },
    ],
    // Nothing to wait for on a free download, so it unlocks on the spot.
    releaseOnPayment: false,
  },
  {
    title: "Kiln Notes — digital bundle",
    category: "prints",
    kind: "digital",
    priceCents: 1800,
    description:
      "The full risograph series as high-resolution files, ready to print at home or at a studio.",
    tags: ["digital", "download", "art"],
    images: ["photo-1547891654-e66ed7ebb968", "photo-1567016376408-0226e4d0c1ea"],
    // A download can have options too — same files, different licence.
    options: [{ name: "Licence", values: ["Personal", "Commercial"] }],
    variants: [
      { options: { Licence: "Personal" }, sku: "KN-PERS" },
      { options: { Licence: "Commercial" }, priceCents: 5400, sku: "KN-COMM" },
    ],
    files: [
      {
        name: "Kiln Notes — print files.pdf",
        url: "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf",
        sizeBytes: 13_264,
        contentType: "application/pdf",
      },
    ],
    releaseOnPayment: true,
    downloadLimit: 3,
    downloadExpiryDays: 30,
  },
  {
    title: "Glaze troubleshooting call",
    category: "workshops",
    kind: "service",
    priceCents: 4500,
    description:
      "Forty-five minutes on a video call. Send photos of what went wrong beforehand and we'll work through it.",
    tags: ["service", "online", "advice"],
    images: ["photo-1590650153855-d9e808231d41"],
    durationMinutes: 45,
    // The other services happen in the studio; this one happens on a link.
    serviceMode: "online",
    serviceLocation:
      "We'll email you a video link once the time is confirmed. No app needed.",
    bookingEnabled: true,
    bookingLeadHours: 12,
  },
];

const REVIEWS = [
  { product: 0, name: "Tomi A.", rating: 5, body: "Exactly like the photos. The glaze feels lovely to hold — I've bought three more since." },
  { product: 0, name: "Hannah", rating: 4, body: "Beautiful mug, slightly smaller than I expected but I use it every morning." },
  { product: 0, name: "Ren", rating: 5, body: "Packed really carefully and arrived fast." },
  { product: 2, name: "Yasmin", rating: 5, body: "The bowl is the perfect size for ramen. Worth it." },
  { product: 4, name: "Dan K.", rating: 5, body: "Colours are so much richer in person. Framed it immediately." },
  { product: 6, name: "Priya", rating: 5, body: "Best three hours I've spent in ages. Genuinely patient teaching." },
  { product: 6, name: "Marcus", rating: 4, body: "Great class. Would've liked a bit longer on the wheel." },
];

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const db = drizzle(neon(url), { schema });

  console.log("Clearing existing demo data…");
  const existingShop = await db.query.shops.findFirst({
    where: eq(shops.handle, DEMO_HANDLE),
  });
  if (existingShop) {
    // Cascades take care of products, images, reviews, orders and visits.
    await db.delete(shops).where(eq(shops.id, existingShop.id));
  }
  const existingUser = await db.query.user.findFirst({
    where: eq(user.email, DEMO_EMAIL),
  });
  if (existingUser) {
    await db.delete(user).where(eq(user.id, existingUser.id));
  }

  console.log("Creating demo user…");
  const userId = crypto.randomUUID();
  const now = new Date();
  await db.insert(user).values({
    id: userId,
    name: "Amina Yusuf",
    email: DEMO_EMAIL,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(account).values({
    id: crypto.randomUUID(),
    accountId: userId,
    providerId: "credential",
    userId,
    password: await hashPassword(DEMO_PASSWORD),
    createdAt: now,
    updatedAt: now,
  });

  console.log("Creating demo shop…");
  const shop = firstRow(await db
    .insert(shops)
    .values({
      userId,
      handle: DEMO_HANDLE,
      name: "Clay & Co.",
      description:
        "Small-batch stoneware, thrown by hand in Portland. Restocks every other Friday.",
      avatarUrl: img("photo-1514228742587-6b1558fcca3d", 400),
      accentColor: "#b45309",
      theme: "light",
      layout: "grid",
      currency: "USD",
      collectAddress: true,
      // The demo showcases the whole product, so it sits on the top plan —
      // otherwise the seeded coupons and affiliates would be unreachable.
      plan: "business",
      subscriptionStatus: "active",
      affiliatesEnabled: true,
      affiliateDefaultBp: 1000, // 10%
      affiliatePublicSignup: true,
      affiliateTerms:
        "Commission is paid monthly by bank transfer once your balance reaches $50. Self-referrals don't count.",
      invoicePrefix: "CLAY",
      invoiceNotes: "Thanks for supporting a small studio. Handmade in Portland.",
      taxId: "US-93-1234567",
      contactEmail: "hello@clayandco.example",
      location: "Portland, Oregon",
      socials: [
        { platform: "instagram", url: "https://instagram.com/clayandco" },
        { platform: "tiktok", url: "https://tiktok.com/@clayandco" },
        { platform: "website", url: "https://clayandco.example" },
      ],
      isPublished: true,
    })
    .returning(), "shop");

  console.log("Creating categories…");
  const insertedCategories = await db
    .insert(categories)
    .values(
      CATEGORIES.map((c, i) => ({
        shopId: shop.id,
        name: c.name,
        slug: c.slug,
        position: i,
      })),
    )
    .returning();
  const categoryBySlug = new Map(insertedCategories.map((c) => [c.slug, c.id]));

  console.log("Creating products…");
  const productIds: string[] = [];
  for (const [i, p] of PRODUCTS.entries()) {
    const created = firstRow(await db
      .insert(products)
      .values({
        shopId: shop.id,
        categoryId: categoryBySlug.get(p.category) ?? null,
        title: p.title,
        slug: slugify(p.title),
        description: p.description,
        priceCents: p.priceCents,
        compareAtCents: p.compareAtCents ?? null,
        kind: p.kind,
        tags: p.tags,
        options: p.options ?? [],
        trackInventory: p.trackInventory ?? false,
        stockQuantity: p.stockQuantity ?? null,
        releaseOnPayment: p.releaseOnPayment ?? true,
        downloadLimit: p.downloadLimit ?? null,
        downloadExpiryDays: p.downloadExpiryDays ?? null,
        durationMinutes: p.durationMinutes ?? null,
        serviceMode: p.serviceMode ?? "in_person",
        serviceLocation: p.serviceLocation ?? null,
        bookingEnabled: p.bookingEnabled ?? false,
        bookingLeadHours: p.bookingLeadHours ?? 24,
        inStock: p.inStock ?? true,
        isFeatured: p.featured ?? false,
        isPublished: true,
        position: i,
      })
      .returning(), "created");

    productIds.push(created.id);
    await db.insert(productImages).values(
      p.images.map((seed, index) => ({
        productId: created.id,
        url: img(seed),
        alt: p.title,
        position: index,
      })),
    );

    if (p.variants?.length) {
      await db.insert(productVariants).values(
        p.variants.map((v, index) => ({
          productId: created.id,
          options: v.options,
          sku: v.sku ?? null,
          // A blank price inherits the product's, which is the point.
          priceCents: v.priceCents ?? null,
          stockQuantity: p.trackInventory ? (v.stock ?? null) : null,
          isAvailable: v.available ?? true,
          imageUrl: v.image ? img(v.image) : null,
          position: index,
        })),
      );
    }

    if (p.files?.length) {
      await db.insert(productFiles).values(
        p.files.map((f, index) => ({
          productId: created.id,
          name: f.name,
          url: f.url,
          sizeBytes: f.sizeBytes ?? null,
          contentType: f.contentType ?? null,
          position: index,
        })),
      );
    }
  }

  console.log("Creating reviews…");
  await db.insert(reviews).values(
    REVIEWS.map((r, i) => ({
      shopId: shop.id,
      productId: present(productIds[r.product], `product ${r.product}`),
      authorName: r.name,
      rating: r.rating,
      body: r.body,
      // Leave the last one pending so the moderation queue isn't empty.
      isApproved: i < REVIEWS.length - 1,
      createdAt: daysAgo(i * 3 + 1),
    })),
  );

  console.log("Creating payment methods…");
  await db.insert(paymentMethods).values([
    {
      shopId: shop.id,
      type: "whatsapp",
      config: { phone: "12025550147" },
      isEnabled: true,
      position: 1,
    },
    {
      shopId: shop.id,
      type: "telegram",
      config: { username: "clayandco" },
      isEnabled: true,
      position: 2,
    },
    {
      shopId: shop.id,
      type: "instagram",
      config: { username: "clayandco" },
      isEnabled: true,
      position: 3,
    },
    {
      shopId: shop.id,
      type: "bank_transfer",
      config: {
        bankName: "Guaranty Trust Bank",
        accountName: "Clay & Co. Ltd",
        accountNumber: "0123456789",
        iban: "NG29 GTBK 6016 1331 9268 19",
        swift: "GTBINGLA",
        instructions:
          "Use your name as the transfer reference so we can match your order.",
      },
      isEnabled: true,
      position: 4,
    },
    {
      shopId: shop.id,
      type: "cod",
      config: {
        instructions:
          "We deliver within Portland in 2–3 working days. Please have the exact amount ready.",
      },
      isEnabled: true,
      position: 5,
    },
    // Configured but switched off, so the admin shows an "Off" state too.
    {
      shopId: shop.id,
      type: "email",
      config: { address: "orders@clayandco.example" },
      isEnabled: false,
      position: 6,
    },
  ]);

  console.log("Creating delivery options…");
  const insertedDelivery = await db
    .insert(deliveryMethods)
    .values([
      {
        shopId: shop.id,
        type: "shipping",
        name: "Standard delivery",
        feeCents: 800,
        freeOverCents: 7500,
        config: {
          estimate: "2–4 working days",
          instructions: "Wrapped in straw and recycled paper.",
        },
        isEnabled: true,
        position: 1,
      },
      {
        shopId: shop.id,
        type: "shipping",
        name: "Express delivery",
        feeCents: 1800,
        config: {
          estimate: "Next working day if ordered before 11am",
          instructions: "Tracked and signed for.",
        },
        isEnabled: true,
        position: 2,
      },
      {
        shopId: shop.id,
        type: "shipping",
        name: "International",
        feeCents: 3500,
        config: { estimate: "7–14 working days" },
        isEnabled: true,
        position: 3,
      },
      {
        shopId: shop.id,
        type: "collection",
        name: "Studio pickup",
        feeCents: 0,
        config: {
          address: "412 NE Alberta Street, Portland",
          hours: "Tue–Sat, 10am–5pm",
          instructions: "Ring the bell at the blue side door.",
        },
        isEnabled: true,
        position: 4,
      },
    ])
    .returning();
  const deliveryByName = new Map(insertedDelivery.map((d) => [d.name, d]));

  console.log("Creating coupons…");
  await db.insert(coupons).values([
    {
      shopId: shop.id,
      code: "WELCOME10",
      discountType: "percent",
      discountValue: 1000, // 10%
      isActive: true,
    },
    {
      shopId: shop.id,
      code: "FIVEOFF",
      discountType: "fixed",
      discountValue: 500, // $5
      minSubtotalCents: 3000,
      maxRedemptions: 100,
      timesRedeemed: 3,
      isActive: true,
    },
    {
      shopId: shop.id,
      code: "KILNSALE",
      discountType: "percent",
      discountValue: 2500, // 25%
      expiresAt: daysAgo(5),
      isActive: true,
    },
  ]);

  console.log("Creating affiliates…");
  const insertedAffiliates = await db
    .insert(affiliates)
    .values([
      {
        shopId: shop.id,
        name: "Amara Okafor",
        email: "amara@example.com",
        code: "AMARA",
        commissionBp: 1500, // 15% — beats the shop default
        status: "active",
        source: "manual",
        clicks: 47,
        payoutNotes: "GTB 0123456789",
      },
      {
        shopId: shop.id,
        name: "Studio Pottery Weekly",
        email: "hello@potteryweekly.example",
        code: "POTTERYWEEKLY",
        status: "active",
        source: "signup",
        clicks: 128,
      },
      {
        shopId: shop.id,
        name: "Lola Fashola",
        email: "lola@example.com",
        code: "LOLA",
        status: "pending",
        source: "signup",
        clicks: 4,
      },
    ])
    .returning();
  const affiliateByCode = new Map(insertedAffiliates.map((a) => [a.code, a]));

  console.log("Creating clients…");
  const CLIENTS = [
    {
      name: "Tomi Adeyemi",
      email: "tomi@example.com",
      phone: "15035550142",
      addressLine1: "1412 NE Alberta Street",
      addressLine2: "Flat 3B",
      city: "Portland",
      region: "OR",
      postalCode: "97211",
      country: "United States",
    },
    {
      name: "Priya Nair",
      email: "priya@example.com",
      phone: "447700900142",
      addressLine1: "22 Bramley Road",
      city: "London",
      region: "Greater London",
      postalCode: "W10 6SZ",
      country: "United Kingdom",
    },
    {
      name: "Dan Kowalski",
      email: "dan@example.com",
      phone: "14155550123",
      addressLine1: "1104 W Belmont Ave",
      city: "Chicago",
      region: "IL",
      postalCode: "60657",
      country: "United States",
    },
    {
      name: "Yasmin Haddad",
      email: "yasmin@example.com",
      phone: "4915112345678",
      addressLine1: "9 Oranienstraße",
      city: "Berlin",
      postalCode: "10999",
      country: "Germany",
      notes: "Asks about shipping to Berlin — quoted $18 flat.",
    },
    {
      name: "Chris B.",
      email: "chris@example.com",
      phone: null,
      country: "United Kingdom",
    },
  ];

  const insertedClients = await db
    .insert(clients)
    .values(CLIENTS.map((c) => ({ ...c, shopId: shop.id })))
    .returning();
  const clientByEmail = new Map(insertedClients.map((c) => [c.email, c]));

  console.log("Creating orders…");
  const ORDERS = [
    { p: 0, email: "tomi@example.com", qty: 2, method: "whatsapp", delivery: "Standard delivery", coupon: null, affiliate: null, status: "completed", payment: "paid", note: "Can you wrap them separately? They're gifts.", ref: null, tracking: { carrier: "DHL", number: "JD0002890124", url: "https://www.dhl.com/track?id=JD0002890124" }, refund: 0 },
    { p: 6, email: "priya@example.com", qty: 1, method: "bank_transfer", delivery: null, coupon: null, affiliate: null, status: "completed", payment: "paid", note: null, ref: "TRF-88213", tracking: null, refund: 0 },
    { p: 4, email: "dan@example.com", qty: 1, method: "telegram", delivery: "Express delivery", coupon: null, affiliate: "AMARA", status: "shipped", payment: "paid", note: null, ref: null, tracking: { carrier: "Royal Mail", number: "RM88213771GB", url: "https://www.royalmail.com/track-your-item#/RM88213771GB" }, refund: 0 },
    { p: 2, email: "yasmin@example.com", qty: 3, method: "bank_transfer", delivery: "International", coupon: "WELCOME10", affiliate: null, status: "new", payment: "pending", note: "Do you ship to Berlin?", ref: "TRF-91007", tracking: null, refund: 0 },
    { p: 0, email: "tomi@example.com", qty: 1, method: "cod", delivery: "Studio pickup", coupon: null, affiliate: null, status: "new", payment: "unpaid", note: null, ref: null, tracking: null, refund: 0 },
    // A refunded order, so the dashboard shows revenue net of one.
    { p: 5, email: "chris@example.com", qty: 1, method: "instagram", delivery: null, coupon: null, affiliate: "POTTERYWEEKLY", status: "refunded", payment: "refunded", note: null, ref: null, tracking: null, refund: 1200 },
  ];

  const seededCoupons = await db.query.coupons.findMany({
    where: eq(coupons.shopId, shop.id),
  });
  const couponByCode = new Map(seededCoupons.map((c) => [c.code, c]));

  const insertedOrders = await db
    .insert(orders)
    .values(
      ORDERS.map((o, i) => {
        const client = present(clientByEmail.get(o.email), `client ${o.email}`);
        const product = present(PRODUCTS[o.p], `product ${o.p}`);
        const delivery = o.delivery
          ? present(deliveryByName.get(o.delivery), `delivery ${o.delivery}`)
          : null;
        const affiliate = o.affiliate
          ? affiliateByCode.get(o.affiliate)
          : undefined;

        // Reuse the app's own maths so seeded totals can't drift from real ones.
        const totals = computeTotals({
          subtotalCents: product.priceCents * o.qty,
          coupon: o.coupon ? couponByCode.get(o.coupon) : null,
          deliveryMethod: delivery,
          commissionBp: affiliate
            ? (affiliate.commissionBp ?? shop.affiliateDefaultBp)
            : null,
        });

        const shipping = delivery?.type === "shipping";
        return {
          shopId: shop.id,
          productId: productIds[o.p],
          clientId: client.id,
          productTitle: product.title,
          productKind: product.kind,
          unitPriceCents: product.priceCents,
          quantity: o.qty,
          itemCount: 1,
          currency: "USD",

          subtotalCents: totals.subtotalCents,
          discountCents: totals.discountCents,
          deliveryFeeCents: totals.deliveryFeeCents,
          totalCents: totals.totalCents,

          deliveryMethodId: delivery?.id ?? null,
          deliveryMethod: delivery?.type ?? null,
          deliveryLabel: delivery?.name ?? null,
          pickupLocation:
            delivery?.type === "collection"
              ? (delivery.config.address ?? null)
              : null,

          trackingCarrier: o.tracking?.carrier ?? null,
          trackingNumber: o.tracking?.number ?? null,
          trackingUrl: o.tracking?.url ?? null,
          shippedAt: o.tracking ? daysAgo(i * 2 - 1) : null,

          refundedCents: o.refund,
          refundedAt: o.refund > 0 ? daysAgo(i * 2 - 1) : null,
          refundReason: o.refund > 0 ? "Buyer changed their mind." : null,

          couponId: o.coupon ? (couponByCode.get(o.coupon)?.id ?? null) : null,
          couponCode: o.coupon,

          affiliateId: affiliate?.id ?? null,
          affiliateCode: affiliate?.code ?? null,
          commissionCents: totals.commissionCents,
          commissionPaid: o.status === "fulfilled",

          customerName: client.name,
          customerEmail: client.email,
          customerPhone: client.phone,
          // Collection orders don't capture a delivery address.
          addressLine1: shipping ? client.addressLine1 : null,
          addressLine2: shipping ? client.addressLine2 : null,
          city: shipping ? client.city : null,
          region: shipping ? client.region : null,
          postalCode: shipping ? client.postalCode : null,
          country: shipping ? client.country : null,

          note: o.note,
          paymentMethod: o.method,
          paymentStatus: o.payment,
          paymentReference: o.ref,
          status: o.status,
          createdAt: daysAgo(i * 2),
        };
      }),
    )
    .returning({ id: orders.id });

  // Every order carries its lines, the same as one placed for real.
  console.log("Creating order items…");
  await db.insert(orderItems).values(
    insertedOrders.map((row, i) => {
      const o = present(ORDERS[i], "ORDERS[i]");
      const product = present(PRODUCTS[o.p], `product ${o.p}`);
      return {
        orderId: row.id,
        productId: productIds[o.p],
        title: product.title,
        kind: product.kind,
        unitPriceCents: product.priceCents,
        quantity: o.qty,
        subtotalCents: product.priceCents * o.qty,
        position: 0,
      };
    }),
  );

  console.log("Creating invoices…");
  await db.insert(invoices).values(
    insertedOrders.map((o, i) => ({
      shopId: shop.id,
      orderId: o.id,
      number: `CLAY-${String(i + 1).padStart(4, "0")}`,
      token: `seedtoken${String(i + 1).padStart(4, "0")}${shop.id.slice(0, 8)}`,
      issuedAt: daysAgo(i * 2),
    })),
  );
  await db
    .update(shops)
    .set({ invoiceNextNumber: insertedOrders.length + 1 })
    .where(eq(shops.id, shop.id));

  console.log("Creating visit history…");
  const visitRows: (typeof visits.$inferInsert)[] = [];
  const REFERRERS = [
    "https://instagram.com/",
    "https://tiktok.com/",
    "https://t.co/",
    null,
  ];
  for (let day = 13; day >= 0; day--) {
    // Deterministic wave so the chart has a believable shape.
    const count = 6 + Math.round(10 * Math.abs(Math.sin(day * 1.1))) + (day % 4);
    for (let n = 0; n < count; n++) {
      visitRows.push({
        shopId: shop.id,
        productId:
          n % 3 === 0 ? productIds[(day + n) % productIds.length] : null,
        sessionId: `seed-${day}-${Math.floor(n / 2)}`,
        referrer: REFERRERS[(day + n) % REFERRERS.length],
        country: ["NG", "US", "GB", "AE"][(day + n) % 4],
        createdAt: daysAgo(day, n),
      });
    }
  }
  await db.insert(visits).values(visitRows);

  console.log(`
✓ Demo shop seeded

  Shop      /${DEMO_HANDLE}
  Login     ${DEMO_EMAIL}
  Password  ${DEMO_PASSWORD}

  ${PRODUCTS.length} products · ${REVIEWS.length} reviews · ${CLIENTS.length} clients
  ${ORDERS.length} orders + invoices · ${visitRows.length} visits
  5 payment rails · ${insertedDelivery.length} delivery options · 3 coupons · 3 affiliates
`);
}

function daysAgo(days: number, extraMinutes = 0) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(9 + (extraMinutes % 12), (extraMinutes * 7) % 60, 0, 0);
  return d;
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
