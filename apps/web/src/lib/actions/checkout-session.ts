"use server";

import { cookies } from "next/headers";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { shops } from "@sailo/db/schema";
import { liveShop } from "@/lib/shop-visibility";
import { rateLimit } from "@sailo/rate-limit";
import { callerIp } from "@sailo/rate-limit/client-ip";
import { SESSION_TTL_MS } from "@sailo/commerce/recovery";
import {
  clientForEmail,
  markSessionError,
  markRevisited,
  openSession,
} from "@sailo/commerce/recovery/server";

/**
 * A row for every checkout a buyer opens — spec 32.
 *
 * The one new **public write** in the release, and it is treated as one
 * throughout. Three properties, each of which would be a bug if it were not
 * here:
 *
 * **Decision B: it fails closed.** This creates rows for anybody with a URL,
 * which is the first of the three kinds of endpoint §0.6 names. An hour of no
 * ceiling here is an hour of unbounded rows from one script, and — unlike the
 * checkout itself — nothing is lost by refusing: the buyer still checks out,
 * they simply do not become recoverable.
 *
 * **It is never an existence oracle.** The answer is the same sentence whether
 * the shop exists, is suspended, has recovery off, or accepted the row. A
 * caller learns nothing about a shop by pointing this at it.
 *
 * **It reads `verdict.reason`, not `verdict.allowed`.** A refusal under
 * `outage` is not an answer about this checkout, so nothing here treats it as
 * one — no row, no error the buyer sees, and the checkout carries on.
 */

/** The cookie carrying the opaque per-browser id. */
const VISITOR_COOKIE = "sailo_ck";

export type SessionState = { sessionId: string | null };

/**
 * The visitor key, minted on first sight.
 *
 * `httpOnly`, `SameSite=Lax`, first-party, and **not derived from anything
 * about the request**. A key built from IP and user agent would read a phone
 * that changed network mid-checkout as two buyers — the reasoning the download
 * rate limit already records — and would be a fingerprint rather than an id.
 *
 * It is not a cross-shop identifier either: every index that uses it is keyed
 * per shop, and no query in this feature joins sessions across shops.
 */
async function visitorKey(): Promise<string> {
  const jar = await cookies();
  const existing = jar.get(VISITOR_COOKIE)?.value;
  if (existing && /^[0-9a-f-]{36}$/.test(existing)) return existing;

  const key = randomUUID();
  jar.set(VISITOR_COOKIE, key, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
  return key;
}

/**
 * Records that a checkout was opened, or opened again.
 *
 * Returns the session id so the checkout can attribute a payment to it, and
 * `null` for every refusal — a shop that does not exist, one that is not live,
 * a ceiling, or a cache outage. The caller treats all four identically, which
 * is what keeps this from telling anybody anything.
 */
export async function recordCheckoutOpened(input: {
  shopId: string;
  productId?: string | null;
  email?: string | null;
  currency?: string | null;
  subtotalCents?: number | null;
}): Promise<SessionState> {
  const key = await visitorKey();

  /*
   * Keyed on the visitor rather than the address, and on the address as a
   * second bucket. One browser opening forty checkouts is a script; one
   * network opening forty is an office.
   *
   * `onOutage: "closed"` — Decision B. This is a public write, so a cache
   * outage that removed the ceiling would leave the endpoint unbounded, and
   * losing recovery rows for the length of an outage costs the seller a
   * follow-up rather than a sale.
   */
  const gate = await rateLimit(`ck-session:${key}`, 30, 3_600, { onOutage: "closed" });
  if (!gate.allowed) return { sessionId: null };

  const ipGate = await rateLimit(`ck-session-ip:${await callerIp()}`, 120, 3_600, {
    onOutage: "closed",
  });
  if (!ipGate.allowed) return { sessionId: null };

  const shop = await getDb().query.shops.findFirst({
    where: liveShop(eq(shops.id, input.shopId)),
    columns: { id: true },
  });
  // Same answer as every other refusal. Nothing here says whether the shop
  // exists, is suspended, or simply has recovery switched off.
  if (!shop) return { sessionId: null };

  const email = input.email?.trim().toLowerCase() || null;
  const session = await openSession({
    shopId: shop.id,
    visitorKey: key,
    productId: input.productId ?? null,
    email,
    /*
     * Tied to a known buyer when there is one, so the seller's session table
     * can name them. Only ever *this* shop's clients — the lookup is
     * shop-scoped, which is what keeps a recovery mail from ever reaching
     * somebody who is a customer of a different shop entirely.
     */
    clientId: email ? await clientForEmail(shop.id, email) : null,
    currency: input.currency ?? null,
    subtotalCents: input.subtotalCents ?? null,
  });

  return { sessionId: session?.id ?? null };
}

/**
 * A payment attempt failed.
 *
 * Called from the checkout panel with Stripe's decline code, which is
 * allowlisted in `sanitizeDecline` before it is stored — a raw provider string
 * rendered into the seller's panel is untrusted input on a page with a session
 * behind it.
 *
 * Deliberately no rate limit of its own: it can only ever narrow an existing
 * row, and the session id is a uuid the caller must already hold.
 */
export async function recordCheckoutFailed(input: {
  shopId: string;
  sessionId: string;
  decline?: string | null;
}): Promise<void> {
  await markSessionError({
    shopId: input.shopId,
    sessionId: input.sessionId,
    decline: input.decline ?? null,
  });
}

/** The buyer came back after a failure — `error` returns to `opened`. */
export async function recordCheckoutRetried(input: {
  shopId: string;
  sessionId: string;
}): Promise<void> {
  await markRevisited(input);
}
