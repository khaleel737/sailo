/**
 * Seeds a public demo shop at /demo so the template can be viewed with real
 * content. Idempotent — re-running wipes and recreates the demo data only.
 *
 *   npm run db:seed
 */
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq } from "drizzle-orm";
import { hashPassword } from "better-auth/crypto";
import * as schema from "../src/db/schema";
import { slugify } from "../src/lib/utils";
import { computeTotals } from "../src/lib/pricing";

const {
  account,
  affiliates,
  categories,
  clients,
  coupons,
  deliveryMethods,
  invoices,
  orders,
  paymentMethods,
  productImages,
  products,
  reviews,
  shops,
  user,
  visits,
} = schema;

const DEMO_EMAIL = "demo@shopik.app";
const DEMO_PASSWORD = "demo12345";
const DEMO_HANDLE = "demo";

const img = (seed: string) => `https://picsum.photos/seed/${seed}/900/900`;

const CATEGORIES = [
  { name: "Mugs", slug: "mugs" },
  { name: "Bowls & plates", slug: "bowls-plates" },
  { name: "Prints", slug: "prints" },
  { name: "Workshops", slug: "workshops" },
];

const PRODUCTS = [
  {
    title: "Speckled stoneware mug",
    category: "mugs",
    kind: "physical",
    priceCents: 2400,
    compareAtCents: 3200,
    description:
      "Wheel-thrown and glazed in matte oatmeal with a raw clay foot. Holds 350ml. Dishwasher and microwave safe.",
    tags: ["handmade", "ceramic", "gift"],
    images: ["mug-a", "mug-a2", "mug-a3"],
    featured: true,
  },
  {
    title: "Cobalt dip mug",
    category: "mugs",
    kind: "physical",
    priceCents: 2600,
    description:
      "Half-dipped in a deep cobalt glaze that pools at the base. Every one comes out slightly different.",
    tags: ["handmade", "ceramic", "blue"],
    images: ["mug-b", "mug-b2"],
  },
  {
    title: "Wide breakfast bowl",
    category: "bowls-plates",
    kind: "physical",
    priceCents: 3800,
    description:
      "A generous 18cm bowl for porridge, ramen or a very large salad. Sold individually.",
    tags: ["handmade", "ceramic", "kitchen"],
    images: ["bowl-a", "bowl-a2"],
  },
  {
    title: "Side plate — set of 2",
    category: "bowls-plates",
    kind: "physical",
    priceCents: 5200,
    description: "Two 20cm plates with a soft rolled edge. Stacks neatly.",
    tags: ["handmade", "set"],
    images: ["plate-a"],
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
    images: ["print-a", "print-a2"],
  },
  {
    title: "Glaze recipe pack (PDF)",
    category: "prints",
    kind: "digital",
    priceCents: 1200,
    description:
      "Twelve tested cone-6 glaze recipes with photos of each on white and dark clay bodies. Instant download.",
    tags: ["digital", "download", "glaze"],
    images: ["pdf-a"],
  },
  {
    title: "Beginner wheel throwing — 3 hours",
    category: "workshops",
    kind: "service",
    priceCents: 8500,
    description:
      "Small group class, maximum six people. Clay, tools, firing and a coffee included. You take home two pieces.",
    tags: ["workshop", "class", "in-person"],
    images: ["class-a", "class-a2"],
    featured: true,
  },
  {
    title: "Private studio session",
    category: "workshops",
    kind: "service",
    priceCents: 16000,
    description:
      "Two hours one-to-one on the wheel, shaped around whatever you want to make. Weekdays only.",
    tags: ["workshop", "private"],
    images: ["class-b"],
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
  const [shop] = await db
    .insert(shops)
    .values({
      userId,
      handle: DEMO_HANDLE,
      name: "Clay & Co.",
      description:
        "Small-batch stoneware, thrown by hand in Lagos. Restocks every other Friday.",
      avatarUrl: img("clayco-avatar"),
      accentColor: "#b45309",
      theme: "light",
      layout: "grid",
      currency: "USD",
      collectAddress: true,
      affiliatesEnabled: true,
      affiliateDefaultBp: 1000, // 10%
      affiliatePublicSignup: true,
      affiliateTerms:
        "Commission is paid monthly by bank transfer once your balance reaches $50. Self-referrals don't count.",
      invoicePrefix: "CLAY",
      invoiceNotes: "Thanks for supporting a small studio. Handmade in Lagos.",
      taxId: "NG-1234567-8",
      contactEmail: "hello@clayandco.example",
      location: "Lagos, Nigeria",
      socials: [
        { platform: "instagram", url: "https://instagram.com/clayandco" },
        { platform: "tiktok", url: "https://tiktok.com/@clayandco" },
        { platform: "website", url: "https://clayandco.example" },
      ],
      isPublished: true,
    })
    .returning();

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
    const [created] = await db
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
        inStock: p.inStock ?? true,
        isFeatured: p.featured ?? false,
        isPublished: true,
        position: i,
      })
      .returning();

    productIds.push(created.id);
    await db.insert(productImages).values(
      p.images.map((seed, index) => ({
        productId: created.id,
        url: img(seed),
        alt: p.title,
        position: index,
      })),
    );
  }

  console.log("Creating reviews…");
  await db.insert(reviews).values(
    REVIEWS.map((r, i) => ({
      shopId: shop.id,
      productId: productIds[r.product],
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
          "We deliver within Lagos in 2–3 working days. Please have the exact amount ready.",
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
          address: "12 Marina Road, Lagos Island, Lagos",
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
      phone: "2348012345678",
      addressLine1: "14 Bishop Oluwole Street",
      addressLine2: "Flat 3B",
      city: "Lagos",
      region: "Lagos State",
      postalCode: "101241",
      country: "Nigeria",
    },
    {
      name: "Priya Nair",
      email: "priya@example.com",
      phone: "919820098200",
      addressLine1: "22 Carter Road",
      city: "Mumbai",
      region: "Maharashtra",
      postalCode: "400050",
      country: "India",
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
      phone: "962791234567",
      addressLine1: "9 Rainbow Street",
      city: "Amman",
      postalCode: "11181",
      country: "Jordan",
      notes: "Asks about shipping to Amman — quoted $18 flat.",
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
    { p: 2, email: "yasmin@example.com", qty: 3, method: "bank_transfer", delivery: "International", coupon: "WELCOME10", affiliate: null, status: "new", payment: "pending", note: "Do you ship to Amman?", ref: "TRF-91007", tracking: null, refund: 0 },
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
        const client = clientByEmail.get(o.email)!;
        const product = PRODUCTS[o.p];
        const delivery = o.delivery ? deliveryByName.get(o.delivery)! : null;
        const affiliate = o.affiliate
          ? affiliateByCode.get(o.affiliate)
          : undefined;

        // Reuse the app's own maths so seeded totals can't drift from real ones.
        const totals = computeTotals({
          unitPriceCents: product.priceCents,
          quantity: o.qty,
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
          unitPriceCents: product.priceCents,
          quantity: o.qty,
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
