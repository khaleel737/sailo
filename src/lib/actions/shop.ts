"use server";

import { revalidatePath } from "next/cache";
import { toCurrencyCode } from "@/lib/currency";
import { normalizeWeeklyHours, type WeeklyHours } from "@/lib/booking/hours";
import { isTimeZone } from "@/lib/booking/time-zone";
import { revalidateShop } from "@/lib/cache";
import { redirect } from "next/navigation";
import { and, eq, ne } from "drizzle-orm";
import { getDb } from "@/db";
import { paymentMethods, shops, type ShopSocial } from "@/db/schema";
import { isStaff, requireShop, requireUser } from "@/lib/session";
import { normalizePhone, SOCIAL_PLATFORMS } from "@/lib/utils";
import { isRenderableImageUrl } from "@/lib/file-urls";
import { rateLimit } from "@/lib/redis";
import { callerIp } from "@/lib/client-ip";
import { BRAND_HANDLE, HANDLE_MESSAGES, normalizeHandle, suggestHandles, validateHandleFormat } from "@/lib/handle";

/** A form value that is allowed to become a stored image URL, or null. */
function imageUrlOrNull(value: FormDataEntryValue | null): string | null {
  const url = String(value ?? "").trim();
  return isRenderableImageUrl(url) ? url : null;
}
import { LOCALES, type Locale } from "@/i18n/config";

export type ActionState = { ok: boolean; error?: string; message?: string };

async function handleTaken(handle: string, exceptShopId?: string) {
  const existing = await getDb().query.shops.findFirst({
    where: exceptShopId
      ? and(eq(shops.handle, handle), ne(shops.id, exceptShopId))
      : eq(shops.handle, handle),
    columns: { id: true },
  });
  return Boolean(existing);
}

const HANDLE_INDEX = "shops_handle_key";
const UNIQUE_VIOLATION = "23505";

/**
 * Availability is checked before writing, but two people can pass that check
 * at the same time. The unique index is the real guarantee — this turns the
 * resulting violation into the same message instead of a 500.
 *
 * The driver puts the Postgres code and constraint on `cause`, not in the
 * message, so this reads both plus a string fallback for other drivers.
 */
function isHandleCollision(error: unknown) {
  const pgError = (error as { code?: string; constraint?: string })?.code
    ? (error as { code?: string; constraint?: string })
    : (error as { cause?: { code?: string; constraint?: string } })?.cause;

  if (pgError?.code === UNIQUE_VIOLATION) {
    // A shop also has a unique user_id; only the handle clash is recoverable.
    return !pgError.constraint || pgError.constraint === HANDLE_INDEX;
  }

  const text = error instanceof Error ? error.message : String(error);
  return text.includes(HANDLE_INDEX);
}

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
  if (await handleTaken(handle, exceptShopId)) {
    return { handle, problem: "taken" } as const;
  }
  return { handle, problem: null } as const;
}

function readSocials(formData: FormData): ShopSocial[] {
  const socials: ShopSocial[] = [];
  for (const platform of SOCIAL_PLATFORMS) {
    const raw = String(formData.get(`social_${platform}`) ?? "").trim();
    if (!raw) continue;
    const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    socials.push({ platform, url });
  }
  return socials;
}

export type HandleStatus = {
  handle: string;
  available: boolean;
  message: string | null;
  /** Free alternatives, only when the wanted one is taken. */
  suggestions: string[];
  /**
   * True when the check did not run, so `available: false` here means "not
   * known" rather than "taken". They are not the same answer and the field
   * must not draw them the same way.
   */
  unknown?: boolean;
};

/**
 * Live availability check for the handle field. Called as the seller types, so
 * it stays cheap: format first, one indexed lookup, and suggestions only when
 * the handle is actually gone.
 */
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
    return {
      handle: raw,
      available: false,
      unknown: true,
      message: null,
      suggestions: [],
    };
  }

  // No shop id parameter on purpose — a client could pass someone else's and
  // get a misleading answer. Editing forms skip the call for their own handle.
  const { handle, problem } = await checkHandleAvailability(raw);

  if (!problem) {
    return { handle, available: true, message: null, suggestions: [] };
  }

  let suggestions: string[] = [];
  if (problem === "taken" || problem === "reserved") {
    const candidates = suggestHandles(handle);
    const free = await Promise.all(
      candidates.map(async (c) => ((await handleTaken(c)) ? null : c)),
    );
    suggestions = free.filter((c): c is string => c !== null).slice(0, 3);
  }

  return {
    handle,
    available: false,
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
  redirect("/admin?welcome=1");
}

/**
 * A percent typed by a human ("20", "7.5") into basis points. Clamped to
 * 0–100%: a typo like 2000 must not bill a buyer twenty times the goods.
 */
function readTaxRateBp(value: FormDataEntryValue | null): number {
  const percent = Number.parseFloat(String(value ?? "").replace(",", "."));
  if (!Number.isFinite(percent) || percent <= 0) return 0;
  return Math.round(Math.min(percent, 100) * 100);
}

/** Only a locale we actually ship; anything else falls back to English. */
function readLocale(value: FormDataEntryValue | null): Locale | null {
  const code = String(value ?? "");
  // Blank means "follow the visitor" — stored as null so it stays
  // distinguishable from a seller who deliberately picked English.
  if (!code) return null;
  return LOCALES.some((l) => l.code === code) ? (code as Locale) : null;
}

/** The seller's zone, or the one they already had if this one is not real. */
function readTimeZone(value: FormDataEntryValue | null, current: string): string {
  const zone = String(value ?? "").trim();
  return isTimeZone(zone) ? zone : current;
}

/**
 * The week, as JSON from the hidden field the hours editor maintains.
 *
 * Normalised rather than merely validated, so windows that overlap or touch
 * are merged before they reach the column — the slot generator assumes they
 * are disjoint and sorted, and a hand-posted payload is under no obligation
 * to be either.
 */
function readBookingHours(value: FormDataEntryValue | null): WeeklyHours | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  try {
    return normalizeWeeklyHours(JSON.parse(raw));
  } catch {
    // Unparseable means the field was tampered with or an older client posted
    // it. Null restores the default week rather than storing nonsense.
    return null;
  }
}

/** Spacing between slot starts, or null to follow the service's own length. */
function readSlotMinutes(value: FormDataEntryValue | null): number | null {
  const minutes = Number(String(value ?? "").trim());
  if (!Number.isFinite(minutes) || minutes <= 0) return null;
  // A ceiling, so a crafted value cannot make one slot swallow a whole day.
  return Math.min(Math.trunc(minutes), 24 * 60);
}

export async function updateShop(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { shop } = await requireShop();

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

  try {
    await getDb()
    .update(shops)
    .set({
      handle,
      name,
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
      locale: readLocale(formData.get("locale")),
      taxEnabled: formData.get("taxEnabled") === "on",
      taxName: String(formData.get("taxName") ?? "").trim().slice(0, 40) || "Tax",
      taxRateBp: readTaxRateBp(formData.get("taxRate")),
      taxInclusive: formData.get("taxInclusive") === "inclusive",
      taxOnDelivery: formData.get("taxOnDelivery") === "on",
      taxId: String(formData.get("taxId") ?? "").trim().slice(0, 64) || null,

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
      socials: readSocials(formData),
      collectAddress: formData.get("collectAddress") === "on",
      isPublished: formData.get("isPublished") === "on",
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

  return {
    ok: true,
    message: handleChanged
      ? `Saved. Your shop now lives at /${handle}.`
      : "Saved.",
  };
}
