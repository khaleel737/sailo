import { redirect } from "next/navigation";
import { getLocale } from "@/i18n/server";
import { getContentLocales } from "@/lib/blog";
import { DEFAULT_LOCALE } from "@/i18n/config";

/* A redirect that reads the visitor's language. Dynamic by nature. */
export const instant = false;

/**
 * `/blog` is not a page. It is the door to one.
 *
 * Every index now lives at `/<locale>/blog`, so this sends the visitor to the
 * one in their language, falling back to English when that language has nothing
 * written yet. Keeping a real page here as well would mean two URLs showing the
 * same articles, which is the duplicate-content problem the locale prefix was
 * introduced to solve.
 *
 * A redirect rather than a rewrite, deliberately: the reader should end up with
 * the language in their address bar, so the page they bookmark or paste is the
 * one they actually read.
 */
export default async function BlogRoot() {
  const [preferred, available] = await Promise.all([getLocale(), getContentLocales()]);
  const locale = available.includes(preferred) ? preferred : DEFAULT_LOCALE;
  redirect(`/${locale}/blog`);
}
