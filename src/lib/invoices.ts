import "server-only";
import { firstRow } from "@/lib/invariant";
import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { invoices, shops } from "@/db/schema";

/**
 * Claims the next invoice number for a shop. The increment and read happen in
 * one statement so two concurrent orders can't take the same number.
 */
async function claimNumber(shopId: string) {
  const db = getDb();
  const row = firstRow(await db
    .update(shops)
    .set({ invoiceNextNumber: sql`${shops.invoiceNextNumber} + 1` })
    .where(eq(shops.id, shopId))
    .returning({
      next: shops.invoiceNextNumber,
      prefix: shops.invoicePrefix,
    }), "row");

  // `next` is the post-increment value, so the number we claimed is one below.
  const claimed = row.next - 1;
  return `${row.prefix}-${String(claimed).padStart(4, "0")}`;
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Issues the invoice for an order. Safe to call more than once — the unique
 * index on order_id means a repeat call returns the existing invoice.
 */
export async function createInvoiceForOrder(shopId: string, orderId: string) {
  const db = getDb();

  const existing = await db.query.invoices.findFirst({
    where: eq(invoices.orderId, orderId),
  });
  if (existing) return existing;

  const number = await claimNumber(shopId);
  const invoice = firstRow(await db
    .insert(invoices)
    .values({ shopId, orderId, number, token: randomToken() })
    .onConflictDoNothing({ target: invoices.orderId })
    .returning(), "invoice");

  if (invoice) return invoice;

  // Lost a race — the other writer's invoice is the canonical one.
  return db.query.invoices.findFirst({ where: eq(invoices.orderId, orderId) });
}
