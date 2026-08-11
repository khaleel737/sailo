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
import { firstRow } from "@/lib/invariant";
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
  { name: "Bakery", slug: "bakery" },
  { name: "Coffee", slug: "coffee" },
  { name: "Clothing", slug: "clothing" },
  { name: "Accessories", slug: "accessories" },
  { name: "Home", slug: "home" },
  { name: "Beauty", slug: "beauty" },
  { name: "Wellness", slug: "wellness" },
  { name: "Fitness", slug: "fitness" },
  { name: "Lessons", slug: "lessons" },
  { name: "Trades", slug: "trades" },
  { name: "Ebooks", slug: "ebooks" },
  { name: "Courses", slug: "courses" },
  { name: "Templates", slug: "templates" },
  { name: "Audio", slug: "audio" },
  { name: "Photography", slug: "photography" },
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
  /* ---- Kitchen & bakery: food, the two-axis case ------------------------ */
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
    title: "Diavola pizza",
    category: "kitchen",
    kind: "physical",
    priceCents: 1400,
    description: "Spicy salami, chilli honey, a lot of oregano.",
    tags: ["pizza", "food"],
    images: ["pizza-b"],
    options: [{ name: "Size", values: ['9"', '12"'] }],
    variants: [
      { options: { Size: '9"' }, sku: "DV-9" },
      { options: { Size: '12"' }, priceCents: 1800, sku: "DV-12" },
    ],
  },
  {
    title: "Smash burger and fries",
    category: "kitchen",
    kind: "physical",
    priceCents: 1250,
    description: "Two thin patties, American cheese, pickles, house sauce.",
    tags: ["burger", "food"],
    images: ["burger-a"],
    options: [{ name: "Patties", values: ["Double", "Triple"] }],
    trackInventory: true,
    variants: [
      { options: { Patties: "Double" }, stock: 14, sku: "BR-2" },
      { options: { Patties: "Triple" }, priceCents: 1550, stock: 6, sku: "BR-3" },
    ],
  },
  {
    title: "Sushi platter for two",
    category: "kitchen",
    kind: "physical",
    priceCents: 3800,
    description: "Sixteen pieces, cut to order. Ginger and wasabi included.",
    tags: ["sushi", "food", "sharing"],
    images: ["sushi-a", "sushi-a2"],
    trackInventory: true,
    stockQuantity: 5,
  },
  {
    title: "Cinnamon buns — box of six",
    category: "bakery",
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
  {
    title: "Sourdough loaf",
    category: "bakery",
    kind: "physical",
    priceCents: 750,
    description: "Twenty-four hour ferment, blistered crust, open crumb.",
    tags: ["bread", "bakery"],
    images: ["bread-a"],
    trackInventory: true,
    stockQuantity: 12,
  },
  {
    title: "Birthday cake",
    category: "bakery",
    kind: "physical",
    priceCents: 4200,
    description: "Vanilla sponge, Swiss meringue buttercream, your message piped on.",
    tags: ["cake", "bakery", "celebration"],
    images: ["cake-a", "cake-a2"],
    options: [
      { name: "Size", values: ["6 inch", "8 inch", "10 inch"] },
      { name: "Sponge", values: ["Vanilla", "Chocolate"] },
    ],
    variants: [
      { options: { Size: "6 inch", Sponge: "Vanilla" }, sku: "CK-6-V" },
      { options: { Size: "6 inch", Sponge: "Chocolate" }, sku: "CK-6-C" },
      { options: { Size: "8 inch", Sponge: "Vanilla" }, priceCents: 5600, sku: "CK-8-V" },
      { options: { Size: "8 inch", Sponge: "Chocolate" }, priceCents: 5600, sku: "CK-8-C" },
      { options: { Size: "10 inch", Sponge: "Vanilla" }, priceCents: 7400, sku: "CK-10-V" },
      { options: { Size: "10 inch", Sponge: "Chocolate" }, priceCents: 7400, sku: "CK-10-C" },
    ],
  },
  {
    title: "Almond croissant",
    category: "bakery",
    kind: "physical",
    priceCents: 480,
    description: "Yesterday's croissant, soaked, filled and baked again. Better for it.",
    tags: ["pastry", "bakery"],
    images: ["croissant-a"],
    trackInventory: true,
    stockQuantity: 2,
  },
  {
    title: "Single origin beans — 250g",
    category: "coffee",
    kind: "physical",
    priceCents: 1600,
    compareAtCents: 1900,
    description: "Washed Ethiopian, roasted last Tuesday. Peach, jasmine, black tea.",
    tags: ["coffee", "beans"],
    images: ["beans-a", "beans-a2"],
    featured: true,
    options: [
      { name: "Grind", values: ["Whole bean", "Filter", "Espresso"] },
      { name: "Size", values: ["250g", "1kg"] },
    ],
    trackInventory: true,
    variants: [
      { options: { Grind: "Whole bean", Size: "250g" }, stock: 25, sku: "CF-WB-250" },
      { options: { Grind: "Whole bean", Size: "1kg" }, priceCents: 5200, stock: 8, sku: "CF-WB-1K" },
      { options: { Grind: "Filter", Size: "250g" }, stock: 18, sku: "CF-FL-250" },
      { options: { Grind: "Filter", Size: "1kg" }, priceCents: 5200, stock: 4, sku: "CF-FL-1K" },
      { options: { Grind: "Espresso", Size: "250g" }, stock: 11, sku: "CF-ES-250" },
      { options: { Grind: "Espresso", Size: "1kg" }, priceCents: 5200, stock: 0, sku: "CF-ES-1K" },
    ],
  },
  {
    title: "Monthly coffee subscription",
    category: "coffee",
    kind: "physical",
    priceCents: 2400,
    description: "A different roast every month, posted the day after roasting.",
    tags: ["coffee", "subscription"],
    images: ["subscription-a"],
  },
  {
    title: "Ceramic pour-over dripper",
    category: "coffee",
    kind: "physical",
    priceCents: 3400,
    description: "Single cup, ribbed cone, sits on any mug. Dishwasher safe.",
    tags: ["coffee", "brewing"],
    images: ["dripper-a"],
    options: [{ name: "Colour", values: ["Chalk", "Slate"] }],
    variants: [
      { options: { Colour: "Chalk" }, sku: "DR-CHK" },
      { options: { Colour: "Slate" }, sku: "DR-SLT" },
    ],
  },

  /* ---- Clothing & accessories: the size × colour grid -------------------- */
  {
    title: "Oversized heavyweight tee",
    category: "clothing",
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
      // Not made in this combination at all, so it isn't for sale.
      { options: { Size: "XL", Colour: "Sand" }, stock: 0, available: false, sku: "TEE-XL-SND" },
    ],
  },
  {
    title: "Heavy fleece hoodie",
    category: "clothing",
    kind: "physical",
    priceCents: 6800,
    description: "450gsm loopback, twin-needle seams, no drawcord tips to lose.",
    tags: ["clothing", "hoodie"],
    images: ["hoodie-a", "hoodie-a2"],
    options: [
      { name: "Size", values: ["S", "M", "L", "XL"] },
      { name: "Colour", values: ["Ecru", "Navy"] },
    ],
    trackInventory: true,
    variants: [
      { options: { Size: "S", Colour: "Ecru" }, stock: 4, sku: "HD-S-ECR" },
      { options: { Size: "S", Colour: "Navy" }, stock: 3, sku: "HD-S-NVY" },
      { options: { Size: "M", Colour: "Ecru" }, stock: 9, sku: "HD-M-ECR" },
      { options: { Size: "M", Colour: "Navy" }, stock: 6, sku: "HD-M-NVY" },
      { options: { Size: "L", Colour: "Ecru" }, stock: 2, sku: "HD-L-ECR" },
      { options: { Size: "L", Colour: "Navy" }, stock: 8, sku: "HD-L-NVY" },
      { options: { Size: "XL", Colour: "Ecru" }, stock: 0, sku: "HD-XL-ECR" },
      { options: { Size: "XL", Colour: "Navy" }, stock: 5, sku: "HD-XL-NVY" },
    ],
  },
  {
    title: "Wide-leg trousers",
    category: "clothing",
    kind: "physical",
    priceCents: 7400,
    description: "Washed cotton twill, elasticated back, deep enough pockets.",
    tags: ["clothing", "trousers"],
    images: ["trousers-a"],
    options: [{ name: "Size", values: ["28", "30", "32", "34", "36"] }],
    trackInventory: true,
    variants: [
      { options: { Size: "28" }, stock: 3, sku: "TR-28" },
      { options: { Size: "30" }, stock: 7, sku: "TR-30" },
      { options: { Size: "32" }, stock: 9, sku: "TR-32" },
      { options: { Size: "34" }, stock: 4, sku: "TR-34" },
      { options: { Size: "36" }, stock: 0, sku: "TR-36" },
    ],
  },
  {
    title: "Linen shirt dress",
    category: "clothing",
    kind: "physical",
    priceCents: 8900,
    compareAtCents: 11000,
    description: "European linen, mother of pearl buttons, belt if you want one.",
    tags: ["clothing", "linen", "dress"],
    images: ["dress-a", "dress-a2"],
    options: [{ name: "Size", values: ["XS", "S", "M", "L"] }],
    variants: [
      { options: { Size: "XS" }, sku: "DR-XS" },
      { options: { Size: "S" }, sku: "DR-S" },
      { options: { Size: "M" }, sku: "DR-M" },
      { options: { Size: "L" }, sku: "DR-L" },
    ],
  },
  {
    title: "Merino socks — three pack",
    category: "clothing",
    kind: "physical",
    priceCents: 2400,
    description: "Ribbed, reinforced heel, warm without the itch.",
    tags: ["socks", "merino"],
    images: ["socks-a"],
    options: [{ name: "Size", values: ["36–39", "40–43", "44–47"] }],
    trackInventory: true,
    variants: [
      { options: { Size: "36–39" }, stock: 15, sku: "SK-S" },
      { options: { Size: "40–43" }, stock: 22, sku: "SK-M" },
      { options: { Size: "44–47" }, stock: 9, sku: "SK-L" },
    ],
  },
  {
    title: "Six-panel cap",
    category: "clothing",
    kind: "physical",
    priceCents: 2800,
    description: "Unstructured, cotton twill, brass adjuster at the back.",
    tags: ["cap", "clothing"],
    images: ["cap-a"],
    options: [{ name: "Colour", values: ["Black", "Washed denim", "Olive"] }],
    variants: [
      { options: { Colour: "Black" }, sku: "CP-BLK" },
      { options: { Colour: "Washed denim" }, sku: "CP-DNM" },
      { options: { Colour: "Olive" }, sku: "CP-OLV" },
    ],
  },
  {
    title: "Canvas tote",
    category: "accessories",
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
    title: "Leather card holder",
    category: "accessories",
    kind: "physical",
    priceCents: 3600,
    description: "Vegetable-tanned, four slots, darkens where you hold it.",
    tags: ["leather", "wallet"],
    images: ["wallet-a"],
    options: [{ name: "Colour", values: ["Tan", "Black"] }],
    trackInventory: true,
    variants: [
      { options: { Colour: "Tan" }, stock: 6, sku: "CH-TAN" },
      { options: { Colour: "Black" }, stock: 1, sku: "CH-BLK" },
    ],
  },
  {
    title: "Silver hoop earrings",
    category: "accessories",
    kind: "physical",
    priceCents: 4200,
    description: "Recycled sterling silver, 20mm, hollow so they don't drag.",
    tags: ["jewellery", "silver"],
    images: ["earrings-a"],
    trackInventory: true,
    stockQuantity: 4,
  },
  {
    title: "Linen apron",
    category: "accessories",
    kind: "physical",
    priceCents: 4800,
    description: "Washed linen, cross-back straps, one deep pocket. Softens with use.",
    tags: ["apron", "linen"],
    images: ["apron-b"],
    // Plain product, sold out — the simplest state there is.
    inStock: false,
  },

  /* ---- Home -------------------------------------------------------------- */
  {
    title: "Soy candle — 220g",
    category: "home",
    kind: "physical",
    priceCents: 2600,
    description: "Forty hours of burn time, cotton wick, reusable glass.",
    tags: ["candle", "home"],
    images: ["candle-a", "candle-a2"],
    options: [{ name: "Scent", values: ["Fig", "Cedar", "Sea salt"] }],
    trackInventory: true,
    variants: [
      { options: { Scent: "Fig" }, stock: 12, sku: "CN-FIG" },
      { options: { Scent: "Cedar" }, stock: 5, sku: "CN-CDR" },
      { options: { Scent: "Sea salt" }, stock: 0, sku: "CN-SLT" },
    ],
  },
  {
    title: "Stoneware mug",
    category: "home",
    kind: "physical",
    priceCents: 2200,
    description: "Speckled glaze, holds 350ml, comfortable handle.",
    tags: ["mug", "ceramic"],
    images: ["mug-c"],
    options: [{ name: "Glaze", values: ["Oatmeal", "Cobalt"] }],
    variants: [
      { options: { Glaze: "Oatmeal" }, sku: "MG-OAT" },
      { options: { Glaze: "Cobalt" }, priceCents: 2400, sku: "MG-COB" },
    ],
  },
  {
    title: "Monstera in a nursery pot",
    category: "home",
    kind: "physical",
    priceCents: 3200,
    description: "About 60cm tall. Bright indirect light, water when the top dries.",
    tags: ["plant", "home"],
    images: ["plant-a"],
    trackInventory: true,
    stockQuantity: 7,
  },
  {
    title: "Wool throw",
    category: "home",
    kind: "physical",
    priceCents: 9500,
    description: "Lambswool, herringbone weave, hand-finished fringe. 130 × 180cm.",
    tags: ["wool", "home"],
    images: ["throw-a"],
    trackInventory: true,
    stockQuantity: 2,
  },
  {
    title: "Riso print — A2",
    category: "home",
    kind: "physical",
    priceCents: 3500,
    description: "Two-colour risograph on 120gsm recycled stock. Signed, edition of 50.",
    tags: ["print", "art"],
    images: ["print-b"],
  },

  /* ---- Beauty, wellness, fitness: bookings ------------------------------- */
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
    title: "Hot stone massage",
    category: "wellness",
    kind: "service",
    priceCents: 7500,
    description: "Basalt stones, long strokes, ninety minutes you'll sleep well after.",
    tags: ["massage", "wellness"],
    images: ["stones-a"],
    durationMinutes: 90,
    serviceMode: "in_person",
    serviceLocation: "Studio B, 14 Ardmore Lane.",
    bookingEnabled: true,
    bookingLeadHours: 48,
  },
  {
    title: "Facial — deep cleanse",
    category: "beauty",
    kind: "service",
    priceCents: 5500,
    description: "Double cleanse, gentle extraction, mask and massage. Skin calm afterwards.",
    tags: ["facial", "beauty"],
    images: ["facial-a"],
    durationMinutes: 50,
    serviceMode: "in_person",
    serviceLocation: "Ground floor treatment room, 14 Ardmore Lane.",
    bookingEnabled: true,
    bookingLeadHours: 24,
  },
  {
    title: "Cut and finish",
    category: "beauty",
    kind: "service",
    priceCents: 4500,
    description: "Consultation, wash, cut and a finish you can repeat at home.",
    tags: ["hair", "beauty"],
    images: ["haircut-a"],
    durationMinutes: 45,
    serviceMode: "in_person",
    serviceLocation: "Chair 2, 14 Ardmore Lane.",
    bookingEnabled: true,
    bookingLeadHours: 12,
    options: [{ name: "Hair length", values: ["Short", "Long"] }],
    variants: [
      { options: { "Hair length": "Short" }, sku: "CUT-SH" },
      { options: { "Hair length": "Long" }, priceCents: 6000, sku: "CUT-LG" },
    ],
  },
  {
    title: "Gel manicure",
    category: "beauty",
    kind: "service",
    priceCents: 3200,
    description: "Shape, cuticle work, two coats and a top coat. Lasts about three weeks.",
    tags: ["nails", "beauty"],
    images: ["nails-a"],
    durationMinutes: 40,
    serviceMode: "in_person",
    serviceLocation: "14 Ardmore Lane.",
    bookingEnabled: true,
    bookingLeadHours: 6,
  },
  {
    title: "Morning yoga — live online",
    category: "fitness",
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
    title: "Personal training session",
    category: "fitness",
    kind: "service",
    priceCents: 5000,
    description: "One to one, programmed around what you can actually get to each week.",
    tags: ["training", "fitness"],
    images: ["pt-a"],
    durationMinutes: 60,
    serviceMode: "in_person",
    serviceLocation: "Ardmore Strength, unit 7.",
    bookingEnabled: true,
    bookingLeadHours: 24,
    options: [{ name: "Block", values: ["Single session", "Five sessions"] }],
    variants: [
      { options: { Block: "Single session" }, sku: "PT-1" },
      { options: { Block: "Five sessions" }, priceCents: 22500, sku: "PT-5" },
    ],
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

  /* ---- Lessons and trades ------------------------------------------------ */
  {
    title: "Guitar lesson",
    category: "lessons",
    kind: "service",
    priceCents: 3500,
    description: "Whatever you want to play, broken down until your hands can do it.",
    tags: ["music", "lesson"],
    images: ["guitar-a"],
    durationMinutes: 45,
    serviceMode: "in_person",
    serviceLocation: "Room 3, Ardmore Music.",
    bookingEnabled: true,
    bookingLeadHours: 24,
  },
  {
    title: "Spanish conversation hour",
    category: "lessons",
    kind: "service",
    priceCents: 2800,
    description: "An hour of talking, gentle correction, no textbook.",
    tags: ["language", "online"],
    images: ["spanish-a"],
    durationMinutes: 60,
    serviceMode: "online",
    serviceLocation: "Video link sent on confirmation.",
    bookingEnabled: true,
    bookingLeadHours: 12,
  },
  {
    title: "Maths tutoring — GCSE",
    category: "lessons",
    kind: "service",
    priceCents: 3000,
    description: "Past papers, worked through slowly, until the marks stop leaking.",
    tags: ["tutoring", "online"],
    images: ["maths-a"],
    durationMinutes: 60,
    serviceMode: "online",
    serviceLocation: "Video link and a shared whiteboard.",
    bookingEnabled: true,
    bookingLeadHours: 24,
  },
  {
    title: "Portrait session",
    category: "photography",
    kind: "service",
    priceCents: 15000,
    description:
      "Ninety minutes, two locations, twenty edited frames delivered within a week.",
    tags: ["photography", "portrait"],
    images: ["portrait-a", "portrait-a2"],
    featured: true,
    durationMinutes: 90,
    serviceMode: "in_person",
    serviceLocation: "We'll agree the meeting point once the date is set.",
    bookingEnabled: true,
    bookingLeadHours: 72,
  },
  {
    title: "Deep clean — two bedroom",
    category: "trades",
    kind: "service",
    priceCents: 12000,
    description: "Three hours, two cleaners, inside the oven and behind the appliances.",
    tags: ["cleaning", "home"],
    images: ["cleaning-a"],
    durationMinutes: 180,
    serviceMode: "in_person",
    serviceLocation: "Your address — we'll confirm access arrangements by message.",
    bookingEnabled: true,
    bookingLeadHours: 48,
  },
  {
    title: "Dog walking — one hour",
    category: "trades",
    kind: "service",
    priceCents: 1800,
    description: "Off-lead if they're good with it, photo sent when we get back.",
    tags: ["dogs", "walking"],
    images: ["dog-a"],
    durationMinutes: 60,
    serviceMode: "in_person",
    serviceLocation: "Collection from your door.",
    bookingEnabled: true,
    bookingLeadHours: 12,
  },
  {
    title: "Bike service",
    category: "trades",
    kind: "service",
    priceCents: 6500,
    description: "Gears, brakes, bearings, true the wheels. Same-day if it's in by nine.",
    tags: ["bike", "repair"],
    images: ["bike-a"],
    durationMinutes: 120,
    serviceMode: "in_person",
    serviceLocation: "Drop off at the workshop, 22 Bridge Street.",
    bookingEnabled: true,
    bookingLeadHours: 24,
  },

  /* ---- Downloads: ebooks, courses, templates, audio ---------------------- */
  {
    title: "The Sourdough Year — ebook",
    category: "ebooks",
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
    title: "Thirty Weeknight Dinners — ebook",
    category: "ebooks",
    kind: "digital",
    priceCents: 1200,
    description: "Thirty recipes, none longer than a page, all done inside forty minutes.",
    tags: ["ebook", "cooking"],
    images: ["cookbook-a"],
    files: [
      { name: "Thirty Weeknight Dinners.pdf", url: FILE, sizeBytes: 13_264, contentType: "application/pdf" },
    ],
    releaseOnPayment: true,
    downloadLimit: 5,
  },
  {
    title: "Weekly meal planner — free template",
    category: "templates",
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
  {
    title: "Invoice and quote templates",
    category: "templates",
    kind: "digital",
    priceCents: 900,
    description: "Six documents a small business actually needs, in editable files.",
    tags: ["template", "business"],
    images: ["invoice-a"],
    files: [
      { name: "Business templates.pdf", url: FILE, sizeBytes: 13_264, contentType: "application/pdf" },
    ],
    releaseOnPayment: true,
    downloadLimit: 3,
    downloadExpiryDays: 30,
  },
  {
    title: "Lightroom presets — film pack",
    category: "photography",
    kind: "digital",
    priceCents: 2900,
    description: "Twelve presets built from scans, plus the profiles they depend on.",
    tags: ["presets", "photography", "download"],
    images: ["presets-a"],
    options: [{ name: "Licence", values: ["Personal", "Commercial"] }],
    variants: [
      { options: { Licence: "Personal" }, sku: "LR-PERS" },
      { options: { Licence: "Commercial" }, priceCents: 7900, sku: "LR-COMM" },
    ],
    files: [
      { name: "Film pack presets.zip", url: FILE, sizeBytes: 13_264, contentType: "application/zip" },
    ],
    releaseOnPayment: true,
    downloadLimit: 4,
    downloadExpiryDays: 60,
  },
  {
    title: "Learn film photography — video course",
    category: "courses",
    kind: "digital",
    priceCents: 8900,
    compareAtCents: 12000,
    description: "Four hours across eleven lessons, from loading a roll to scanning it.",
    tags: ["course", "photography", "video"],
    images: ["course-a", "course-a2"],
    files: [
      { name: "Course workbook.pdf", url: FILE, sizeBytes: 13_264, contentType: "application/pdf" },
    ],
    releaseOnPayment: true,
    downloadLimit: 10,
    downloadExpiryDays: 365,
  },
  {
    title: "Start a shop — mini course",
    category: "courses",
    kind: "digital",
    priceCents: 4900,
    description: "Six short lessons on pricing, photos and getting the first ten orders.",
    tags: ["course", "business"],
    images: ["minicourse-a"],
    files: [
      { name: "Start a shop workbook.pdf", url: FILE, sizeBytes: 13_264, contentType: "application/pdf" },
    ],
    releaseOnPayment: true,
    downloadLimit: 6,
  },
  {
    title: "Lo-fi sample pack",
    category: "audio",
    kind: "digital",
    priceCents: 1500,
    description: "120 loops and 40 one-shots, royalty free, 24-bit WAV.",
    tags: ["samples", "music", "download"],
    images: ["samples-a"],
    files: [
      { name: "Lo-fi sample pack.zip", url: FILE, sizeBytes: 13_264, contentType: "application/zip" },
    ],
    releaseOnPayment: true,
    downloadLimit: 3,
    downloadExpiryDays: 45,
  },
  {
    title: "Guided sleep meditation",
    category: "audio",
    kind: "digital",
    priceCents: 700,
    description: "Thirty-two minutes, recorded properly, no music underneath.",
    tags: ["audio", "wellness"],
    images: ["meditation-a"],
    files: [
      { name: "Sleep meditation.mp3", url: FILE, sizeBytes: 13_264, contentType: "audio/mpeg" },
    ],
    releaseOnPayment: false,
  },
  {
    title: "Wallpaper pack — twenty-four phones",
    category: "templates",
    kind: "digital",
    priceCents: 500,
    description: "Twenty-four abstracts, sized for every phone made in the last five years.",
    tags: ["wallpaper", "download"],
    images: ["wallpaper-a"],
    files: [
      { name: "Wallpapers.zip", url: FILE, sizeBytes: 13_264, contentType: "application/zip" },
    ],
    releaseOnPayment: true,
    downloadLimit: 5,
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
  const shop = firstRow(await db
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
Seeded /${HANDLE} — ${PRODUCTS.length} products across sixteen categories.

  Shop        http://localhost:3000/${HANDLE}
  Referral    http://localhost:3000/${HANDLE}?ref=NADIA
  Coupons     TASTE15 (15% over $20) · FIVER ($5 off)
  Login       ${EMAIL} / ${PASSWORD}

  Physical    pizza, burgers, bread, cake, coffee, clothing, home
  Services    massage, facial, haircut, PT, tutoring, cleaning, dog walking
  Digital     ebooks, a video course, presets, samples, templates
  Variants    size × crust, size × colour, grind × weight, format, licence
  Bookings    in person and online, 6h to 72h notice
  Stock       counted per variant and per product, some sold out
`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
