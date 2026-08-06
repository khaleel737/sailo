import { getDb, schema } from "@/db";
import { eq, desc } from "drizzle-orm";
const db = getDb();
const [s] = await db.select({ id: schema.shops.id }).from(schema.shops).where(eq(schema.shops.handle, "khaleel-musleh"));
const rows = await db.select({
  id: schema.orders.id, name: schema.orders.customerName, email: schema.orders.customerEmail,
  method: schema.orders.paymentMethod, status: schema.orders.status,
  pay: schema.orders.paymentStatus, at: schema.orders.createdAt,
}).from(schema.orders).where(eq(schema.orders.shopId, s!.id)).orderBy(desc(schema.orders.createdAt)).limit(6);
console.log(`orders for khaleel-musleh: ${rows.length}`);
for (const r of rows) console.log(`  ${r.at.toISOString()}  ${String(r.name).slice(0,28).padEnd(28)} ${r.method}  ${r.status}/${r.pay}`);
