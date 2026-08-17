/**
 * Reading a shop's settings out of a form.
 *
 * Nine readers, each turning one untrusted `FormDataEntryValue` into something the column can
 * hold: a tax rate in basis points, a locale we actually ship, a time zone the runtime knows, a
 * week of opening hours, a slot length, the notification switches.
 *
 * WHY THEY ARE NOT IN `shop.ts`
 *
 * That file is `"use server"`, and a server module may export *only* async functions. So these
 * could not be exported from it however much anything else wanted them — and two of them are
 * exactly the kind of thing a second surface should reuse rather than re-derive: `readTimeZone`
 * falls back to the shop's current zone rather than to UTC, and `readSocials` decides which
 * links a storefront will render.
 */

import { normalizeWeeklyHours } from "@sailo/commerce/booking";
import { type WeeklyHours } from "@sailo/commerce/booking";
import { isTimeZone } from "@sailo/commerce/booking";
import { type NotificationPrefs, type ShopSocial } from "@sailo/db/schema";
import { NOTIFICATION_EVENTS, notificationPrefsSchema } from "@sailo/notifications/prefs";
import { SOCIAL_PLATFORMS } from "@sailo/core/visibility";
import { isRenderableImageUrl } from "@sailo/storage/urls";
import { LOCALES, type Locale } from "@sailo/i18n/config";


/** A form value that is allowed to become a stored image URL, or null. */
export function imageUrlOrNull(value: FormDataEntryValue | null): string | null {
  const url = String(value ?? "").trim();
  return isRenderableImageUrl(url) ? url : null;
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
export function isHandleCollision(error: unknown) {
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

export function readSocials(formData: FormData): ShopSocial[] {
  const socials: ShopSocial[] = [];
  for (const platform of SOCIAL_PLATFORMS) {
    const raw = String(formData.get(`social_${platform}`) ?? "").trim();
    if (!raw) continue;
    const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    socials.push({ platform, url });
  }
  return socials;
}

/**
 * A percent typed by a human ("20", "7.5") into basis points. Clamped to
 * 0–100%: a typo like 2000 must not bill a buyer twenty times the goods.
 */
export function readTaxRateBp(value: FormDataEntryValue | null): number {
  const percent = Number.parseFloat(String(value ?? "").replace(",", "."));
  if (!Number.isFinite(percent) || percent <= 0) return 0;
  return Math.round(Math.min(percent, 100) * 100);
}

/** Only a locale we actually ship; anything else falls back to English. */
export function readLocale(value: FormDataEntryValue | null): Locale | null {
  const code = String(value ?? "");
  // Blank means "follow the visitor" — stored as null so it stays
  // distinguishable from a seller who deliberately picked English.
  if (!code) return null;
  return LOCALES.some((l) => l.code === code) ? (code as Locale) : null;
}

/** The seller's zone, or the one they already had if this one is not real. */
export function readTimeZone(value: FormDataEntryValue | null, current: string): string {
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
export function readBookingHours(value: FormDataEntryValue | null): WeeklyHours | null {
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
export function readSlotMinutes(value: FormDataEntryValue | null): number | null {
  const minutes = Number(String(value ?? "").trim());
  if (!Number.isFinite(minutes) || minutes <= 0) return null;
  // A ceiling, so a crafted value cannot make one slot swallow a whole day.
  return Math.min(Math.trunc(minutes), 24 * 60);
}

/**
 * The seller's email switches, read as checkboxes and stored as exceptions.
 *
 * Only the *off* ones are written. An unchecked box is `false` in the column;
 * a checked one is simply absent, which is what "absence means on" buys —
 * tomorrow's event type is on for everybody without a migration.
 *
 * Parsed through the zod schema rather than assembled by hand so the column
 * can only ever hold keys this build knows about; a crafted field name is
 * dropped by `strictObject` instead of being stored forever.
 */
export function readNotificationPrefs(formData: FormData): NotificationPrefs {
  const off: Record<string, boolean> = {};
  for (const event of NOTIFICATION_EVENTS) {
    if (formData.get(`notify_${event}`) !== "on") off[event] = false;
  }
  const parsed = notificationPrefsSchema.safeParse(off);
  return parsed.success ? parsed.data : {};
}
