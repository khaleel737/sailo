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
  orders,
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
      whatsapp: "12025550147",
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

  console.log("Creating orders…");
  const ORDERS = [
    { p: 0, name: "Tomi Adeyemi", contact: "+2348012345678", qty: 2, status: "fulfilled", note: "Can you wrap them separately? They're gifts." },
    { p: 6, name: "Priya Nair", contact: "priya@example.com", qty: 1, status: "fulfilled", note: null },
    { p: 4, name: "Dan Kowalski", contact: "+14155550123", qty: 1, status: "contacted", note: null },
    { p: 2, name: "Yasmin Haddad", contact: "yasmin@example.com", qty: 3, status: "new", note: "Do you ship to Amman?" },
    { p: 0, name: "Tomi Adeyemi", contact: "+2348012345678", qty: 1, status: "new", note: null },
    { p: 5, name: "Chris B.", contact: null, qty: 1, status: "new", note: null },
  ];

  await db.insert(orders).values(
    ORDERS.map((o, i) => ({
      shopId: shop.id,
      productId: productIds[o.p],
      productTitle: PRODUCTS[o.p].title,
      unitPriceCents: PRODUCTS[o.p].priceCents,
      quantity: o.qty,
      currency: "USD",
      customerName: o.name,
      customerContact: o.contact,
      note: o.note,
      channel: "whatsapp",
      status: o.status,
      createdAt: daysAgo(i * 2),
    })),
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

  ${PRODUCTS.length} products · ${REVIEWS.length} reviews · ${ORDERS.length} orders · ${visitRows.length} visits
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
