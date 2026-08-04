"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, ne } from "drizzle-orm";
import { getDb } from "@/db";
import { shops, type ShopSocial } from "@/db/schema";
import { requireShop, requireUser } from "@/lib/session";
import { normalizeHandle, normalizePhone, SOCIAL_PLATFORMS } from "@/lib/utils";

export type ActionState = { ok: boolean; error?: string; message?: string };

/** Routes that would collide with a shop handle. */
const RESERVED = new Set([
  "admin", "api", "login", "signup", "signin", "sign-in", "sign-up",
  "onboarding", "dashboard", "settings", "about", "pricing", "help",
  "terms", "privacy", "support", "blog", "docs", "explore", "discover",
  "shopik", "www", "app", "static", "public", "assets", "_next", "favicon",
  "new", "create", "edit", "delete", "account", "profile", "me",
]);

async function handleTaken(handle: string, exceptShopId?: string) {
  const existing = await getDb().query.shops.findFirst({
    where: exceptShopId
      ? and(eq(shops.handle, handle), ne(shops.id, exceptShopId))
      : eq(shops.handle, handle),
    columns: { id: true },
  });
  return Boolean(existing);
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

export async function checkHandle(handle: string): Promise<boolean> {
  const clean = normalizeHandle(handle);
  if (clean.length < 3 || RESERVED.has(clean)) return false;
  return !(await handleTaken(clean));
}

export async function createShop(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const db = getDb();

  const handle = normalizeHandle(String(formData.get("handle") ?? ""));
  const name = String(formData.get("name") ?? "").trim();

  if (handle.length < 3)
    return { ok: false, error: "Handle must be at least 3 characters." };
  if (RESERVED.has(handle))
    return { ok: false, error: "That handle is reserved. Try another." };
  if (!name) return { ok: false, error: "Give your shop a name." };
  if (await handleTaken(handle))
    return { ok: false, error: "That handle is already taken." };

  // One shop per user — if they already have one, send them to it.
  const existing = await db.query.shops.findFirst({
    where: eq(shops.userId, user.id),
    columns: { id: true },
  });
  if (existing) redirect("/admin");

  await db.insert(shops).values({
    userId: user.id,
    handle,
    name,
    description: String(formData.get("description") ?? "").trim() || null,
    whatsapp: normalizePhone(String(formData.get("whatsapp") ?? "")) || null,
    currency: String(formData.get("currency") ?? "USD"),
  });

  redirect("/admin?welcome=1");
}

export async function updateShop(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { shop } = await requireShop();

  const handle = normalizeHandle(String(formData.get("handle") ?? shop.handle));
  const name = String(formData.get("name") ?? "").trim();

  if (handle.length < 3)
    return { ok: false, error: "Handle must be at least 3 characters." };
  if (RESERVED.has(handle))
    return { ok: false, error: "That handle is reserved. Try another." };
  if (!name) return { ok: false, error: "Shop name can't be empty." };
  if (await handleTaken(handle, shop.id))
    return { ok: false, error: "That handle is already taken." };

  const theme = String(formData.get("theme") ?? "light");
  const layout = String(formData.get("layout") ?? "grid");
  const accent = String(formData.get("accentColor") ?? "#111111");

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
      whatsapp: normalizePhone(String(formData.get("whatsapp") ?? "")) || null,
      contactEmail: String(formData.get("contactEmail") ?? "").trim() || null,
      location: String(formData.get("location") ?? "").trim() || null,
      socials: readSocials(formData),
      isPublished: formData.get("isPublished") === "on",
      updatedAt: new Date(),
    })
    .where(eq(shops.id, shop.id));

  revalidatePath("/admin/settings");
  revalidatePath(`/${handle}`);
  return { ok: true, message: "Saved." };
}
