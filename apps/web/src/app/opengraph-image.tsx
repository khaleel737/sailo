import { ImageResponse } from "next/og";
import { getLocale } from "@/i18n/server";
import { getMarketingDictionary } from "@sailo/i18n/marketing";
import { SailoMark } from "@/lib/og";

export const alt = "Sailo — one link, your whole shop";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * The card that gets pasted into WhatsApp, Slack and X.
 *
 * Drawn rather than photographed, and drawn from the same dictionary the page
 * reads — so the preview a Turkish visitor shares is in Turkish. Everything
 * here is inline styles and system fonts on purpose: `next/og` renders with
 * Satori, which supports neither Tailwind's class names nor a webfont it
 * hasn't been handed the bytes for.
 */
export default async function Image() {
  const locale = await getLocale();
  const m = getMarketingDictionary(locale);
  const title = m.hero.title.replace("{highlight}", m.hero.titleHighlight);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 72,
          background:
            "radial-gradient(ellipse 70% 60% at 15% 0%, #0b3f26 0%, transparent 60%), radial-gradient(ellipse 60% 55% at 90% 15%, #06304a 0%, transparent 60%), #0b0e0d",
          color: "#ffffff",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          {/* Satori will not render an imported *component*, but it is happy
              with a function that returns JSX — which is what this is. Sharing
              it keeps this card on the same mark as the other three. */}
          <SailoMark color="#34d98a" size={64} />
          <span style={{ fontSize: 40, fontWeight: 700, letterSpacing: -1 }}>
            Sailo
          </span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div
            style={{
              fontSize: 64,
              fontWeight: 700,
              lineHeight: 1.1,
              letterSpacing: -2,
              maxWidth: 940,
            }}
          >
            {title}
          </div>
          <div style={{ fontSize: 30, color: "#98a29e", maxWidth: 900, lineHeight: 1.35 }}>
            {m.seo.ogDescription}
          </div>
        </div>

        <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
          {[m.hero.proof1, m.hero.proof3, m.hero.proof4].map((chip) => (
            <div
              key={chip}
              style={{
                display: "flex",
                fontSize: 24,
                padding: "10px 22px",
                borderRadius: 999,
                border: "1px solid #2a312f",
                background: "#141817",
                color: "#dfe3e1",
              }}
            >
              {chip}
            </div>
          ))}
        </div>
      </div>
    ),
    size,
  );
}
