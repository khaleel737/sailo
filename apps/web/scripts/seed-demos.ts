/**
 * Seeds the four showcase shops the landing page links to.
 *
 * `/demo` is the pottery studio from `seed.ts` — it carries orders, invoices
 * and analytics because the admin tour and the e2e suite both run against it.
 * These four exist for a different reason: to prove on the marketing page that
 * one template covers businesses that have nothing in common. So each one
 * leans on a different part of the product.
 *
 *   /forno    food, two-axis variants, per-combination stock   (a pizzeria)
 *   /lumi     list layout, appointments, a small retail shelf  (a nail bar)
 *   /serene   dark theme, long bookings, nothing to post       (a massage room)
 *   /inkwell  digital downloads, licences, instant delivery    (an ebook press)
 *
 * Every one of them carries a fake Instagram account, because that is where
 * the link actually lives — the landing page shows the bio, then the shop it
 * opens.
 *
 * Idempotent — re-running wipes and recreates these four only, and never
 * touches /demo, /market or a real seller's shop.
 *
 *   npm run db:seed:demos
 */
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq, inArray } from "drizzle-orm";
import { hashPassword } from "better-auth/crypto";
import { firstRow, present } from "@sailo/core/invariant";
import * as schema from "@sailo/db/schema";
import { slugify } from "@sailo/core/slug";
import type { ShopSocial } from "@sailo/db/schema";

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
  reviews,
  shops,
  user,
  visits,
} = schema;

const PASSWORD = "demo12345";

/**
 * Handles from an earlier cut of the showcase. Dropped here so a re-run leaves
 * the database matching the file rather than accumulating dead shops.
 */
const RETIRED = ["nueve", "kaya", "beatlab", "zaytoun"];

/**
 * Product photography, hosted by Unsplash and requested at the size we render.
 * Ids rather than random seeds: every one below was fetched and looked at
 * before it went in, because a pizzeria illustrated with stock photos of a car
 * park reads as a broken product, not a placeholder.
 */
const photo = (id: string, size = 900) =>
  `https://images.unsplash.com/${id}?w=${size}&h=${size}&fit=crop&q=80`;

/** A dummy PDF that really exists, so the download route has something to stream. */
const FILE_URL =
  "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf";

/* -------------------------------------------------------------------------- */
/*  Shapes                                                                     */
/* -------------------------------------------------------------------------- */

type SeedProduct = {
  title: string;
  category: string;
  kind: "physical" | "digital" | "service";
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
  }[];
  trackInventory?: boolean;
  stockQuantity?: number;

  files?: { name: string; sizeBytes: number }[];
  releaseOnPayment?: boolean;
  downloadLimit?: number;
  downloadExpiryDays?: number;

  durationMinutes?: number;
  serviceMode?: "in_person" | "online";
  serviceLocation?: string;
  bookingEnabled?: boolean;
  bookingLeadHours?: number;
};

type SeedShop = {
  handle: string;
  email: string;
  ownerName: string;
  name: string;
  description: string;
  location: string;
  avatar: string;
  accentColor: string;
  theme: "light" | "dark";
  layout: "grid" | "list";
  currency: string;
  /** Null follows the visitor's browser; a pinned code overrides it. */
  locale: string | null;
  plan: "free" | "pro" | "business";
  contactEmail: string;
  invoicePrefix: string;
  /** The account the link actually lives in. Shown on the landing page. */
  instagram: string;
  socials: ShopSocial[];
  affiliate?: { bp: number; terms: string };
  categories: { name: string; slug: string }[];
  products: SeedProduct[];
  reviews: { product: number; name: string; rating: number; body: string }[];
  payments: { type: string; config: Record<string, string>; enabled?: boolean }[];
  deliveries: {
    type: "shipping" | "collection";
    name: string;
    feeCents: number;
    freeOverCents?: number;
    config: Record<string, string>;
  }[];
  coupons?: { code: string; type: "percent" | "fixed"; value: number }[];
};

/* -------------------------------------------------------------------------- */
/*  1 · Forno Nove — food, two-axis variants, per-combination stock            */
/* -------------------------------------------------------------------------- */

const FORNO: SeedShop = {
  handle: "forno",
  email: "forno@sailo.store",
  ownerName: "Giulia Esposito",
  name: "Forno Nove",
  description:
    "Wood-fired pizza from a nine-square-metre kitchen in Sanità. We open at six, we close when the dough runs out.",
  location: "Naples, Italy",
  avatar: photo("photo-1574071318508-1cdbab80d002", 400),
  accentColor: "#c2410c",
  theme: "light",
  layout: "grid",
  currency: "EUR",
  locale: null,
  plan: "business",
  contactEmail: "ciao@fornonove.example",
  invoicePrefix: "FORNO",
  instagram: "fornonove",
  socials: [
    { platform: "instagram", url: "https://instagram.com/fornonove" },
    { platform: "whatsapp", url: "https://wa.me/393331234567" },
    { platform: "tiktok", url: "https://tiktok.com/@fornonove" },
  ],
  affiliate: {
    bp: 800,
    terms:
      "8% on every order through your link, paid monthly in cash or by transfer. Food bloggers and offices welcome.",
  },
  categories: [
    { name: "Pizza", slug: "pizza" },
    { name: "Sides", slug: "sides" },
    { name: "Sweet", slug: "sweet" },
    { name: "Deals", slug: "deals" },
  ],
  products: [
    {
      title: "Margherita",
      category: "pizza",
      kind: "physical",
      priceCents: 800,
      description:
        "San Marzano, fior di latte, basil, a thread of oil. Ninety seconds at 450°C and nothing else to argue about.",
      tags: ["classic", "vegetarian"],
      images: ["photo-1595854341625-f33ee10dbf94", "photo-1574071318508-1cdbab80d002"],
      featured: true,
      // Two axes: every size in every crust, counted separately.
      options: [
        { name: "Size", values: ['26cm', '33cm'] },
        { name: "Crust", values: ["Classic", "Sourdough", "Gluten-free"] },
      ],
      trackInventory: true,
      variants: [
        { options: { Size: "26cm", Crust: "Classic" }, stock: 40, sku: "MAR-26-C" },
        { options: { Size: "26cm", Crust: "Sourdough" }, priceCents: 950, stock: 24, sku: "MAR-26-S" },
        { options: { Size: "26cm", Crust: "Gluten-free" }, priceCents: 1050, stock: 8, sku: "MAR-26-G" },
        { options: { Size: "33cm", Crust: "Classic" }, priceCents: 1200, stock: 30, sku: "MAR-33-C" },
        { options: { Size: "33cm", Crust: "Sourdough" }, priceCents: 1350, stock: 12, sku: "MAR-33-S" },
        // Sold out in one combination only — the picker strikes it through.
        { options: { Size: "33cm", Crust: "Gluten-free" }, priceCents: 1450, stock: 0, sku: "MAR-33-G" },
      ],
    },
    {
      title: "Diavola",
      category: "pizza",
      kind: "physical",
      priceCents: 1100,
      description: "Spicy salami, chilli honey, oregano. Order it if you mean it.",
      tags: ["spicy", "salami"],
      images: ["photo-1544982503-9f984c14501a", "photo-1601924582970-9238bcb495d9"],
      featured: true,
      options: [{ name: "Size", values: ["26cm", "33cm"] }],
      trackInventory: true,
      variants: [
        { options: { Size: "26cm" }, stock: 26, sku: "DIA-26" },
        { options: { Size: "33cm" }, priceCents: 1500, stock: 18, sku: "DIA-33" },
      ],
    },
    {
      title: "Marinara",
      category: "pizza",
      kind: "physical",
      priceCents: 700,
      description:
        "Tomato, garlic, oregano, oil. No cheese, no apology — the oldest pizza there is and still the best value on the menu.",
      tags: ["vegan", "classic"],
      images: ["photo-1593560708920-61dd98c46a4e"],
      trackInventory: true,
      stockQuantity: 22,
    },
    {
      title: "Bufala & rocket",
      category: "pizza",
      kind: "physical",
      priceCents: 1300,
      description:
        "Mozzarella di bufala torn on after the bake, rocket, shaved grana. Eat it before the leaves wilt.",
      tags: ["bufala", "vegetarian"],
      images: ["photo-1528137871618-79d2761e3fd5", "photo-1590947132387-155cc02f3212"],
      options: [{ name: "Size", values: ["26cm", "33cm"] }],
      variants: [
        { options: { Size: "26cm" }, sku: "BUF-26" },
        { options: { Size: "33cm" }, priceCents: 1700, sku: "BUF-33" },
      ],
    },
    {
      title: "Quattro formaggi",
      category: "pizza",
      kind: "physical",
      priceCents: 1250,
      description: "Fior di latte, gorgonzola, provola, grana. A pizza that argues back.",
      tags: ["cheese", "vegetarian"],
      images: ["photo-1552539618-7eec9b4d1796"],
      trackInventory: true,
      stockQuantity: 3,
    },
    {
      title: "Garlic bread with rosemary",
      category: "sides",
      kind: "physical",
      priceCents: 450,
      description: "Same dough, half the time in the oven, twice the garlic. Comes cut into six.",
      tags: ["side", "vegetarian"],
      images: ["photo-1509440159596-0249088772ff"],
      trackInventory: true,
      stockQuantity: 15,
    },
    {
      title: "House salad",
      category: "sides",
      kind: "physical",
      priceCents: 550,
      description: "Leaves, tomato, red onion, oil and vinegar. Ordered mostly out of guilt.",
      tags: ["side", "vegan"],
      images: ["photo-1609501676725-7186f017a4b7"],
      inStock: false,
    },
    {
      title: "Tiramisù",
      category: "sweet",
      kind: "physical",
      priceCents: 600,
      description: "Made every morning in a tray, served in a cup. Gone by nine most nights.",
      tags: ["dessert"],
      images: ["photo-1571115177098-24ec42ed204d"],
      trackInventory: true,
      stockQuantity: 9,
    },
    {
      title: "Family deal — 3 pizzas, bread & tiramisù",
      category: "deals",
      kind: "physical",
      priceCents: 3200,
      compareAtCents: 4050,
      description:
        "Three 26cm pizzas of your choosing, garlic bread and two tiramisù. Message us the pizzas after ordering.",
      tags: ["deal", "family"],
      images: ["photo-1571407970349-bc81e7e96d47", "photo-1513104890138-7c749659a591"],
      featured: true,
      options: [{ name: "Crust", values: ["Classic", "Sourdough"] }],
      variants: [
        { options: { Crust: "Classic" } },
        { options: { Crust: "Sourdough" }, priceCents: 3600 },
      ],
    },
    {
      title: "Pizza-making evening — 2 hours",
      category: "deals",
      kind: "service",
      priceCents: 4500,
      description:
        "Six people around the bench after service. Dough, sauce, the oven, and you eat what you make. Wine included.",
      tags: ["class", "in-person"],
      images: ["photo-1548369937-47519962c11a"],
      durationMinutes: 120,
      serviceMode: "in_person",
      serviceLocation: "Via dei Tribunali 9, Sanità. Come to the side door after 21:30.",
      bookingEnabled: true,
      bookingLeadHours: 48,
      options: [{ name: "Seats", values: ["One", "Two"] }],
      variants: [
        { options: { Seats: "One" } },
        { options: { Seats: "Two" }, priceCents: 8500 },
      ],
    },
  ],
  reviews: [
    { product: 0, name: "Marco", rating: 5, body: "The only place I've found in Naples that answers WhatsApp in under a minute. Pizza's not bad either." },
    { product: 0, name: "Hana", rating: 5, body: "Gluten-free base is genuinely good, which I have never once been able to say." },
    { product: 1, name: "Ste", rating: 5, body: "Chilli honey on a diavola should be illegal. Ordered it four times this month." },
    { product: 8, name: "Elena R.", rating: 5, body: "Family deal fed five of us for €32. We've stopped cooking on Fridays." },
    { product: 9, name: "Tom", rating: 4, body: "Great fun. Would've liked more time on the stretching." },
    { product: 3, name: "Priya", rating: 5, body: "Ordered at 19:00, collected at 19:20, still too hot to eat at 19:25." },
  ],
  payments: [
    { type: "whatsapp", config: { phone: "393331234567" } },
    { type: "card", config: {} },
    { type: "cod", config: { instructions: "Pay the driver by card or cash. They carry change." } },
    { type: "phone", config: { number: "393331234567" } },
  ],
  deliveries: [
    {
      type: "shipping",
      name: "Delivery — Sanità & Vergini",
      feeCents: 250,
      freeOverCents: 2500,
      config: { estimate: "25–40 minutes", instructions: "We call when the driver leaves." },
    },
    {
      type: "collection",
      name: "Collect from the counter",
      feeCents: 0,
      config: {
        address: "Via dei Tribunali 9, 80138 Napoli",
        hours: "Tue–Sun, 18:00 until the dough runs out",
        instructions: "Ready 20 minutes after you order. We'll message when it's boxed.",
      },
    },
  ],
  coupons: [
    { code: "MARTEDI", type: "percent", value: 2000 },
    { code: "PRIMOORDINE", type: "fixed", value: 300 },
  ],
};

/* -------------------------------------------------------------------------- */
/*  2 · Lumière Nails — list layout, appointments, a small retail shelf        */
/* -------------------------------------------------------------------------- */

const LUMI: SeedShop = {
  handle: "lumi",
  email: "lumi@sailo.store",
  ownerName: "Camille Rousseau",
  name: "Lumière Nails",
  description:
    "A four-chair nail bar off Rue Oberkampf. Book a slot below, or send us a photo of what you want and we'll tell you if it'll hold.",
  location: "Paris, France",
  avatar: photo("photo-1522337660859-02fbefca4702", 400),
  accentColor: "#db2777",
  theme: "light",
  layout: "list",
  currency: "EUR",
  locale: null,
  plan: "pro",
  contactEmail: "book@lumierenails.example",
  invoicePrefix: "LUMI",
  instagram: "lumierenails",
  socials: [
    { platform: "instagram", url: "https://instagram.com/lumierenails" },
    { platform: "whatsapp", url: "https://wa.me/33612345678" },
    { platform: "tiktok", url: "https://tiktok.com/@lumierenails" },
  ],
  categories: [
    { name: "Manicure", slug: "manicure" },
    { name: "Pedicure", slug: "pedicure" },
    { name: "Nail art", slug: "nail-art" },
    { name: "Shelf", slug: "shelf" },
  ],
  products: [
    {
      title: "Gel manicure",
      category: "manicure",
      kind: "service",
      priceCents: 4_500,
      description:
        "Shape, cuticle work, base, two coats and a top. Holds three weeks if you stop opening cans with them.",
      tags: ["gel", "manicure"],
      images: ["photo-1522337660859-02fbefca4702", "photo-1632345031435-8727f6897d53"],
      featured: true,
      durationMinutes: 50,
      serviceMode: "in_person",
      serviceLocation: "Lumière Nails, 1st floor, 42 Rue Oberkampf.",
      bookingEnabled: true,
      bookingLeadHours: 4,
      options: [{ name: "Technician", values: ["Any", "Camille", "Margot"] }],
      variants: [
        { options: { Technician: "Any" } },
        { options: { Technician: "Camille" }, priceCents: 5_500 },
        { options: { Technician: "Margot" }, priceCents: 5_500 },
      ],
    },
    {
      title: "Classic manicure",
      category: "manicure",
      kind: "service",
      priceCents: 3_000,
      description: "File, cuticles, buff, one colour or bare. Thirty minutes, in and out on a lunch break.",
      tags: ["manicure", "quick"],
      images: ["photo-1610992015732-2449b76344bc"],
      durationMinutes: 30,
      serviceMode: "in_person",
      serviceLocation: "Lumière Nails, 1st floor, 42 Rue Oberkampf.",
      bookingEnabled: true,
      bookingLeadHours: 2,
    },
    {
      title: "Acrylic full set",
      category: "manicure",
      kind: "service",
      priceCents: 7_500,
      description:
        "Tips, sculpt, shape and colour. Two hours, and we'll be honest with you about the length you're asking for.",
      tags: ["acrylic", "extensions"],
      images: ["photo-1519014816548-bf5fe059798b"],
      featured: true,
      durationMinutes: 120,
      serviceMode: "in_person",
      serviceLocation: "Lumière Nails, 1st floor, 42 Rue Oberkampf.",
      bookingEnabled: true,
      bookingLeadHours: 24,
      options: [{ name: "Length", values: ["Short", "Medium", "Long"] }],
      variants: [
        { options: { Length: "Short" } },
        { options: { Length: "Medium" }, priceCents: 8_500 },
        { options: { Length: "Long" }, priceCents: 9_500 },
      ],
    },
    {
      title: "Nail art — per nail",
      category: "nail-art",
      kind: "service",
      priceCents: 600,
      description:
        "Chrome, french, hand-painted, whatever is in the photo you send. Priced per nail, so two accents is two.",
      tags: ["art", "custom"],
      images: ["photo-1604654894610-df63bc536371", "photo-1607779097040-26e80aa78e66"],
      durationMinutes: 15,
      serviceMode: "in_person",
      serviceLocation: "Add this to any manicure. Send your reference on WhatsApp first.",
      bookingEnabled: false,
    },
    {
      title: "Soak-off & repair",
      category: "manicure",
      kind: "service",
      priceCents: 2_000,
      description: "Gentle removal, rebalance and cuticle recovery. Free if the set was ours and it's under three weeks old.",
      tags: ["removal", "repair"],
      images: ["photo-1632345031435-8727f6897d53"],
      durationMinutes: 30,
      serviceMode: "in_person",
      serviceLocation: "Lumière Nails, 1st floor, 42 Rue Oberkampf.",
      bookingEnabled: true,
      bookingLeadHours: 2,
    },
    {
      title: "Spa pedicure",
      category: "pedicure",
      kind: "service",
      priceCents: 6_000,
      description: "Soak, scrub, heel work, massage and colour. Sixty minutes in the chair by the window.",
      tags: ["pedicure", "spa"],
      images: ["photo-1607779097040-26e80aa78e66"],
      durationMinutes: 60,
      serviceMode: "in_person",
      serviceLocation: "Lumière Nails, 1st floor, 42 Rue Oberkampf.",
      bookingEnabled: true,
      bookingLeadHours: 6,
    },
    {
      title: "Bridal party — four people",
      category: "nail-art",
      kind: "service",
      priceCents: 28_000,
      compareAtCents: 34_000,
      description:
        "We close the shop for two hours and it's just you. Gel for four, art on two hands each, and someone brings the cake.",
      tags: ["bridal", "group"],
      images: ["photo-1600948836101-f9ffda59d250"],
      durationMinutes: 150,
      serviceMode: "in_person",
      serviceLocation: "Lumière Nails, or your venue within Paris for an extra €40.",
      bookingEnabled: true,
      bookingLeadHours: 168,
    },
    {
      title: "Cuticle oil — 15ml",
      category: "shelf",
      kind: "physical",
      priceCents: 1_800,
      description: "Jojoba and vitamin E in a brush pen. The reason our sets last as long as they do.",
      tags: ["oil", "aftercare"],
      images: ["photo-1611930022073-b7a4ba5fcccd"],
      trackInventory: true,
      stockQuantity: 14,
    },
    {
      title: "Aftercare kit",
      category: "shelf",
      kind: "physical",
      priceCents: 4_500,
      description: "Oil, buffer, glass file and the one-page guide we hand every first-timer.",
      tags: ["kit", "aftercare", "gift"],
      images: ["photo-1607013251379-e6eecfffe234"],
      trackInventory: true,
      stockQuantity: 6,
    },
  ],
  reviews: [
    { product: 0, name: "Amélie", rating: 5, body: "Three weeks and not one lifted. Booked my next slot before I left the chair." },
    { product: 0, name: "Nour", rating: 5, body: "Sent a photo on Instagram at midnight, had a slot confirmed by morning." },
    { product: 2, name: "Clémence", rating: 5, body: "Talked me out of the length I asked for and was completely right." },
    { product: 6, name: "Zara M.", rating: 5, body: "Did my whole bridal party. Everyone cried, for the right reasons." },
    { product: 7, name: "Lucie", rating: 4, body: "The oil is great, though I wish the pen were bigger." },
  ],
  payments: [
    { type: "whatsapp", config: { phone: "33612345678" } },
    { type: "instagram", config: { username: "lumierenails" } },
    {
      type: "bank_transfer",
      config: {
        bankName: "BNP Paribas",
        accountName: "Lumière Nails SARL",
        accountNumber: "FR76 3000 4000 0300 0012 3456 789",
        instructions: "SEPA transfer to the IBAN above. Put your booking time in the reference.",
      },
    },
    { type: "cod", config: { instructions: "Pay at the shop when you come in. Card or cash." } },
  ],
  deliveries: [
    {
      type: "collection",
      name: "At the shop",
      feeCents: 0,
      config: {
        address: "Lumière Nails, 1st floor, 42 Rue Oberkampf, Paris",
        hours: "Mon–Sat 9am–7pm · Sun 11am–4pm",
        instructions: "Past the pharmacy, up the stairs, pink door.",
      },
    },
    {
      type: "shipping",
      name: "Paris delivery (shelf items)",
      feeCents: 500,
      freeOverCents: 6_000,
      config: { estimate: "Same day if ordered before 2pm" },
    },
  ],
};

/* -------------------------------------------------------------------------- */
/*  3 · Serenity Rooms — dark theme, long bookings, nothing to post            */
/* -------------------------------------------------------------------------- */

const SERENE: SeedShop = {
  handle: "serene",
  email: "serene@sailo.store",
  ownerName: "Nadia Brooks",
  name: "Serenity Rooms",
  description:
    "Three treatment rooms in East Austin. Massage by appointment, seven days a week, and never more than two therapists on at once.",
  location: "Austin, Texas",
  avatar: photo("photo-1600334089648-b0d9d3028eb2", 400),
  accentColor: "#14b8a6",
  theme: "dark",
  layout: "grid",
  currency: "USD",
  locale: null,
  plan: "pro",
  contactEmail: "book@serenityrooms.example",
  invoicePrefix: "SR",
  instagram: "serenityrooms",
  socials: [
    { platform: "instagram", url: "https://instagram.com/serenityrooms" },
    { platform: "whatsapp", url: "https://wa.me/15125550147" },
    { platform: "website", url: "https://serenityrooms.example" },
  ],
  categories: [
    { name: "Massage", slug: "massage" },
    { name: "Body & face", slug: "body-face" },
    { name: "Packages", slug: "packages" },
    { name: "Shelf", slug: "shelf" },
  ],
  products: [
    {
      title: "Deep tissue — 60 minutes",
      category: "massage",
      kind: "service",
      priceCents: 9_500,
      description:
        "Slow, firm work through the back, neck and shoulders. Tell us where it hurts and we will stay there.",
      tags: ["deep tissue", "back"],
      images: ["photo-1519823551278-64ac92734fb1", "photo-1519824145371-296894a0daa9"],
      featured: true,
      durationMinutes: 60,
      serviceMode: "in_person",
      serviceLocation: "Serenity Rooms, 14 Cesar Chavez Street, East Austin. Buzzer 3.",
      bookingEnabled: true,
      bookingLeadHours: 12,
      options: [{ name: "Therapist", values: ["Any", "Nadia", "Marcus"] }],
      variants: [
        { options: { Therapist: "Any" } },
        { options: { Therapist: "Nadia" }, priceCents: 11_000 },
        { options: { Therapist: "Marcus" }, priceCents: 11_000 },
      ],
    },
    {
      title: "Swedish relaxation — 90 minutes",
      category: "massage",
      kind: "service",
      priceCents: 13_500,
      description:
        "Long, even strokes, warm oil, no conversation required. The one to book if you've never had a massage before.",
      tags: ["swedish", "relaxation"],
      images: ["photo-1544161515-4ab6ce6db874"],
      featured: true,
      durationMinutes: 90,
      serviceMode: "in_person",
      serviceLocation: "Serenity Rooms, 14 Cesar Chavez Street, East Austin.",
      bookingEnabled: true,
      bookingLeadHours: 12,
    },
    {
      title: "Hot stone therapy — 75 minutes",
      category: "massage",
      kind: "service",
      priceCents: 12_500,
      description:
        "Basalt stones held at 52°C, placed and worked along the spine. Everyone falls asleep. Nobody is embarrassed about it.",
      tags: ["hot stone", "heat"],
      images: ["photo-1600334089648-b0d9d3028eb2"],
      durationMinutes: 75,
      serviceMode: "in_person",
      serviceLocation: "Serenity Rooms, 14 Cesar Chavez Street, East Austin.",
      bookingEnabled: true,
      bookingLeadHours: 24,
    },
    {
      title: "Aromatherapy massage — 60 minutes",
      category: "massage",
      kind: "service",
      priceCents: 10_000,
      description:
        "You choose the blend when you arrive — three to smell, one to take home. Lighter pressure than the deep tissue.",
      tags: ["aromatherapy", "oils"],
      images: ["photo-1540555700478-4be289fbecef"],
      durationMinutes: 60,
      serviceMode: "in_person",
      serviceLocation: "Serenity Rooms, 14 Cesar Chavez Street, East Austin.",
      bookingEnabled: true,
      bookingLeadHours: 12,
    },
    {
      title: "Prenatal massage — 60 minutes",
      category: "body-face",
      kind: "service",
      priceCents: 10_000,
      description:
        "Side-lying with bolsters, from the second trimester on. Both therapists are certified for it.",
      tags: ["prenatal", "gentle"],
      images: ["photo-1591343395902-1adcb454c4e2"],
      durationMinutes: 60,
      serviceMode: "in_person",
      serviceLocation: "Serenity Rooms, 14 Cesar Chavez Street, East Austin.",
      bookingEnabled: true,
      bookingLeadHours: 24,
    },
    {
      title: "Sports recovery — 45 minutes",
      category: "body-face",
      kind: "service",
      priceCents: 8_000,
      description:
        "Focused work on whatever you've just trained, plus the two stretches you'll forget to do at home.",
      tags: ["sports", "recovery"],
      images: ["photo-1534438327276-14e5300c3a48"],
      durationMinutes: 45,
      serviceMode: "in_person",
      serviceLocation: "Serenity Rooms, 14 Cesar Chavez Street, East Austin.",
      bookingEnabled: true,
      bookingLeadHours: 6,
    },
    {
      title: "Consultation call — 15 minutes",
      category: "body-face",
      kind: "service",
      priceCents: 0,
      description:
        "Not sure which one to book, or working around an injury? Fifteen minutes on the phone, free, no obligation.",
      tags: ["free", "advice", "online"],
      images: ["photo-1512290923902-8a9f81dc236c"],
      durationMinutes: 15,
      // Everything else happens on the table; this one happens on a call.
      serviceMode: "online",
      serviceLocation: "We ring you at the time you pick. No app, no video unless you want one.",
      bookingEnabled: true,
      bookingLeadHours: 4,
    },
    {
      title: "Half day — massage, scrub & rest",
      category: "packages",
      kind: "service",
      priceCents: 26_000,
      compareAtCents: 32_000,
      description:
        "Ninety minutes on the table, a salt scrub, then as long as you like in the quiet room with tea. Book it for two and we'll run the rooms side by side.",
      tags: ["package", "half day"],
      images: ["photo-1596178065887-1198b6148b2b", "photo-1620733723572-11c53f73a416"],
      featured: true,
      durationMinutes: 210,
      serviceMode: "in_person",
      serviceLocation: "Serenity Rooms, 14 Cesar Chavez Street, East Austin.",
      bookingEnabled: true,
      bookingLeadHours: 72,
      options: [{ name: "People", values: ["One", "Two"] }],
      variants: [
        { options: { People: "One" } },
        { options: { People: "Two" }, priceCents: 50_000 },
      ],
    },
    {
      title: "Massage oil — 200ml",
      category: "shelf",
      kind: "physical",
      priceCents: 2_800,
      description: "The grapeseed, lavender and vetiver blend we use in the aromatherapy room. Unscented on request.",
      tags: ["oil", "aftercare"],
      images: ["photo-1620733723572-11c53f73a416"],
      trackInventory: true,
      stockQuantity: 11,
    },
  ],
  reviews: [
    { product: 0, name: "Ryan", rating: 5, body: "Sorted out a shoulder two physios couldn't. Booked in on WhatsApp on a Sunday night." },
    { product: 1, name: "Leah", rating: 5, body: "Ninety minutes and I forgot what day it was. That's the review." },
    { product: 2, name: "Fatima", rating: 5, body: "The stones are worth the extra. Slept nine hours that night." },
    { product: 7, name: "Dan & Jo", rating: 5, body: "Did the half day for our anniversary. The quiet room alone is worth it." },
    { product: 6, name: "Nicole", rating: 5, body: "The free call meant I booked the right thing instead of guessing." },
  ],
  payments: [
    { type: "whatsapp", config: { phone: "15125550147" } },
    { type: "card", config: {} },
    {
      type: "bank_transfer",
      config: {
        bankName: "Frost Bank",
        accountName: "Serenity Rooms LLC",
        accountNumber: "1052345678",
        instructions: "Use your booking time as the reference, e.g. 'Tue 14:00'.",
      },
    },
    { type: "email", config: { address: "book@serenityrooms.example" }, enabled: false },
  ],
  deliveries: [
    {
      type: "collection",
      name: "At the rooms",
      feeCents: 0,
      config: {
        address: "14 Cesar Chavez Street, East Austin, TX",
        hours: "Every day, 8am–8pm",
        instructions: "Buzzer 3. There's parking on Waller Street.",
      },
    },
  ],
};

/* -------------------------------------------------------------------------- */
/*  4 · Inkwell Press — digital downloads, licences, instant delivery          */
/* -------------------------------------------------------------------------- */

const INKWELL: SeedShop = {
  handle: "inkwell",
  email: "inkwell@sailo.store",
  ownerName: "Jonas Weber",
  name: "Inkwell Press",
  description:
    "Ebooks, templates and editing for people writing their first book. Everything here comes as PDF and EPUB, and lands in your inbox straight away.",
  location: "Berlin, Germany",
  avatar: photo("photo-1512820790803-83ca734da794", 400),
  accentColor: "#6366f1",
  theme: "dark",
  layout: "grid",
  currency: "EUR",
  locale: null,
  plan: "business",
  contactEmail: "hello@inkwellpress.example",
  invoicePrefix: "INK",
  instagram: "inkwellpress",
  socials: [
    { platform: "instagram", url: "https://instagram.com/inkwellpress" },
    { platform: "telegram", url: "https://t.me/inkwellpress" },
    { platform: "youtube", url: "https://youtube.com/@inkwellpress" },
    { platform: "website", url: "https://inkwellpress.example" },
  ],
  affiliate: {
    bp: 3000,
    terms:
      "30% on every download through your link, paid monthly by transfer once you're over €25. Writers and newsletters only.",
  },
  categories: [
    { name: "Ebooks", slug: "ebooks" },
    { name: "Templates", slug: "templates" },
    { name: "Bundles", slug: "bundles" },
    { name: "Editing", slug: "editing" },
  ],
  products: [
    {
      title: "The Quiet Launch — ebook",
      category: "ebooks",
      kind: "digital",
      priceCents: 1900,
      description:
        "How to publish a first book without an agent, an audience or a marketing budget. 214 pages, PDF and EPUB.",
      tags: ["ebook", "publishing", "pdf"],
      images: ["photo-1512820790803-83ca734da794", "photo-1495446815901-a7297e633e8d"],
      featured: true,
      files: [
        { name: "The Quiet Launch.pdf", sizeBytes: 8_400_000 },
        { name: "The Quiet Launch.epub", sizeBytes: 1_900_000 },
      ],
      releaseOnPayment: true,
      downloadLimit: 5,
      downloadExpiryDays: 365,
      // A download can have options too — same files, different licence.
      options: [{ name: "Licence", values: ["Personal", "Team of 10"] }],
      variants: [
        { options: { Licence: "Personal" }, sku: "TQL-PERS" },
        { options: { Licence: "Team of 10" }, priceCents: 9900, sku: "TQL-TEAM" },
      ],
    },
    {
      title: "Ninety Days of Notes — journal",
      category: "ebooks",
      kind: "digital",
      priceCents: 1200,
      compareAtCents: 1600,
      description:
        "A printable ninety-day writing journal. One page a day, three prompts, and a page at the end you fill in yourself.",
      tags: ["journal", "printable", "habit"],
      images: ["photo-1516414447565-b14be0adf13e"],
      featured: true,
      files: [{ name: "Ninety Days of Notes.pdf", sizeBytes: 22_000_000 }],
      releaseOnPayment: true,
      downloadLimit: 3,
      downloadExpiryDays: 180,
    },
    {
      title: "Freelance contract pack",
      category: "templates",
      kind: "digital",
      priceCents: 2400,
      description:
        "Six contracts a working writer actually needs — commission, ghostwriting, kill fee, rights reversion — in Word and Google Docs.",
      tags: ["contracts", "templates", "freelance"],
      images: ["photo-1517842645767-c639042777db"],
      files: [{ name: "Freelance contract pack.zip", sizeBytes: 4_100_000 }],
      releaseOnPayment: true,
      downloadLimit: 5,
      downloadExpiryDays: 365,
    },
    {
      title: "Second-brain writing template",
      category: "templates",
      kind: "digital",
      priceCents: 1500,
      description:
        "The Notion setup we use to plan a book: research, outline, drafts and a word count that updates itself.",
      tags: ["notion", "template", "planning"],
      images: ["photo-1499750310107-5fef28a66643"],
      files: [{ name: "Second brain — setup.pdf", sizeBytes: 1_100_000 }],
      releaseOnPayment: true,
      downloadLimit: 5,
      downloadExpiryDays: 365,
    },
    {
      title: "Everything bundle",
      category: "bundles",
      kind: "digital",
      priceCents: 4900,
      compareAtCents: 7000,
      description:
        "Both ebooks, both template packs, and next year's releases free. If you were going to buy two things, buy this.",
      tags: ["bundle", "deal"],
      images: ["photo-1481627834876-b7833e8f5570", "photo-1524995997946-a1c2e315a42f"],
      featured: true,
      files: [{ name: "Inkwell — everything.zip", sizeBytes: 61_000_000 }],
      releaseOnPayment: true,
      downloadLimit: 8,
      downloadExpiryDays: 730,
    },
    {
      title: "First chapter — free",
      category: "ebooks",
      kind: "digital",
      priceCents: 0,
      description:
        "Chapter one of The Quiet Launch, no email required. If it's not for you, you've lost nothing.",
      tags: ["free", "sample", "ebook"],
      images: ["photo-1456513080510-7bf3a84b82f8"],
      files: [{ name: "The Quiet Launch — chapter one.pdf", sizeBytes: 640_000 }],
      // Nothing to settle on a free download, so it unlocks on the spot.
      releaseOnPayment: false,
    },
    {
      title: "Manuscript edit — up to 60,000 words",
      category: "editing",
      kind: "service",
      priceCents: 68_000,
      description:
        "A full developmental edit with an eight-page letter and in-line notes. Three weeks, one round of follow-up questions included.",
      tags: ["editing", "online"],
      images: ["photo-1544716278-ca5e3f4abd8c"],
      featured: true,
      durationMinutes: 1200,
      serviceMode: "online",
      serviceLocation: "Send your manuscript as .docx to the link we email after ordering.",
      bookingEnabled: true,
      bookingLeadHours: 168,
      options: [{ name: "Turnaround", values: ["Three weeks", "Ten days"] }],
      variants: [
        { options: { Turnaround: "Three weeks" } },
        { options: { Turnaround: "Ten days" }, priceCents: 95_000 },
      ],
    },
    {
      title: "Coaching call — 60 minutes",
      category: "editing",
      kind: "service",
      priceCents: 9000,
      description:
        "One hour on whatever is stuck. Most people bring a middle that sags or a proposal that isn't landing.",
      tags: ["coaching", "online"],
      images: ["photo-1590650153855-d9e808231d41"],
      durationMinutes: 60,
      serviceMode: "online",
      serviceLocation: "Video link by email once the slot is confirmed.",
      bookingEnabled: true,
      bookingLeadHours: 24,
    },
    {
      title: "Cover design — ebook",
      category: "editing",
      kind: "service",
      priceCents: 2_800,
      description:
        "Three concepts, one revision round, files sized for Kindle, Kobo and print. Two weeks.",
      tags: ["design", "cover", "online"],
      images: ["photo-1589998059171-988d887df646"],
      durationMinutes: 600,
      serviceMode: "online",
      serviceLocation: "We'll email a short brief to fill in after you order.",
      bookingEnabled: true,
      bookingLeadHours: 72,
    },
  ],
  reviews: [
    { product: 0, name: "Ama", rating: 5, body: "Read it in two evenings and immediately did three things I'd been avoiding for a year." },
    { product: 0, name: "T. Nowak", rating: 5, body: "Bought the team licence for our editorial staff. Download link worked instantly." },
    { product: 2, name: "Bea", rating: 5, body: "The kill fee contract has already paid for itself twice." },
    { product: 4, name: "Sam O.", rating: 4, body: "Great value. The zip is enormous — maybe split it up?" },
    { product: 6, name: "Marta", rating: 5, body: "The edit letter was kinder and more brutal than I expected. Both were needed." },
  ],
  payments: [
    { type: "card", config: {} },
    { type: "email", config: { address: "hello@inkwellpress.example" } },
    { type: "telegram", config: { username: "inkwellpress" } },
  ],
  // Nothing here is posted, so there is nothing to deliver.
  deliveries: [],
  coupons: [
    { code: "FIRSTDRAFT", type: "percent", value: 2000 },
    { code: "BUNDLE10", type: "fixed", value: 1000 },
  ],
};

const SHOPS = [FORNO, LUMI, SERENE, INKWELL];

/* -------------------------------------------------------------------------- */
/*  Seeding                                                                    */
/* -------------------------------------------------------------------------- */

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const db = drizzle(neon(url), { schema });

  const retired = await db.query.shops.findMany({
    where: inArray(shops.handle, RETIRED),
  });
  if (retired.length) {
    await db.delete(shops).where(inArray(shops.handle, RETIRED));
    await db.delete(user).where(
      inArray(user.email, RETIRED.map((h) => `${h}@sailo.store`)),
    );
    console.log(`Removed ${retired.length} retired showcase shops.`);
  }

  for (const seed of SHOPS) {
    console.log(`\n/${seed.handle} — ${seed.name}`);

    // Cascades clear products, images, reviews, orders and visits with the shop.
    const existingShop = await db.query.shops.findFirst({
      where: eq(shops.handle, seed.handle),
    });
    if (existingShop) await db.delete(shops).where(eq(shops.id, existingShop.id));

    const existingUser = await db.query.user.findFirst({
      where: eq(user.email, seed.email),
    });
    if (existingUser) await db.delete(user).where(eq(user.id, existingUser.id));

    const userId = crypto.randomUUID();
    const now = new Date();
    await db.insert(user).values({
      id: userId,
      name: seed.ownerName,
      email: seed.email,
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

    const shop = firstRow(
      await db
        .insert(shops)
        .values({
          userId,
          handle: seed.handle,
          name: seed.name,
          description: seed.description,
          avatarUrl: seed.avatar,
          accentColor: seed.accentColor,
          theme: seed.theme,
          layout: seed.layout,
          currency: seed.currency,
          locale: seed.locale,
          location: seed.location,
          contactEmail: seed.contactEmail,
          collectAddress: seed.deliveries.some((d) => d.type === "shipping"),
          plan: seed.plan,
          subscriptionStatus: seed.plan === "free" ? null : "active",
          affiliatesEnabled: Boolean(seed.affiliate),
          affiliateDefaultBp: seed.affiliate?.bp ?? 1000,
          affiliatePublicSignup: Boolean(seed.affiliate),
          affiliateTerms: seed.affiliate?.terms ?? null,
          invoicePrefix: seed.invoicePrefix,
          socials: seed.socials,
          isPublished: true,
        })
        .returning(),
      "shop",
    );

    const insertedCategories = await db
      .insert(categories)
      .values(
        seed.categories.map((c, i) => ({
          shopId: shop.id,
          name: c.name,
          slug: c.slug,
          position: i,
        })),
      )
      .returning();
    const categoryBySlug = new Map(insertedCategories.map((c) => [c.slug, c.id]));

    const productIds: string[] = [];
    for (const [i, p] of seed.products.entries()) {
      const created = firstRow(
        await db
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
          .returning(),
        "product",
      );
      productIds.push(created.id);

      await db.insert(productImages).values(
        p.images.map((id, index) => ({
          productId: created.id,
          url: photo(id),
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
            isAvailable: true,
            position: index,
          })),
        );
      }

      if (p.files?.length) {
        await db.insert(productFiles).values(
          p.files.map((f, index) => ({
            productId: created.id,
            name: f.name,
            url: FILE_URL,
            sizeBytes: f.sizeBytes,
            contentType: f.name.endsWith(".zip")
              ? "application/zip"
              : f.name.endsWith(".epub")
                ? "application/epub+zip"
                : "application/pdf",
            position: index,
          })),
        );
      }
    }

    await db.insert(reviews).values(
      seed.reviews.map((r, i) => ({
        shopId: shop.id,
        productId: present(productIds[r.product], `product ${r.product}`),
        authorName: r.name,
        rating: r.rating,
        body: r.body,
        // One left pending so the moderation queue isn't empty in admin.
        isApproved: i < seed.reviews.length - 1,
        createdAt: daysAgo(i * 4 + 2),
      })),
    );

    await db.insert(paymentMethods).values(
      seed.payments.map((m, i) => ({
        shopId: shop.id,
        type: m.type,
        config: m.config,
        isEnabled: m.enabled ?? true,
        position: i + 1,
      })),
    );

    if (seed.deliveries.length) {
      await db.insert(deliveryMethods).values(
        seed.deliveries.map((d, i) => ({
          shopId: shop.id,
          type: d.type,
          name: d.name,
          feeCents: d.feeCents,
          freeOverCents: d.freeOverCents ?? null,
          config: d.config,
          isEnabled: true,
          position: i + 1,
        })),
      );
    }

    if (seed.coupons?.length) {
      await db.insert(coupons).values(
        seed.coupons.map((c) => ({
          shopId: shop.id,
          code: c.code,
          discountType: c.type,
          discountValue: c.value,
          isActive: true,
        })),
      );
    }

    if (seed.affiliate) {
      await db.insert(affiliates).values([
        {
          shopId: shop.id,
          name: "Maya Lindqvist",
          email: `maya+${seed.handle}@example.com`,
          code: `MAYA${seed.handle.slice(0, 3).toUpperCase()}`,
          status: "active",
          source: "signup",
          clicks: 96,
        },
        {
          shopId: shop.id,
          name: "The Weekly Five",
          email: `hello+${seed.handle}@example.com`,
          code: `WEEKLY${seed.handle.slice(0, 2).toUpperCase()}`,
          commissionBp: seed.affiliate.bp + 300,
          status: "pending",
          source: "signup",
          clicks: 11,
        },
      ]);
    }

    // A fortnight of traffic, so the admin dashboard isn't a row of zeroes when
    // someone signs into a demo account to look around.
    const visitRows: (typeof visits.$inferInsert)[] = [];
    const REFERRERS = ["https://instagram.com/", "https://tiktok.com/", "https://t.co/", null];
    for (let day = 13; day >= 0; day--) {
      const count =
        5 + Math.round(9 * Math.abs(Math.sin(day * 0.9 + seed.handle.length))) + (day % 3);
      for (let n = 0; n < count; n++) {
        visitRows.push({
          shopId: shop.id,
          productId: n % 3 === 0 ? productIds[(day + n) % productIds.length] : null,
          sessionId: `${seed.handle}-${day}-${Math.floor(n / 2)}`,
          referrer: REFERRERS[(day + n) % REFERRERS.length],
          country: ["IT", "KE", "ZA", "DE", "GB", "US"][(day + n) % 6],
          createdAt: daysAgo(day, n),
        });
      }
    }
    await db.insert(visits).values(visitRows);

    console.log(
      `  ${seed.products.length} products · ${seed.reviews.length} reviews · ` +
        `${seed.payments.length} rails · ${seed.deliveries.length} delivery · ${visitRows.length} visits`,
    );
  }

  console.log(`
✓ Showcase shops seeded

  ${SHOPS.map((s) => `/${s.handle}`).join("  ")}

  Sign in to any of them with ${PASSWORD}
  ${SHOPS.map((s) => s.email).join("\n  ")}
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
