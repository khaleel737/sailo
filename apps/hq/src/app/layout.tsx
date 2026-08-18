import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

/**
 * The root of the staff panel.
 *
 * Thin on purpose. apps/web's root layout carries a locale cookie, an i18n
 * provider, a consent gate, two analytics tags and a script that sets `dir`
 * before paint — because it serves storefronts to the public in 35 languages.
 * None of that is true here: this panel is staff-only, English, LTR, and
 * loads no third-party script at all (see the CSP in `next.config.ts`, which
 * names no external origin because there is none to name).
 *
 * So the shell it renders is the honest minimum, and the guard is not here —
 * it is in `(panel)/layout.tsx`, one level down, so that `/login` can exist
 * outside it. A login page behind a login guard is a locked door with the key
 * inside.
 */
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/*
 * `Outfit` is deliberately absent, unlike apps/web.
 *
 * That face is the marketing display type — it exists to make a landing page
 * read expensive at 6rem. Nothing in a staff panel is set at 6rem, and
 * shipping a third webfont to a surface that renders tables would be paying
 * for a typeface nobody here sees.
 */

/**
 * Nothing in this app is prerenderable, and this says so once instead of
 * twenty-five times.
 *
 * Every route sits under `(panel)`, whose layout opens with `requireStaff()` —
 * a session read and a roster lookup. `/login` reads the session too, to bounce
 * someone who is already in. So there is no page here whose HTML could be built
 * ahead of a request, and without this Next tries anyway: the first build of
 * this app failed on `/affiliates` trying to reach the database while
 * generating static pages.
 *
 * `dynamic` is available precisely because this app does not enable
 * `cacheComponents` — Next 16 removes this option when it is on, which is why
 * apps/web cannot use it and reaches for `<Suspense>` and `"use cache"`
 * instead. Two different tools for two apps with genuinely different shapes.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { default: "Sailo HQ", template: "%s · Sailo HQ" },
  /*
   * Internal, and behind an allowlist — but a stray link in a support email
   * should not be able to put it in an index either. `next.config.ts` sets the
   * same thing as an `X-Robots-Tag` header, which is what covers the route
   * handlers: they have no metadata to declare.
   */
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    /*
     * `lang` and `dir` are pinned rather than read from a cookie.
     *
     * Staff may well have picked Arabic or Hebrew for their *own* storefront,
     * and in apps/web that preference lives in a cookie the root layout reads.
     * This panel is written in English and its tables are laid out for it, so
     * inheriting that choice here would mirror a dense table against text that
     * is still English. One less cookie read, and one less thing to get wrong.
     */
    <html
      lang="en"
      dir="ltr"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-ink-50 text-ink-900">
        {children}
      </body>
    </html>
  );
}
