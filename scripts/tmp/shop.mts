import { getDb, schema } from "@/db";
import { eq, and } from "drizzle-orm";
const db = getDb();
const [s] = await db.select({
  id: schema.shops.id, handle: schema.shops.handle, pub: schema.shops.isPublished,
  susp: schema.shops.suspendedAt, plan: schema.shops.plan,
  stripeAcct: schema.shops.stripeAccountId, charges: schema.shops.stripeChargesEnabled,
}).from(schema.shops).where(eq(schema.shops.handle, "khaleel-musleh"));
console.log("shop:", s ?? "NOT FOUND IN THIS DATABASE");
if (s) {
  const pm = await db.select({ type: schema.paymentMethods.type, on: schema.paymentMethods.isEnabled, cfg: schema.paymentMethods.config })
    .from(schema.paymentMethods).where(eq(schema.paymentMethods.shopId, s.id));
  console.log("payment methods:");
  for (const m of pm) console.log(`   ${m.type.padEnd(10)} enabled=${m.on}  config=${JSON.stringify(m.cfg).slice(0,90)}`);
  const prods = await db.select({ id: schema.products.id, slug: schema.products.slug, pub: schema.products.isPublished, stock: schema.products.inStock })
    .from(schema.products).where(eq(schema.products.shopId, s.id));
  console.log("products:", prods);
}
