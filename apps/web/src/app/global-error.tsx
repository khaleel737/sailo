"use client";

import { useLeaving } from "@/lib/leaving";

/*
 * The root layout itself failed.
 *
 * This file replaces the root layout rather than rendering inside it, which
 * has three consequences worth stating, because each one breaks a habit that
 * works everywhere else in the app:
 *
 *   1. It has to render its own `<html>` and `<body>`.
 *   2. `globals.css` is not loaded, so no Tailwind class resolves here. Every
 *      style below is inline or in the one `<style>` block, which exists only
 *      because inline styles cannot express a media query.
 *   3. `getLocale()` never ran, so there is no locale and no dictionary. This
 *      is the only screen in Sailo that is English in every language, and that
 *      is a deliberate floor rather than an oversight — the alternative is
 *      shipping 35 dictionaries into the bundle for a page nobody should see.
 *
 * There is no `metadata` export either; error boundaries are Client Components.
 * The title comes from React's own `<title>`.
 */
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const leaving = useLeaving();

  /*
   * A deliberate departure cancelled something, and that is not a failure —
   * see `lib/leaving`. This is the boundary an iPhone actually hit on the
   * WhatsApp handoff, because the cancelled stream was the router's own.
   *
   * Still an `<html>`: this file replaces the root layout, so returning null
   * would leave React with no document to commit. A bare page is what any
   * navigation looks like on its way out.
   */
  if (leaving) {
    return (
      <html lang="en">
        <body style={{ margin: 0, minHeight: "100dvh", background: "#faf9f7" }}>
          <style>{`@media (prefers-color-scheme: dark) { body { background: #0d0d0c !important; } }`}</style>
        </body>
      </html>
    );
  }

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "1.5rem",
          fontFamily:
            "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
          background: "#faf9f7",
          color: "#14140f",
        }}
      >
        <title>Something went wrong · Sailo</title>
        <style>{`
          @media (prefers-color-scheme: dark) {
            body { background: #0d0d0c !important; color: #faf9f7 !important; }
            .ge-body { color: #8a8a82 !important; }
            .ge-ref  { color: #6f6b64 !important; }
          }
        `}</style>

        <div style={{ maxWidth: "26rem", textAlign: "center" }}>
          <svg
            width={28}
            height={36}
            viewBox="0 0 877.6 1125.4"
            aria-hidden
            style={{ marginBottom: "1.5rem", color: "#037740" }}
          >
            <path
              fill="currentColor"
              d="M220.6 0C241.5 10.4 282.6 62.2 298.9 83.6C376.4 185.6 413.9 312.8 432.6 437.7C434.3 438.6 443.8 429.1 445.5 427.5C461.7 412.1 479.2 398.1 497.6 385.3C536.5 358.4 574.9 338.5 618.8 322.6C624.7 320.5 671.7 303.2 681.9 306.6C687.3 318 689.8 329.9 692.9 342C716.2 432 711.7 521.3 686.8 611C679.6 637.2 671.2 663.3 661.4 688.5C658 697.3 652.1 706.6 650.7 716.3C651.8 717.3 662.3 713.7 664.8 713.2C681.4 710.4 696.6 707.7 712.7 706.4C751.2 703.2 791.4 702.6 829.3 711.3C832.1 712 868.9 717.1 877.6 725.8C877.6 745.4 861 789 854 804.8C813.8 895.8 739.8 968.5 659.1 1024.5C634.7 1041.4 609.1 1056 582.3 1068.9C574 1073 564.7 1075.8 556.1 1079.6C482.4 1111.7 401.7 1130.1 322 1124.4C317.6 1124.1 313.2 1124.6 308.7 1124.4C291 1123.4 272.4 1119.5 254.8 1115.7C241.7 1112.8 226 1111.7 214.9 1103.5C204.2 1095.6 196.1 1087.9 187.1 1078.4C156.6 1046.1 129.1 1012 106.6 973.5C94.9 953.5 85.4 933 75 912.4C53.4 869.1 40.5 821.7 27.9 775.2C22.1 753.6 30.1 792.8 22.6 759.6C21 752.4 21 745.1 19.6 737.6C16.5 721.7 12 704.3 9.7 687.8C-6.1 573.3-3.8 455 25.6 342.4C32.5 315.9 40.1 290.4 48.4 264.1C50.4 257.9 51.7 250.8 54.1 244.7C78.4 183.4 108.8 125.1 149.5 72.9C163.1 55.5 209.4 2.8 220.6 0Z"
            />
          </svg>

          <h1
            style={{
              margin: 0,
              fontSize: "1.25rem",
              fontWeight: 600,
              letterSpacing: "-0.01em",
            }}
          >
            Something went wrong
          </h1>
          <p
            className="ge-body"
            style={{
              margin: "0.625rem 0 0",
              fontSize: "0.875rem",
              lineHeight: 1.625,
              color: "#6b6b63",
            }}
          >
            Sailo could not render this page at all. Trying again is worth a go
            — if it keeps happening, the reference below tells us what broke.
          </p>

          <button
            type="button"
            onClick={retry}
            style={{
              marginTop: "1.75rem",
              height: "2.75rem",
              padding: "0 1.25rem",
              borderRadius: "0.75rem",
              border: "none",
              background: "#037740",
              color: "#ffffff",
              fontSize: "0.875rem",
              fontWeight: 600,
              fontFamily: "inherit",
              cursor: "pointer",
            }}
          >
            Try again
          </button>

          {error.digest ? (
            <p
              className="ge-ref"
              style={{
                margin: "2rem 0 0",
                fontSize: "0.75rem",
                fontVariantNumeric: "tabular-nums",
                color: "#8a8a82",
              }}
            >
              Reference {error.digest}
            </p>
          ) : null}
        </div>
      </body>
    </html>
  );
}
