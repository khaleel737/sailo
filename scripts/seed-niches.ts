/**
 * Seeds a second public shop at /market — a deliberate kitchen sink.
 *
 * The shop at /demo is a coherent pottery studio; this one exists to prove the
 * template holds up across the niches people actually sell in. Pizza with a
 * size and a crust, a massage booked by the hour, an ebook in two formats, a
 * t-shirt in size × colour: every combination of kind, variant, stock, booking
 * and download in one place you can click through.
 *
 * Idempotent — re-running wipes and recreates this shop only, and never
 * touches the pottery demo.
 *
 *   npm run db:seed:niches
 */
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq } from "drizzle-orm";
import { hashPassword } from "better-auth/crypto";
import * as schema from "../src/db/schema";
import { slugify } from "../src/lib/utils";

const {
  account,
  affiliates,
  categories,
  coupons,
  deliveryMethods,
  paymentMethods,
  productFiles,
  productImages,
  products,
  productVariants,
  shops,
  user,
} = schema;

const EMAIL = "market@sailo.store";
const PASSWORD = "demo12345";
const HANDLE = "market";

const img = (seed: string) => `https://picsum.photos/seed/${seed}/900/900`;
/** A real, stable dummy file so the download route has something to stream. */
const FILE = "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf";

const CATEGORIES = [
  { name: "Kitchen", slug: "kitchen" },
  { name: "Wellness", slug: "wellness" },
  { name: "Reading", slug: "reading" },
  { name: "Wear", slug: "wear" },
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
  /* ---- Food: the two-axis case, priced per combination ------------------ */
  {
    title: "Wood-fired margherita",
    category: "kitchen",
    kind: "physical",
    priceCents: 1100,
    description:
      "San Marzano, fior di latte, basil from the window box. Sixty seconds at 450°C.",
    tags: ["pizza", "food", "vegetarian"],
    images: ["pizza-a", "pizza-a2"],
    featured: true,
    options: [
      { name: "Size", values: ['9"', '12"', '16"'] },
      { name: "Crust", values: ["Classic", "Sourdough"] },
    ],
    trackInventory: true,
    variants: [
      { options: { Size: '9"', Crust: "Classic" }, stock: 20, sku: "PZ-9-C" },
      { options: { Size: '9"', Crust: "Sourdough" }, priceCents: 1300, stock: 12, sku: "PZ-9-S" },
      { options: { Size: '12"', Crust: "Classic" }, priceCents: 1500, stock: 18, sku: "PZ-12-C" },
      { options: { Size: '12"', Crust: "Sourdough" }, priceCents: 1700, stock: 9, sku: "PZ-12-S" },
      { options: { Size: '16"', Crust: "Classic" }, priceCents: 1900, stock: 4, sku: "PZ-16-C" },
      // Sold out in one combination only — the picker strikes it through.
      { options: { Size: '16"', Crust: "Sourdough" }, priceCents: 2100, stock: 0, sku: "PZ-16-S" },
    ],
  },
  {
    title: "Cinnamon buns — box of six",
    category: "kitchen",
    kind: "physical",
    priceCents: 1400,
    description:
      "Cardamom in the dough, brown butter in the swirl. Baked at five, gone by nine.",
    tags: ["bakery", "food"],
    images: ["buns-a"],
    // Counted on the product itself: nothing to choose between.
    trackInventory: true,
    stockQuantity: 3,
  },

  /* ---- Wellness: bookings, in person and online ------------------------- */
  {
    title: "Deep tissue massage",
    category: "wellness",
    kind: "service",
    priceCents: 6500,
    description:
      "Slow, firm work through the back, shoulders and hips. Say where it hurts and we'll start there.",
    tags: ["massage", "wellness", "in-person"],
    images: ["massage-a", "massage-a2"],
    featured: true,
    durationMinutes: 60,
    serviceMode: "in_person",
    serviceLocation:
      "Second floor, 14 Ardmore Lane — buzzer marked Studio B. Arrive five minutes early.",
    bookingEnabled: true,
    bookingLeadHours: 24,
    // The length is the choice, and it changes the price.
    options: [{ name: "Length", values: ["60 minutes", "90 minutes"] }],
    variants: [
      { options: { Length: "60 minutes" }, sku: "MSG-60" },
      { options: { Length: "90 minutes" }, priceCents: 9000, sku: "MSG-90" },
    ],
  },
  {
    title: "Morning yoga — live online",
    category: "wellness",
    kind: "service",
    priceCents: 1200,
    description:
      "Forty-five minutes, camera optional. A recording lands in your inbox afterwards.",
    tags: ["yoga", "online", "class"],
    images: ["yoga-a"],
    durationMinutes: 45,
    serviceMode: "online",
    serviceLocation:
      "Join link is emailed once your time is confirmed — no app or account needed.",
    bookingEnabled: true,
    bookingLeadHours: 6,
  },
  {
    title: "Nutrition consultation",
    category: "wellness",
    kind: "service",
    priceCents: 4000,
    description:
      "One hour going through what you actually eat in a week, and what to change first.",
    tags: ["consultation", "wellness"],
    images: ["nutrition-a"],
    durationMinutes: 60,
    serviceMode: "online",
    serviceLocation: "We'll send a video link when the time is agreed.",
    // A service that isn't scheduled at checkout — the seller arranges it after.
    bookingEnabled: false,
  },

  /* ---- Reading: downloads, paid and free -------------------------------- */
  {
    title: "The Sourdough Year — ebook",
    category: "reading",
    kind: "digital",
    priceCents: 1900,
    compareAtCents: 2600,
    description:
      "Twelve months of a starter, week by week, with the failures left in. 180 pages.",
    tags: ["ebook", "baking", "download"],
    images: ["ebook-a", "ebook-a2"],
    featured: true,
    // A download can have options too — same book, different file.
    options: [{ name: "Format", values: ["PDF", "EPUB", "PDF + EPUB"] }],
    variants: [
      { options: { Format: "PDF" }, sku: "SDY-PDF" },
      { options: { Format: "EPUB" }, sku: "SDY-EPUB" },
      { options: { Format: "PDF + EPUB" }, priceCents: 2400, sku: "SDY-BOTH" },
    ],
    files: [
      { name: "The Sourdough Year.pdf", url: FILE, sizeBytes: 13_264, contentType: "application/pdf" },
      { name: "The Sourdough Year.epub", url: FILE, sizeBytes: 13_264, contentType: "application/epub+zip" },
    ],
    // Held until the seller confirms the money, which is the safe default.
    releaseOnPayment: true,
    downloadLimit: 5,
    downloadExpiryDays: 90,
  },
  {
    title: "Weekly meal planner — free template",
    category: "reading",
    kind: "digital",
    priceCents: 0,
    description:
      "The sheet we plan the week on: seven dinners, one shopping list, no thinking.",
    tags: ["free", "template", "download"],
    images: ["planner-a"],
    files: [
      { name: "Meal planner.pdf", url: FILE, sizeBytes: 13_264, contentType: "application/pdf" },
    ],
    // Nothing to wait for on a free download.
    releaseOnPayment: false,
  },

  /* ---- Wear: clothing, the classic size × colour grid -------------------- */
  {
    title: "Oversized heavyweight tee",
    category: "wear",
    kind: "physical",
    priceCents: 3200,
    description:
      "240gsm combed cotton, boxy through the body, dropped shoulder. Pre-shrunk.",
    tags: ["clothing", "cotton", "unisex"],
    images: ["tee-a", "tee-a2", "tee-a3"],
    featured: true,
    options: [
      { name: "Size", values: ["S", "M", "L", "XL"] },
      { name: "Colour", values: ["Black", "Sand"] },
    ],
    trackInventory: true,
    variants: [
      { options: { Size: "S", Colour: "Black" }, stock: 6, sku: "TEE-S-BLK" },
      { options: { Size: "S", Colour: "Sand" }, stock: 2, sku: "TEE-S-SND" },
      { options: { Size: "M", Colour: "Black" }, stock: 11, sku: "TEE-M-BLK" },
      { options: { Size: "M", Colour: "Sand" }, stock: 7, sku: "TEE-M-SND" },
      { options: { Size: "L", Colour: "Black" }, stock: 0, sku: "TEE-L-BLK" },
      { options: { Size: "L", Colour: "Sand" }, stock: 5, sku: "TEE-L-SND" },
      { options: { Size: "XL", Colour: "Black" }, stock: 3, sku: "TEE-XL-BLK" },
      // Not made in this combination at all, so it isn't listed.
      { options: { Size: "XL", Colour: "Sand" }, stock: 0, available: false, sku: "TEE-XL-SND" },
    ],
  },
  {
    title: "Canvas tote",
    category: "wear",
    kind: "physical",
    priceCents: 1800,
    description: "16oz canvas, boxed corners, straps long enough for a shoulder.",
    tags: ["bag", "canvas"],
    images: ["tote-a"],
    // One axis, same price throughout — no numbers to type per variant.
    options: [{ name: "Colour", values: ["Natural", "Olive", "Black"] }],
    variants: [
      { options: { Colour: "Natural" }, sku: "TOTE-NAT" },
      { options: { Colour: "Olive" }, sku: "TOTE-OLV" },
      { options: { Colour: "Black" }, sku: "TOTE-BLK" },
    ],
  },
  {
    title: "Linen apron",
    category: "wear",
    kind: "physical",
    priceCents: 4800,
    description: "Washed linen, cross-back straps, one deep pocket. Softens with use.",
    tags: ["apron", "linen"],
    images: ["apron-b"],
    // Plain product, sold out — the simplest state there is.
    inStock: false,
  },
];

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  const db = drizzle(neon(process.env.DATABASE_URL), { schema });

  console.log("Resetting the market shop…");
  const existingShop = await db.query.shops.findFirst({
    where: eq(shops.handle, HANDLE),
  });
  if (existingShop) {
    // Cascades take care of products, variants, files and orders.
    await db.delete(shops).where(eq(shops.id, existingShop.id));
  }
  const existingUser = await db.query.user.findFirst({
    where: eq(user.email, EMAIL),
  });
  if (existingUser) {
    await db.delete(user).where(eq(user.id, existingUser.id));
  }

  const userId = crypto.randomUUID();
  const now = new Date();
  await db.insert(user).values({
    id: userId,
    name: "Sundry",
    email: EMAIL,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(account).values({
    id: crypto.randomUUID(),
    accountId: userId,
    providerId: "credential",
    userId,
    password: await hashPassword(PASSWORD),
    createdAt: now,
    updatedAt: now,
  });

  console.log("Creating the shop…");
  const [shop] = await db
    .insert(shops)
    .values({
      userId,
      handle: HANDLE,
      name: "Sundry",
      description:
        "Pizza, massages, ebooks and t-shirts. One shop, every kind of thing you can sell.",
      avatarUrl: img("sundry-avatar"),
      accentColor: "#0f766e",
      theme: "light",
      layout: "grid",
      currency: "USD",
      collectAddress: true,
      // Top plan so coupons and referrals are reachable in the demo.
      plan: "business",
      subscriptionStatus: "active",
      affiliatesEnabled: true,
      affiliateDefaultBp: 1200,
      affiliatePublicSignup: true,
      invoicePrefix: "SUN",
      // Tax on, exclusive, so the checkout shows a tax line to look at.
      taxEnabled: true,
      taxName: "Sales tax",
      taxRateBp: 800,
      taxInclusive: false,
      taxOnDelivery: false,
      contactEmail: "hello@sundry.example",
      location: "Lisbon, Portugal",
      socials: [{ platform: "instagram", url: "https://instagram.com/sundry" }],
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
      .returning();

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

  console.log("Creating payment and delivery methods…");
  await db.insert(paymentMethods).values([
    { shopId: shop.id, type: "whatsapp", config: { phone: "351910000000" }, position: 0 },
    {
      shopId: shop.id,
      type: "bank_transfer",
      config: {
        bankName: "Banco Sundry",
        accountName: "Sundry Lda",
        iban: "PT50 0002 0123 1234 5678 9015 4",
        instructions: "Use your name as the reference so we can match it up.",
      },
      position: 1,
    },
    {
      shopId: shop.id,
      type: "cod",
      config: { instructions: "Cash or card to the rider on arrival." },
      position: 2,
    },
  ]);

  await db.insert(deliveryMethods).values([
    {
      shopId: shop.id,
      type: "shipping",
      name: "Standard delivery",
      feeCents: 450,
      freeOverCents: 5000,
      config: { estimate: "2–4 working days" },
      position: 0,
    },
    {
      shopId: shop.id,
      type: "shipping",
      name: "Same-day, city only",
      feeCents: 900,
      config: { estimate: "Ordered before 4pm, with you by 8pm" },
      position: 1,
    },
    {
      shopId: shop.id,
      type: "collection",
      name: "Collect from the counter",
      feeCents: 0,
      config: {
        address: "14 Ardmore Lane, Lisbon",
        hours: "Tue–Sun, 11am–9pm",
      },
      position: 2,
    },
  ]);

  console.log("Creating a coupon and an affiliate…");
  await db.insert(coupons).values([
    {
      shopId: shop.id,
      code: "TASTE15",
      discountType: "percent",
      discountValue: 1500,
      minSubtotalCents: 2000,
      isActive: true,
    },
    {
      shopId: shop.id,
      code: "FIVER",
      discountType: "fixed",
      discountValue: 500,
      isActive: true,
    },
  ]);

  await db.insert(affiliates).values({
    shopId: shop.id,
    name: "Nadia",
    email: "nadia@example.com",
    code: "NADIA",
    status: "active",
  });

  console.log(`
Seeded /${HANDLE} — ${PRODUCTS.length} products across four niches.

  Shop        http://localhost:3000/${HANDLE}
  Referral    http://localhost:3000/${HANDLE}?ref=NADIA
  Coupons     TASTE15 (15% over $20) · FIVER ($5 off)
  Login       ${EMAIL} / ${PASSWORD}

  Pizza       size × crust, priced per combination, one sold out
  Tee         size × colour, one sold out, one never made
  Massage     60 or 90 minutes, booked 24h ahead, in person
  Yoga        online, booked 6h ahead
  Ebook       three formats, two files, held until paid
  Planner     free, unlocks the moment it's ordered
`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
