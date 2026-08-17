import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type * as messagesModule from "@/lib/email";
import type * as sessionModule from "@/lib/session";
import { and, eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import type { Shop } from "@sailo/db/schema";
import { clients, emailSuppressions, shops, user } from "@sailo/db/schema";
import { audienceFor, audienceSize, suppress } from "@sailo/marketing/broadcasts/server";
import { addClient } from "@/lib/actions/clients";
import { confirmSubscription, subscribeToShop } from "@/lib/actions/subscribe";
import { importClients } from "@/lib/import/clients";
import { assertLocalDatabase } from "./local-only";

/**
 * `marketing_consent_at`, from every direction that can reach it.
 *
 * The column is the whole of Sailo's lawful basis for sending marketing mail:
 * `audience.ts` will not put an address on a recipient list without it, so a
 * path that sets it wrongly does not fail loudly — it quietly widens who a
 * seller may mail, and the first anyone hears is a spam complaint against a
 * domain every other seller shares.
 *
 * Four modules write the column and no others (`consent-write-paths.test.ts`
 * pins that list from the source, so a fifth cannot appear unnoticed). This
 * file exercises what each of them actually writes, against a real database:
 *
 *   - a CSV import grants nothing, on the way in or on a re-import;
 *   - a contact typed into the admin grants nothing;
 *   - a checkout grants only what the shop asked for and the buyer ticked;
 *   - a signup grants only on the POST behind the emailed link, and refuses
 *     to lift a bounce or a complaint;
 *   - and the audience query excludes everyone the above left unconsented,
 *     in the count as well as in the list.
 *
 * The checkout matrix lives in `checkout.scenario.ts` beside the order
 * fixtures it needs; the rest is here.
 *
 * Run with:
 *   ./e2e/scenarios/up.sh
 *   npx vitest run --config vitest.scenarios.mts \
 *     e2e/scenarios/consent.scenario.ts
 */

const db = getDb();
const uid = () => crypto.randomUUID();

/*
 * The confirmation email, intercepted rather than sent.
 *
 * Not a convenience: the link inside it is the only thing that can grant
 * consent, so a test that cannot read the link cannot prove where consent
 * comes from. Letting the real transport run would just return
 * `RESEND_API_KEY is not set` and the whole flow would pass by never getting
 * far enough to write anything — the shape of test that proves nothing.
 */
const outbox = vi.hoisted(() => [] as { to: string; confirmUrl: string }[]);

vi.mock("@/lib/email", async (importOriginal) => ({
  ...(await importOriginal<typeof messagesModule>()),
  sendSubscribeConfirmation: async (
    opts: Parameters<typeof messagesModule.sendSubscribeConfirmation>[0],
  ) => {
    outbox.push({ to: opts.to, confirmUrl: opts.confirmUrl });
    return { sent: true as const, id: `scenario-${outbox.length}` };
  },
}));

/*
 * `addClient` guards itself with `requireShop()`, and that guard is not what
 * this file is testing — with no request there is no session, so it would
 * redirect before touching a row. Only that one read is replaced; everything
 * else in the module stays real.
 */
const signedIn = vi.hoisted(() => ({ shop: null as Shop | null }));

vi.mock("@/lib/session", async (importOriginal) => ({
  ...(await importOriginal<typeof sessionModule>()),
  requireShop: async () => {
    if (!signedIn.shop) throw new Error("fixture: no shop signed in");
    return {
      user: {
        id: "scenario-seller",
        email: "seller@example.com",
        emailVerified: true,
      },
      shop: signedIn.shop,
    };
  },
}));

beforeAll(() => {
  assertLocalDatabase();
});

beforeEach(() => {
  outbox.length = 0;
  signedIn.shop = null;
});

async function makeShop(over: Partial<typeof shops.$inferInsert> = {}) {
  const userId = uid();
  await db.insert(user).values({
    id: userId,
    name: "Seller",
    email: `consent-${userId.slice(0, 8)}@example.com`,
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const [shop] = await db
    .insert(shops)
    .values({
      userId,
      handle: `consent-${userId.slice(0, 8)}`,
      name: "Consent Shop",
      currency: "USD",
      isPublished: true,
      plan: "business",
      subscriptionStatus: "active",
      timeZone: "UTC",
      ...over,
    })
    .returning();
  if (!shop) throw new Error("fixture: shop was not inserted");
  return shop;
}

async function makeContact(
  shopId: string,
  email: string,
  over: Partial<typeof clients.$inferInsert> = {},
) {
  const [row] = await db
    .insert(clients)
    .values({
      shopId,
      name: email.split("@")[0] ?? "Contact",
      email,
      marketingConsentAt: new Date(),
      ...over,
    })
    .returning();
  if (!row) throw new Error("fixture: client was not inserted");
  return row;
}

const contact = (shopId: string, email: string) =>
  db.query.clients.findFirst({
    where: and(eq(clients.shopId, shopId), eq(clients.email, email)),
  });

const suppression = (shopId: string, email: string) =>
  db.query.emailSuppressions.findFirst({
    where: and(
      eq(emailSuppressions.shopId, shopId),
      eq(emailSuppressions.email, email),
    ),
  });

/**
 * The address of the confirmation link that was just emailed.
 *
 * Read back out of the URL rather than minted beside the test, so what gets
 * confirmed is the token a real subscriber would click and not one this file
 * signed for itself.
 */
function emailedToken(to: string): string {
  const message = outbox.find((m) => m.to === to);
  if (!message) throw new Error(`no confirmation email was sent to ${to}`);
  const segment = new URL(message.confirmUrl).pathname.split("/").at(-1);
  if (!segment) throw new Error(`no token in ${message.confirmUrl}`);
  return decodeURIComponent(segment);
}

async function submitSignup(handle: string, email: string, name?: string) {
  const form = new FormData();
  form.set("handle", handle);
  form.set("email", email);
  if (name) form.set("name", name);
  return subscribeToShop({ done: false }, form);
}

async function clickConfirm(token: string) {
  const form = new FormData();
  form.set("token", token);
  return confirmSubscription({ done: false }, form);
}

/* -------------------------------------------------------------------------- */

describe("a CSV import grants no consent, however the file is labelled", () => {
  /*
   * The create branch is pinned in `bookings-audience.scenario.ts`. What is
   * here is the branch that arrives second — the seller re-uploading the file
   * they exported, which is the ordinary way an import meets a row that
   * already exists.
   */
  it("leaves an existing contact unconsented, whatever the consent column says", async () => {
    const shop = await makeShop();
    await makeContact(shop.id, "quiet@example.com", { marketingConsentAt: null });

    const report = await importClients({
      shopId: shop.id,
      // Sailo's own export writes this header, so this is the file a seller
      // most plausibly re-uploads — with a date in it that they did not get
      // from the person it names.
      csv: [
        "Email,Name,Marketing Consent At",
        "quiet@example.com,Quiet,2020-01-01T00:00:00Z",
      ].join("\n"),
      dryRun: false,
    });

    expect(report.updated).toBe(1);
    expect((await contact(shop.id, "quiet@example.com"))?.marketingConsentAt).toBeNull();
    expect(await audienceSize(shop.id)).toBe(0);
  });

  /*
   * And the same branch from the other side. Grant-only is the rule
   * everywhere consent is written, so an import must not *revoke* one either:
   * a file with an empty consent column is a seller uploading a spreadsheet,
   * not a customer withdrawing anything. Withdrawal is unsubscribe.
   */
  it("does not revoke a consent the person themselves gave", async () => {
    const shop = await makeShop();
    const granted = new Date("2026-02-02T10:00:00Z");
    await makeContact(shop.id, "willing@example.com", {
      marketingConsentAt: granted,
    });

    await importClients({
      shopId: shop.id,
      csv: ["Email,Name,Marketing Consent At", "willing@example.com,Willing,"].join("\n"),
      dryRun: false,
    });

    const row = await contact(shop.id, "willing@example.com");
    expect(row?.marketingConsentAt?.getTime()).toBe(granted.getTime());
  });
});

describe("a contact typed into the admin grants no consent", () => {
  /*
   * A seller can attest that somebody is a customer. They cannot attest, on
   * that person's behalf, that they agreed to be marketed to — only a box
   * that person ticked can, and this form has no such box. So the row lands
   * unconsented and the broadcast audience will not reach it.
   */
  it("writes marketingConsentAt null and stays out of the audience", async () => {
    const shop = await makeShop();
    signedIn.shop = shop;

    const form = new FormData();
    form.set("name", "Ada");
    form.set("email", "typed@example.com");
    form.set("tags", "vip");

    const state = await addClient({ ok: false }, form);
    expect(state.ok).toBe(true);

    const row = await contact(shop.id, "typed@example.com");
    expect(row?.source).toBe("manual");
    expect(row?.marketingConsentAt).toBeNull();

    expect((await audienceFor(shop.id)).recipients).toHaveLength(0);
    expect(await audienceSize(shop.id)).toBe(0);
  });

  /*
   * And no field name gets round it. The form is `FormData` the browser
   * composed, so a hand-rolled POST can carry anything it likes; the insert
   * states the column rather than defaulting it, which is what makes the
   * extra key inert instead of merely unmentioned.
   */
  it("ignores a consent field posted by a hand-rolled request", async () => {
    const shop = await makeShop();
    signedIn.shop = shop;

    const form = new FormData();
    form.set("email", "forged@example.com");
    form.set("marketingConsentAt", new Date().toISOString());
    form.set("marketingOptIn", "on");

    expect((await addClient({ ok: false }, form)).ok).toBe(true);
    expect((await contact(shop.id, "forged@example.com"))?.marketingConsentAt).toBeNull();
  });
});

describe("a signup grants consent only on the POST behind the emailed link", () => {
  it("writes nothing at all when the form is submitted", async () => {
    const shop = await makeShop();

    const state = await submitSignup(shop.handle, "new@example.com", "Nadia");

    // The email went, so the action ran to the end rather than bailing early.
    expect(state.done).toBe(true);
    expect(outbox.map((m) => m.to)).toEqual(["new@example.com"]);

    // And still nobody is on the list. Anyone can type anyone's address into
    // a public form; the submission is a request, not a fact.
    expect(await contact(shop.id, "new@example.com")).toBeUndefined();
    expect(await audienceSize(shop.id)).toBe(0);
  });

  it("grants it when the link in that email is clicked", async () => {
    const shop = await makeShop();
    await submitSignup(shop.handle, "proven@example.com", "Nadia");

    expect(await clickConfirm(emailedToken("proven@example.com"))).toEqual({ done: true });

    const row = await contact(shop.id, "proven@example.com");
    expect(row?.source).toBe("subscribe");
    expect(row?.marketingConsentAt).not.toBeNull();
    expect((await audienceFor(shop.id)).recipients.map((r) => r.email)).toEqual([
      "proven@example.com",
    ]);
  });

  /*
   * Somebody who left may come back, and this is the only thing that lets
   * them: they asked, and proved it by clicking a link sent to their own
   * address. Without it an unsubscribe would be a life sentence.
   */
  it("lets an unsubscribed address back on, clearing the suppression", async () => {
    const shop = await makeShop();
    await makeContact(shop.id, "returning@example.com", { marketingConsentAt: null });
    await suppress({
      shopId: shop.id,
      email: "returning@example.com",
      reason: "unsubscribed",
    });

    await submitSignup(shop.handle, "returning@example.com");
    expect(await clickConfirm(emailedToken("returning@example.com"))).toEqual({ done: true });

    expect(await suppression(shop.id, "returning@example.com")).toBeUndefined();
    expect((await contact(shop.id, "returning@example.com"))?.marketingConsentAt).not.toBeNull();
  });

  /*
   * A bounce and a complaint are the two it must not lift.
   *
   * `broadcast-segments.scenario.ts` pins the refusal at `confirmSubscriber`.
   * This pins it at the action the page actually calls, and on the two things
   * the visitor cannot see: no consent was granted, and the suppression is
   * still there. The answer they *do* see is the same either way on purpose —
   * telling them a previous holder of the address reported the shop for spam
   * would disclose one person's action to whoever holds it today.
   */
  it.each(["bounced", "complained"] as const)(
    "refuses to resurrect an address that %s, and says the same thing anyway",
    async (reason) => {
      const shop = await makeShop();
      await suppress({ shopId: shop.id, email: "blocked@example.com", reason });

      await submitSignup(shop.handle, "blocked@example.com");
      expect(await clickConfirm(emailedToken("blocked@example.com"))).toEqual({ done: true });

      expect(await contact(shop.id, "blocked@example.com")).toBeUndefined();
      expect((await suppression(shop.id, "blocked@example.com"))?.reason).toBe(reason);
      expect(await audienceSize(shop.id)).toBe(0);
    },
  );

  /*
   * The token is the proof, so it has to be this shop's token. Without the
   * shop id inside the signature, a link confirmed for one seller would be a
   * link that adds the same person to another's list.
   */
  it("cannot be replayed against a different shop", async () => {
    const shop = await makeShop();
    const other = await makeShop();
    await submitSignup(shop.handle, "mine@example.com");

    await clickConfirm(emailedToken("mine@example.com"));

    expect(await contact(other.id, "mine@example.com")).toBeUndefined();
    expect(await audienceSize(other.id)).toBe(0);
  });
});

describe("the audience query is where all of that is enforced", () => {
  /*
   * The list and the count are asserted together every time.
   *
   * They share `mailable()` precisely so they cannot disagree, and a
   * disagreement is not a cosmetic bug: the seller is told they will reach 900
   * people and the send reaches 899, which reads as a broken send. Asserting
   * only the list would let the count drift.
   */
  it("excludes an unconsented contact from both the list and the count", async () => {
    const shop = await makeShop();
    await makeContact(shop.id, "yes@example.com");
    await makeContact(shop.id, "no@example.com", { marketingConsentAt: null });

    expect((await audienceFor(shop.id)).recipients.map((r) => r.email)).toEqual([
      "yes@example.com",
    ]);
    expect(await audienceSize(shop.id)).toBe(1);
  });

  it.each(["unsubscribed", "bounced", "complained"] as const)(
    "excludes a consented contact suppressed as %s from both",
    async (reason) => {
      const shop = await makeShop();
      await makeContact(shop.id, "gone@example.com");
      await makeContact(shop.id, "here@example.com");
      await suppress({ shopId: shop.id, email: "gone@example.com", reason });

      expect((await audienceFor(shop.id)).recipients.map((r) => r.email)).toEqual([
        "here@example.com",
      ]);
      expect(await audienceSize(shop.id)).toBe(1);
    },
  );

  /*
   * Suppression is matched on the folded address, and consent is not enough
   * to outrank it. A checkout that stored `Gone@Example.com` and an
   * unsubscribe that folded to `gone@example.com` are one person to everybody
   * except an equality test.
   */
  it("matches the suppression on the folded address, not the stored casing", async () => {
    const shop = await makeShop();
    await makeContact(shop.id, "Gone@Example.com");
    await suppress({ shopId: shop.id, email: "gone@example.com", reason: "unsubscribed" });

    expect((await audienceFor(shop.id)).recipients).toHaveLength(0);
    expect(await audienceSize(shop.id)).toBe(0);
  });
});
