"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, ne } from "drizzle-orm";
import { getDb } from "@/db";
import { paymentMethods, shops, type ShopSocial } from "@/db/schema";
import { requireShop, requireUser } from "@/lib/session";
import { normalizePhone, SOCIAL_PLATFORMS } from "@/lib/utils";
import {
  HANDLE_MESSAGES,
  normalizeHandle,
  suggestHandles,
  validateHandleFormat,
} from "@/lib/handle";
import { DEFAULT_LOCALE, LOCALES, type Locale } from "@/i18n/config";

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
  if (problem) return { handle, problem } as const;
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
};

/**
 * Live availability check for the handle field. Called as the seller types, so
 * it stays cheap: format first, one indexed lookup, and suggestions only when
 * the handle is actually gone.
 */
export async function checkHandle(raw: string): Promise<HandleStatus> {
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
  if (existing) redirect("/admin");

  let shop: { id: string };
  try {
    [shop] = await db
      .insert(shops)
      .values({
        userId: user.id,
        handle,
        name,
        description: String(formData.get("description") ?? "").trim() || null,
        currency: String(formData.get("currency") ?? "USD"),
      })
      .returning({ id: shops.id });
  } catch (error) {
    // Someone claimed it between the check and the insert.
    if (isHandleCollision(error)) {
      return { ok: false, error: HANDLE_MESSAGES.taken };
    }
    throw error;
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

  redirect("/admin?welcome=1");
}

/** Only a locale we actually ship; anything else falls back to English. */
function readLocale(value: FormDataEntryValue | null): Locale {
  const code = String(value ?? "");
  return LOCALES.some((l) => l.code === code)
    ? (code as Locale)
    : DEFAULT_LOCALE;
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
      avatarUrl: String(formData.get("avatarUrl") ?? "").trim() || null,
      logoUrl: String(formData.get("logoUrl") ?? "").trim() || null,
      accentColor: /^#[0-9a-f]{6}$/i.test(accent) ? accent : "#111111",
      theme: theme === "dark" ? "dark" : "light",
      layout: layout === "list" ? "list" : "grid",
      currency: String(formData.get("currency") ?? "USD"),
      locale: readLocale(formData.get("locale")),
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
  // The old address stops resolving, so drop it from the cache too.
  if (handleChanged) revalidatePath(`/${shop.handle}`);

  return {
    ok: true,
    message: handleChanged
      ? `Saved. Your shop now lives at /${handle}.`
      : "Saved.",
  };
}
