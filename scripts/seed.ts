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

const {
  account,
  categories,
  clients,
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
    { p: 0, email: "tomi@example.com", qty: 2, method: "whatsapp", status: "fulfilled", payment: "paid", note: "Can you wrap them separately? They're gifts.", ref: null },
    { p: 6, email: "priya@example.com", qty: 1, method: "bank_transfer", status: "fulfilled", payment: "paid", note: null, ref: "TRF-88213" },
    { p: 4, email: "dan@example.com", qty: 1, method: "telegram", status: "confirmed", payment: "unpaid", note: null, ref: null },
    { p: 2, email: "yasmin@example.com", qty: 3, method: "bank_transfer", status: "new", payment: "pending", note: "Do you ship to Amman?", ref: "TRF-91007" },
    { p: 0, email: "tomi@example.com", qty: 1, method: "cod", status: "new", payment: "unpaid", note: null, ref: null },
    { p: 5, email: "chris@example.com", qty: 1, method: "instagram", status: "new", payment: "unpaid", note: null, ref: null },
  ];

  await db.insert(orders).values(
    ORDERS.map((o, i) => {
      const client = clientByEmail.get(o.email)!;
      return {
        shopId: shop.id,
        productId: productIds[o.p],
        clientId: client.id,
        productTitle: PRODUCTS[o.p].title,
        unitPriceCents: PRODUCTS[o.p].priceCents,
        quantity: o.qty,
        currency: "USD",
        customerName: client.name,
        customerEmail: client.email,
        customerPhone: client.phone,
        addressLine1: client.addressLine1,
        addressLine2: client.addressLine2,
        city: client.city,
        region: client.region,
        postalCode: client.postalCode,
        country: client.country,
        note: o.note,
        paymentMethod: o.method,
        paymentStatus: o.payment,
        paymentReference: o.ref,
        status: o.status,
        createdAt: daysAgo(i * 2),
      };
    }),
  );

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
  ${ORDERS.length} orders · ${visitRows.length} visits · 5 live payment rails
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
