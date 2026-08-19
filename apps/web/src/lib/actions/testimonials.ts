"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { shops } from "@sailo/db/schema";
import { requireShop } from "@/lib/session";
import { revalidateShop } from "@/lib/cache";
import { rateLimit } from "@sailo/rate-limit";
import { callerIp } from "@sailo/rate-limit/client-ip";
import { can, cheapestPlanWith, planFor } from "@sailo/core/plans";
import { isWallLayout } from "@sailo/marketing/testimonials";
import {
  addManualTestimonial,
  createWall,
  deleteTestimonial,
  deleteWall,
  listWalls,
  raiseTestimonialRequests,
  rotateEmbedKey,
  setTestimonialState,
  submitTestimonial,
  updateWall,
  type SubmitFailure,
} from "@sailo/marketing/testimonials/server";
import { sendTestimonialRequest } from "@/lib/email";
import { publishShopEvent } from "@sailo/events";
import type { ActionState } from "@sailo/core/action-state";

/**
 * Spec 35's writes: one public, the rest the seller's.
 *
 * The public one is the interesting one and it is written to the same rules as
 * `submitReview` next door — anonymous, creates a row, and the row is displayed
 * on somebody's storefront and inside a third party's website.
 */

/** What to say about a refused submission. One sentence per real cause. */
const SUBMIT_MESSAGES: Record<SubmitFailure, string> = {
  name: "Add your name so the shop knows who this is from.",
  empty: "Write a few words, or add a video link.",
  video: "That video link isn't one we can show — YouTube or Vimeo, please.",
  avatar: "That photo couldn't be used. Try uploading it again.",
  /*
   * One sentence for three causes — no such link, already used, expired. A page
   * that told them apart would tell whoever is trying tokens which of their
   * guesses were once real.
   */
  used: "This link isn't available any more.",
};

export async function submitTestimonialAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  /*
   * DECISION B — fails closed (public write).
   *
   * Anonymous, creates a row, and the row ends up on a seller's storefront and
   * inside a stranger's website. A ceiling that vanishes for an hour is an
   * hour of unbounded testimonial spam under somebody else's shop name — the
   * same argument `submitReview` makes, with a wider blast radius.
   */
  const gate = await rateLimit(`testimonial:${await callerIp()}`, 5, 3_600, {
    onOutage: "closed",
  });
  if (!gate.allowed) {
    return { ok: false, error: "Too many just now. Try again in a little while." };
  }

  const result = await submitTestimonial(String(formData.get("token") ?? ""), {
    authorName: formData.get("authorName"),
    authorRole: formData.get("authorRole"),
    body: formData.get("body"),
    videoUrl: formData.get("videoUrl"),
    avatarUrl: formData.get("avatarUrl"),
  });

  if (!result.ok) return { ok: false, error: SUBMIT_MESSAGES[result.reason] };

  /*
   * The seller is the only person who can act on this, and nothing tells them
   * otherwise — the same reason `submitReview` publishes an event. After the
   * response: the person who just wrote it should not wait on a dashboard.
   */
  after(() => publishShopEvent(result.testimonial.shopId, "review"));
  revalidatePath("/admin/testimonials");

  return { ok: true, message: "Thank you — the shop will take a look." };
}

/* -------------------------------------------------------------------------- */
/*  The seller's side                                                          */
/* -------------------------------------------------------------------------- */

/** Every seller-side write ends here: approving one changes a public page. */
async function published(shop: { id: string; handle: string }) {
  revalidatePath("/admin/testimonials");
  // The storefront section rides `shopTag`, so approving has to drop it or the
  // testimonial sits invisible until the cache ages out.
  revalidateShop(shop.id, shop.handle);
}

export async function moderateTestimonial(formData: FormData) {
  const { shop } = await requireShop("marketing:send");
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const action = String(formData.get("action") ?? "");
  if (action === "delete") {
    await deleteTestimonial(shop.id, id);
  } else if (action === "approve" || action === "unapprove") {
    await setTestimonialState(shop.id, id, { isApproved: action === "approve" });
  } else if (action === "feature" || action === "unfeature") {
    await setTestimonialState(shop.id, id, { isFeatured: action === "feature" });
  } else if (action === "position") {
    const position = Number(formData.get("position"));
    if (!Number.isInteger(position) || position < 0 || position > 999) return;
    await setTestimonialState(shop.id, id, { position });
  } else if (action === "wall") {
    const wallId = String(formData.get("wallId") ?? "") || null;
    // Scoped: a wall id from a form is checked against this shop's own walls
    // before a testimonial is moved onto it.
    const owned = wallId
      ? (await listWalls(shop.id)).some((w) => w.id === wallId)
      : true;
    if (!owned) return;
    await setTestimonialState(shop.id, id, { wallId });
  } else {
    return;
  }

  await published(shop);
}

export async function addTestimonial(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { shop } = await requireShop("marketing:send");
  if (!can(shop, "testimonials")) {
    const plan = cheapestPlanWith("testimonials");
    return { ok: false, error: `Testimonials are available on ${plan?.name ?? "a paid plan"}.` };
  }

  const result = await addManualTestimonial(
    shop.id,
    {
      authorName: formData.get("authorName"),
      authorRole: formData.get("authorRole"),
      body: formData.get("body"),
      videoUrl: formData.get("videoUrl"),
      avatarUrl: formData.get("avatarUrl"),
    },
    formData.get("source") === "imported" ? "imported" : "manual",
  );
  if (!result.ok) return { ok: false, error: SUBMIT_MESSAGES[result.reason] };

  await published(shop);
  return { ok: true, message: "Added." };
}

export async function addWall(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { shop } = await requireShop("marketing:send");
  if (!can(shop, "testimonials")) {
    const plan = cheapestPlanWith("testimonials");
    return { ok: false, error: `Testimonials are available on ${plan?.name ?? "a paid plan"}.` };
  }

  /*
   * The wall cap, and it says so rather than the button quietly failing.
   * `null` is unlimited; `0` never reaches here because the feature gate above
   * refuses first.
   */
  const limit = planFor(shop).limits.testimonialWalls;
  if (limit !== null && (await listWalls(shop.id)).length >= limit) {
    const plan = cheapestPlanWith("testimonialEmbed");
    return {
      ok: false,
      error: `Your plan keeps ${limit} wall. More than one is on ${plan?.name ?? "Business"}.`,
    };
  }

  const wall = await createWall(
    shop.id,
    String(formData.get("name") ?? ""),
    String(formData.get("headline") ?? "") || null,
  );
  if (!wall) return { ok: false, error: "Give the wall a name." };

  await published(shop);
  return { ok: true, message: "Wall created." };
}

export async function saveWall(formData: FormData) {
  const { shop } = await requireShop("marketing:send");
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const layout = String(formData.get("layout") ?? "");
  await updateWall(shop.id, id, {
    name: String(formData.get("name") ?? "").trim().slice(0, 80) || undefined,
    headline: String(formData.get("headline") ?? "").trim() || null,
    ...(isWallLayout(layout) ? { layout } : {}),
    isPublished: formData.get("isPublished") === "on",
  });
  await published(shop);
}

export async function rotateWallKey(formData: FormData) {
  const { shop } = await requireShop("marketing:send");
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await rotateEmbedKey(shop.id, id);
  await published(shop);
}

export async function removeWall(formData: FormData) {
  const { shop } = await requireShop("marketing:send");
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  // The testimonials survive — `wall_id` is `set null`, so deleting a wall
  // throws away the arrangement rather than the content.
  await deleteWall(shop.id, id);
  await published(shop);
}

export async function askForTestimonials(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { shop } = await requireShop("marketing:send");
  if (!can(shop, "testimonials")) {
    const plan = cheapestPlanWith("testimonials");
    return { ok: false, error: `Testimonials are available on ${plan?.name ?? "a paid plan"}.` };
  }

  const picked = formData
    .getAll("clientId")
    .map(String)
    .filter(Boolean)
    .slice(0, 200);
  if (picked.length === 0) return { ok: false, error: "Pick somebody to ask." };

  const db = getDb();
  const rows = await db.query.clients.findMany({
    where: (c, { and: all, eq: is, inArray }) =>
      all(is(c.shopId, shop.id), inArray(c.id, picked)),
    columns: { id: true, email: true, name: true },
  });

  const outcome = await raiseTestimonialRequests({
    shop,
    recipients: rows
      .filter((r): r is typeof r & { email: string } => Boolean(r.email))
      .map((r) => ({ email: r.email, clientId: r.id })),
  });

  /*
   * The mail goes out after the response and the tokens are handed back exactly
   * once — only their hashes are stored, so a failure here costs the request
   * rather than leaking a live link into a log.
   */
  const fresh = await db.query.shops.findFirst({ where: eq(shops.id, shop.id) });
  for (const one of outcome.sent) {
    after(() =>
      sendTestimonialRequest({
        shop: fresh ?? shop,
        to: one.email,
        url: `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/testimonial/${one.token}`,
      }),
    );
  }

  revalidatePath("/admin/testimonials");

  /*
   * No silent caps. A seller who picked forty and had eleven sent needs to know
   * which of the two reasons applied to the rest, because one of them is
   * "wait until tomorrow" and the other is "those people asked not to hear
   * from you".
   */
  const notes = [
    outcome.suppressed > 0 ? `${outcome.suppressed} unsubscribed or bounced` : null,
    outcome.overBudget > 0 ? `${outcome.overBudget} over today's sending limit` : null,
  ].filter(Boolean);

  return {
    ok: true,
    message:
      `Asked ${outcome.sent.length}.` +
      (notes.length ? ` Skipped: ${notes.join(", ")}.` : ""),
  };
}
