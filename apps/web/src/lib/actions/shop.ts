"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { after } from "next/server";
import { toCurrencyCode } from "@sailo/core/currency";
import { normalizeOfferedCurrencies } from "@sailo/core/regional";
import { can } from "@sailo/core/plans";
import { normalizeCountry } from "@sailo/core/countries";
import { revalidateShop } from "@/lib/cache";
import { publishHqEvent, publishShopEvent } from "@sailo/events";
import { redirect } from "next/navigation";
import { eq, } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { paymentMethods, shops, type Shop } from "@sailo/db/schema";
import { fetchExternalBusy, forgetExternalBusy, isCalendarFeedUrl, normalizeFeedUrl } from "@sailo/commerce/booking/server";
import { setMarketingOptIn } from "@sailo/marketing/lifecycle/server";
import { isStaff, requireShop, requireUser } from "@/lib/session";
import { normalizePhone } from "@sailo/core/phone";
import { isPublicLinkUrl } from "@sailo/storage/urls";
import { rateLimit } from "@sailo/rate-limit";
import { checkDescriptor, type DescriptorProblem } from "@sailo/core/disputes";
import { callerIp } from "@sailo/rate-limit/client-ip";
import { BRAND_HANDLE, HANDLE_MESSAGES, normalizeHandle, validateHandleFormat } from "@sailo/core/handle";
import { readPixelIds } from "@sailo/customers/pixels";
import { attributeReferral } from "@sailo/partners/store";
import { REFERRAL_COOKIE } from "@sailo/partners/program";

/**
 * What the calendar-feed field means, given that it is a secret.
 *
 * The stored URL is a bearer token for the seller's whole calendar, so the
 * form never renders it back — which means a blank field cannot mean "clear
 * it", the way a blank field means that everywhere else on this form. Blank
 * is "leave what is there"; clearing is its own checkbox. Getting this
 * backwards would disconnect a seller's calendar every time they saved an
 * unrelated setting, and the symptom — slots quietly reappearing — is one
 * nobody notices until a buyer books over something.
 */
async function readCalendarFeed(
  formData: FormData,
  shop: Pick<Shop, "id" | "timeZone" | "calendarFeedUrl">,
): Promise<
  | { ok: false; error: string }
  | { ok: true; changed: false }
  | {
      ok: true;
      changed: true;
      values: Pick<
        Shop,
        "calendarFeedUrl" | "calendarFeedCheckedAt" | "calendarFeedError"
      >;
    }
> {
  if (formData.get("calendarFeedRemove") === "on") {
    return {
      ok: true,
      changed: true,
      values: {
        calendarFeedUrl: null,
        calendarFeedCheckedAt: null,
        calendarFeedError: null,
      },
    };
  }

  const raw = String(formData.get("calendarFeedUrl") ?? "").trim();
  if (!raw) return { ok: true, changed: false };

  const url = normalizeFeedUrl(raw);
  if (!isCalendarFeedUrl(url)) {
    return {
      ok: false,
      error:
        "That calendar link must be a public https:// or webcal:// address.",
    };
  }

  /*
   * Fetched once, here, so the seller finds out now rather than from a
   * double booking. A feed that cannot be read is still *stored* — the URL
   * may be right and the provider merely down — but the failure is stamped
   * beside it and the settings card says so.
   */
  const now = new Date();
  const probe = await fetchExternalBusy({
    url,
    timeZone: shop.timeZone,
    from: new Date(now.getTime() - 24 * 3_600_000),
    to: new Date(now.getTime() + 7 * 24 * 3_600_000),
  });

  return {
    ok: true,
    changed: true,
    values: {
      calendarFeedUrl: url,
      calendarFeedCheckedAt: now,
      calendarFeedError: probe.ok ? null : probe.reason,
    },
  };
}

import { freeHandleSuggestions, isHandleTaken } from "@sailo/account/handle";
import {
  imageUrlOrNull,
  isHandleCollision,
  readBookingHours,
  readLocale,
  readNotificationPrefs,
  readSlotMinutes,
  readInvoicePrefix,
  readSocials,
  readTaxRateBp,
  readTimeZone,
  text,
} from "./shop-form";

/**
 * Moved to `@sailo/core/action-state` — apps/hq's forms need the same type and
 * an app cannot import another app. Re-exported so this app's ~90 actions and
 * every form that names `@/lib/actions/shop` are unchanged.
 */
import type { ActionState } from "@sailo/core/action-state";
export type { ActionState };

/** Runs format rules then the availability lookup. */
async function checkHandleAvailability(raw: string, exceptShopId?: string) {
  const handle = normalizeHandle(raw);
  const problem = validateHandleFormat(raw);

  /*
   * "Reserved" has exactly one exception: the brand handle, for us. A staff
   * session claiming sailo.store/sailo falls through to the taken check like
   * any other handle; everyone else keeps the refusal. Every path that writes
   * a handle runs through here, so this is the whole carve-out.
   */
  const ours =
    problem === "reserved" && handle === BRAND_HANDLE && (await isStaff());

  if (problem && !ours) return { handle, problem } as const;
  if (await isHandleTaken(handle, exceptShopId)) {
    return { handle, problem: "taken" } as const;
  }
  return { handle, problem: null } as const;
}

/**
 * A union rather than a struct with flags, because the flags could contradict.
 *
 * The first shape of this type carried `available: boolean` and an optional
 * `unknown` — which permits `{ available: true, unknown: true }`, a value
 * claiming both that the handle is free and that we never checked. Nothing
 * produced it, but nothing *could not* produce it either, and the consumer was
 * left to pick which field to believe. Three answers exist — free, taken, and
 * not-checked — so the type has three cases, and a contradictory value is now
 * unrepresentable rather than merely unlikely.
 */
export type HandleStatus =
  | { handle: string; verdict: "available" }
  /** The check did not run — throttled. Not the same answer as "taken". */
  | { handle: string; verdict: "unknown" }
  | {
      handle: string;
      verdict: "taken";
      message: string;
      /** Free alternatives, so a dead end comes with doors. */
      suggestions: string[];
    };

/**
 * Live availability check for the handle field. Called as the seller types, so
 * it stays cheap: format first, one indexed lookup, and suggestions only when
 * the handle is actually gone.
 */
/**
 * What to say when a descriptor is refused.
 *
 * Named per problem rather than one sentence, because each has a different fix
 * and "that isn't valid" sends a seller guessing at rules the card networks
 * publish and nobody reads.
 */
const DESCRIPTOR_ERRORS: Record<DescriptorProblem, string> = {
  empty: "Enter what buyers should see on their statement.",
  too_short: "Too short to recognise — use at least 5 characters.",
  too_long: "Card statements only fit 22 characters.",
  no_letter: "Needs at least one letter, or it reads as a reference number.",
  forbidden_character: "Card networks reject < > \\ \" and '.",
};

export async function checkHandle(raw: string): Promise<HandleStatus> {
  /*
   * Throttled for what it costs, not for what it says.
   *
   * Whether a handle is taken is already public — visiting `/thehandle` shows
   * either a shop or "this shop doesn't exist" — so hiding the answer would
   * protect nothing. What is worth bounding is the work: a taken handle fans
   * out into a lookup per suggested alternative, on an endpoint that needs no
   * session and is called on every keystroke of a signup form.
   *
   * Generous, because it *is* called per keystroke by the very people we want.
   */
  const gate = await rateLimit(`handle:${await callerIp()}`, 120, 60);
  if (!gate.allowed) {
    /*
     * `unknown`, not "taken".
     *
     * This first returned a plain `available: false`, which the field draws as
     * the handle being gone — red, with the "already taken" line — and which
     * onboarding reads as a step that cannot be advanced past. So the one
     * person most likely to trip a per-IP ceiling without doing anything wrong
     * — someone signing up from an office, a school, a carrier NAT, anywhere
     * an address is shared — was told a free handle belonged to somebody else
     * and left with no way forward.
     *
     * Not knowing is its own answer, and the truthful one here. Shop creation
     * checks uniqueness for real and is the only check that decides anything,
     * so letting them continue risks a late error rather than a dead end.
     */
    return { handle: raw, verdict: "unknown" };
  }

  // No shop id parameter on purpose — a client could pass someone else's and
  // get a misleading answer. Editing forms skip the call for their own handle.
  const { handle, problem } = await checkHandleAvailability(raw);

  if (!problem) {
    return { handle, verdict: "available" };
  }

  /*
   * `@sailo/account/handle`'s, not a third copy. This block and the phone's
   * onboarding router held the same two functions verbatim — the read that says
   * whether a handle is free, and the filter that only offers alternatives which
   * are themselves free.
   */
  const suggestions =
    problem === "taken" || problem === "reserved"
      ? await freeHandleSuggestions(handle)
      : [];

  return {
    handle,
    verdict: "taken",
    message: HANDLE_MESSAGES[problem],
    suggestions,
  };
}

export async function createShop(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const db = getDb();

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { ok: false, error: "Give your shop a name." };

  const { handle, problem } = await checkHandleAvailability(
    String(formData.get("handle") ?? ""),
  );
  if (problem) return { ok: false, error: HANDLE_MESSAGES[problem] };

  // One shop per user — if they already have one, send them to it.
  const existing = await db.query.shops.findFirst({
    where: eq(shops.userId, user.id),
    columns: { id: true },
  });
  if (existing) {
    revalidatePath("/admin", "layout");
    redirect("/admin");
  }

  let shop: { id: string } | undefined;
  try {
    [shop] = await db
      .insert(shops)
      .values({
        userId: user.id,
        handle,
        name,
        description: String(formData.get("description") ?? "").trim() || null,
        location: String(formData.get("location") ?? "").trim() || null,
        currency: toCurrencyCode(formData.get("currency")),
      })
      .returning({ id: shops.id });
  } catch (error) {
    // Someone claimed it between the check and the insert.
    if (isHandleCollision(error)) {
      return { ok: false, error: HANDLE_MESSAGES.taken };
    }
    throw error;
  }

  // An insert that returned nothing means the shop wasn't created; there is
  // nothing to attach a payment method to and nowhere to send them.
  if (!shop) return { ok: false, error: "Couldn't create your shop. Try again." };

  /*
   * The shop's team, with its owner already in it — spec 37.
   *
   * Awaited rather than deferred to `after()`, unlike the referral attribution
   * below. That one can fail into "nobody earns"; this one cannot: a shop
   * created without an organization is a shop nobody can ever invite anybody
   * to, and the seller would have no way to tell — the screen is simply empty
   * and the button does nothing. `0052` gives every older shop the same thing,
   * and the two have to agree because `requireShop` reads the result of both.
   *
   * Idempotent, so the retry a seller makes after a slow response cannot leave
   * two organizations behind.
   */
  await ensureShopOrganization(shop.id);

  /*
   * Who brought them, decided once and never revisited.
   *
   * This is the only place the referral cookie is read, and it is dropped in
   * the same breath whatever the outcome — a cookie that survives attribution
   * is a cookie that can attribute a second time. `after()` keeps it off the
   * signup's critical path: a referral programme must never be able to fail a
   * shop into not existing, and the failure modes here (Redis down, a race on
   * the unique index) are all ones where the right answer is "the shop is
   * created and nobody earns".
   */
  const referralCookie = (await cookies()).get(REFERRAL_COOKIE)?.value;
  if (referralCookie) {
    (await cookies()).delete(REFERRAL_COOKIE);
    const shopId = shop.id;
    after(async () => {
      try {
        await attributeReferral({
          referredShopId: shopId,
          referredUserId: user.id,
          referredEmail: user.email,
          rawCode: referralCookie,
        });
      } catch {
        // An unattributed signup is a lost commission, not a broken signup.
      }
    });
  }

  // A shop with no way to order is useless, so seed WhatsApp if given.
  const whatsapp = normalizePhone(String(formData.get("whatsapp") ?? ""));
  if (whatsapp) {
    await db.insert(paymentMethods).values({
      shopId: shop.id,
      type: "whatsapp",
      config: { phone: whatsapp },
      isEnabled: true,
      position: 1,
    });
  }

  /*
   * Purge before the hop, or the hop can loop. /admin's "no shop → go to
   * onboarding" and onboarding's "has shop → go to admin" are both streamed
   * client-side redirects, and the router caches them. Creating the shop just
   * made every cached copy of the first one wrong — without this purge the
   * browser replays it against the fresh second one and ping-pongs between
   * the two routes without ever asking the server again.
   */
  revalidatePath("/admin", "layout");
  revalidatePath("/onboarding");
  // A signup is the moment /hq's overview and accounts list change.
  // Scheduled before the redirect throws, delivered after the response.
  after(() => publishHqEvent("account"));
  redirect("/admin?welcome=1");
}

export async function updateShop(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { user, shop } = await requireShop("settings:write");

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { ok: false, error: "Shop name can't be empty." };

  const { handle, problem } = await checkHandleAvailability(
    String(formData.get("handle") ?? shop.handle),
    shop.id,
  );
  if (problem) return { ok: false, error: HANDLE_MESSAGES[problem] };
  const handleChanged = handle !== shop.handle;

  const theme = String(formData.get("theme") ?? "light");
  const layout = String(formData.get("layout") ?? "grid");
  const accent = String(formData.get("accentColor") ?? "#111111");

  /*
   * Refused, not silently dropped. A malformed pixel id that quietly became
   * null would save the rest of the form and leave the seller believing their
   * campaign is measured — an empty dashboard weeks later, after the ad money
   * was spent, is the worst possible place to learn about a typo.
   */
  const pixels = readPixelIds(formData);
  if (!pixels.ok) return { ok: false, error: pixels.error };

  /*
   * Refused rather than nulled, for the same reason the pixel ids are.
   *
   * `imageUrlOrNull` above can afford to drop a bad value — a missing avatar
   * is visible on the seller's own storefront the moment they look at it. A
   * dropped terms link is not: the checkbox still renders, the checkout still
   * works, and the seller believes buyers are agreeing to terms they were
   * never shown. That belief is the whole value of the feature, and it would
   * fail exactly when someone finally asked to see the agreement.
   */
  /*
   * The statement descriptor. Spec 44.
   *
   * Validated here rather than sent hopefully, because **Stripe silently
   * ignores an invalid descriptor** — no error, the charge succeeds, and the
   * connected account's own default appears on the buyer's statement instead.
   * That is the worst available failure: the settings screen says one thing,
   * every statement says another, and the only way anybody finds out is an
   * `unrecognized` chargeback months later.
   *
   * Blank clears it, which is a real choice — a seller whose account default is
   * already right should be able to say so — and an empty column means "use the
   * account default", not "use nothing".
   */
  const descriptorInput = String(formData.get("statementDescriptor") ?? "").trim();
  let statementDescriptor: string | null = null;
  if (descriptorInput) {
    const verdict = checkDescriptor(descriptorInput);
    if (!verdict.ok) {
      return { ok: false, error: DESCRIPTOR_ERRORS[verdict.problem] };
    }
    statementDescriptor = verdict.value;
  }

  const termsUrlInput = String(formData.get("termsUrl") ?? "").trim();
  if (termsUrlInput && !isPublicLinkUrl(termsUrlInput)) {
    return {
      ok: false,
      error: "The terms link must be a public https:// address.",
    };
  }

  const calendarFeed = await readCalendarFeed(formData, shop);
  if (!calendarFeed.ok) return { ok: false, error: calendarFeed.error };

  try {
    await getDb()
    .update(shops)
    .set({
      handle,
      name,
      // Spread rather than assigned, because "the seller did not touch the
      // field" and "the seller cleared the field" are different writes and
      // only one of them may reach the column. See `readCalendarFeed`.
      ...(calendarFeed.changed ? calendarFeed.values : {}),
      description: String(formData.get("description") ?? "").trim() || null,
      /*
       * Host-checked, not just trimmed. Both are fetched server-side by
       * `lib/og.tsx` to draw the shop's social card and favicon, on public
       * unauthenticated routes — so an unvalidated string here is a server-side
       * request a seller composes, the same hole `isStoredFileUrl` closed for
       * product downloads.
       */
      avatarUrl: imageUrlOrNull(formData.get("avatarUrl")),
      logoUrl: imageUrlOrNull(formData.get("logoUrl")),
      accentColor: /^#[0-9a-f]{6}$/i.test(accent) ? accent : "#111111",
      theme: theme === "dark" ? "dark" : "light",
      layout: layout === "list" ? "list" : "grid",
      /*
       * Validated, not trusted. This was whatever arrived in the request, so
       * a hand-rolled POST could store any string — and every price on that
       * storefront would then be handed to `Intl` against a code it does not
       * know, which throws and falls back to a bare number. It also decides
       * how many decimals the shop's money has, so an unknown code silently
       * moves every price by a factor of a hundred.
       */
      currency: toCurrencyCode(formData.get("currency")),
      /*
       * The other currencies this shop quotes — spec 53.
       *
       * `normalizeOfferedCurrencies` drops anything outside the offered set,
       * anything that is not a string, and the shop's own currency, and stores
       * the survivors in a fixed order. A currency in this array is only a
       * *ticked box*: whether a buyer can actually be quoted in it is
       * `liveCurrencies`, which requires every published product, priced
       * variant, enabled delivery rate and active coupon to carry a price in
       * it. That separation is what stops a half-configured currency reaching
       * a storefront.
       *
       * Gated behind the plan at the write as well as in the card. A form is a
       * request body, and a downgraded shop must not be able to turn this back
       * on by posting to the action the card no longer renders.
       */
      regionalCurrencies: can(shop, "regionalPricing")
        ? normalizeOfferedCurrencies(
            formData.getAll("regionalCurrencies"),
            toCurrencyCode(formData.get("currency")),
          )
        : shop.regionalCurrencies,
      locale: readLocale(formData.get("locale")),
      taxEnabled: formData.get("taxEnabled") === "on",
      taxName: String(formData.get("taxName") ?? "").trim().slice(0, 40) || "Tax",
      taxRateBp: readTaxRateBp(formData.get("taxRate")),
      taxInclusive: formData.get("taxInclusive") === "inclusive",
      taxOnDelivery: formData.get("taxOnDelivery") === "on",
      taxId: String(formData.get("taxId") ?? "").trim().slice(0, 64) || null,
      /*
       * Who works out the tax. Anything but the one known alternative falls
       * back to the flat rate — this is a `<select>` and therefore whatever
       * arrived in the request, and an unrecognised value that reached the
       * column would put `computeTotals` into its deferred branch and quietly
       * stop charging tax at all.
       */
      taxMode: formData.get("taxMode") === "stripe" ? "stripe" : "manual",
      taxIdCollection: formData.get("taxIdCollection") === "on",

      /*
       * Invoicing. `invoiceNextNumber` is deliberately absent — see
       * `readInvoicePrefix` for why the seller may set the prefix and not the
       * counter.
       */
      invoicePrefix: readInvoicePrefix(formData.get("invoicePrefix")),
      invoiceNotes:
        String(formData.get("invoiceNotes") ?? "").trim().slice(0, 500) || null,

      // The issuer block. Free text throughout, trimmed and bounded; the
      // country is the only one with a shape worth enforcing.
      invoiceLegalName: text(formData.get("invoiceLegalName"), 120),
      invoiceAddressLine1: text(formData.get("invoiceAddressLine1"), 120),
      invoiceAddressLine2: text(formData.get("invoiceAddressLine2"), 120),
      invoiceCity: text(formData.get("invoiceCity"), 80),
      invoiceRegion: text(formData.get("invoiceRegion"), 80),
      invoicePostalCode: text(formData.get("invoicePostalCode"), 20),
      // Refused rather than stored raw: this feeds `Intl.DisplayNames` on a
      // public invoice, and an unknown code renders as the code itself.
      invoiceCountry: normalizeCountry(text(formData.get("invoiceCountry"), 2)),
      invoiceRegistrationNumber: text(
        formData.get("invoiceRegistrationNumber"),
        64,
      ),

      /*
       * Where alerts go. Null means "fall back to the contact address, then the
       * account's" — never "send nothing", which is what `notificationPrefs`
       * below is for. See the column's own note.
       */
      notificationEmail:
        String(formData.get("notificationEmail") ?? "").trim() || null,

      /*
       * Booking. Both arrive as text the client composed, so both are checked
       * rather than stored: an unknown zone would make every slot calculation
       * fall back to UTC silently, and malformed hours would sell nothing while
       * looking configured.
       */
      timeZone: readTimeZone(formData.get("timeZone"), shop.timeZone),
      bookingHours: readBookingHours(formData.get("bookingHours")),
      bookingSlotMinutes: readSlotMinutes(formData.get("bookingSlotMinutes")),
      contactEmail: String(formData.get("contactEmail") ?? "").trim() || null,
      location: String(formData.get("location") ?? "").trim() || null,
      // Shape-checked above; what lands here can only be an id or null.
      ...pixels.columns,
      socials: readSocials(formData),
      collectAddress: formData.get("collectAddress") === "on",

      // Compliance. Checked above, so what lands here is a public https URL
      // or nothing at all.
      requireTerms: formData.get("requireTerms") === "on",
      termsUrl: termsUrlInput || null,
      statementDescriptor,
      askMarketingConsent: formData.get("askMarketingConsent") === "on",

      isPublished: formData.get("isPublished") === "on",
      /*
       * Which seller emails are still wanted. Stored as the *off* switches —
       * absence of a key means on — so a new event type ships enabled for
       * every existing shop without a backfill. Validated above, so what
       * lands here can only be keys the code knows about.
       */
      notificationPrefs: readNotificationPrefs(formData),
      updatedAt: new Date(),
    })
    .where(eq(shops.id, shop.id));
  } catch (error) {
    if (isHandleCollision(error)) {
      return { ok: false, error: HANDLE_MESSAGES.taken };
    }
    throw error;
  }

  revalidatePath("/admin/settings");
  revalidatePath(`/${handle}`);
  // Settings change the storefront's name, theme, currency and tax, all of
  // which the cached shop row carries. The old handle is dropped too, or a
  // renamed shop keeps answering on its previous address.
  revalidateShop(shop.id, handle);
  // The old address stops resolving, so drop it from the cache too.
  if (handleChanged) {
    revalidatePath(`/${shop.handle}`);
    revalidateShop(shop.id, shop.handle);
  }
  after(() => publishShopEvent(shop.id, "catalog"));
  /*
   * The busy cache holds a minute of the *old* calendar, and a seller who has
   * just connected or disconnected one is about to check whether it worked.
   * Dropping it here is the difference between the feature appearing to do
   * nothing and it working on the next page load.
   */
  if (calendarFeed.changed) await forgetExternalBusy(shop.id);

  /*
   * The one switch on this form that is not a shop setting.
   *
   * Sailo's product mail is keyed on the *account* address in
   * `marketing_opt_outs` — platform-wide, and outliving the shop — because an
   * unsubscribe arrives from a mail client with no session and no shop id,
   * and has to stick whatever any column later says. So it is written through
   * its own module rather than folded into the UPDATE above.
   *
   * Written after the shop, and deliberately not inside its error handling: a
   * failure here must not roll back a saved shop, and a seller who came to
   * this page to rename their shop should not lose that because a mailing
   * preference did not take.
   */
  await setMarketingOptIn(user.email, formData.get("marketing_opt_in") === "on");

  return {
    ok: true,
    message: handleChanged
      ? `Saved. Your shop now lives at /${handle}.`
      : "Saved.",
  };
}
