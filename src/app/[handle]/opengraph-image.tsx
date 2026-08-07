import { ImageResponse } from "next/og";
import { getShopByHandle } from "@/lib/queries";
import {
  cardTheme,
  clamp,
  fetchImage,
  initial,
  SailoMark,
} from "@/lib/og";

/*
 * These four exports must be literals. Next parses route segment config
 * statically at build time, so `export const size = OG_SIZE` is not read at
 * all — the build rejects it, and before it did, the renderer ran with no
 * declared size.
 */
export const alt = "Shop on Sailo";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
/* An hour: long enough that a crawler is not redrawing the card,
   short enough that a renamed shop is current the same session. */


/**
 * The card a shop link turns into when it is pasted anywhere.
 *
 * This matters more for Sailo than for most products: sellers reach buyers by
 * dropping their link into an Instagram bio, a TikTok comment and a WhatsApp
 * group, and the preview is the whole shopfront in that moment. What was here
 * before was the seller's avatar — a 400px square — served as a 1200x630 card,
 * so every share was a crop or a letterbox, and a shop with no avatar shared as
 * a bare blue link.
 *
 * Drawn in the shop's own palette, not Sailo's. The seller's brand is what a
 * buyer recognises; our mark sits small in the corner as provenance.
 */
export default async function Image({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const shop = await getShopByHandle(handle);

  // The route this belongs to 404s for an unknown handle, but a crawler can
  // still ask for the image directly, and an exception here would be cached.
  if (!shop) {
    return new ImageResponse(
      (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "#0d0d0c",
            color: "#faf9f7",
            fontSize: 56,
          }}
        >
          Sailo
        </div>
      ),
      size,
    );
  }

  const t = cardTheme(shop.accentColor, shop.theme);
  const avatar = await fetchImage(shop.avatarUrl ?? shop.logoUrl);
  const description = clamp(shop.description, 130);

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
          background: t.background,
          color: t.ink,
          // The shop's accent, as a band down the leading edge. Enough to make
          // two shops look like two brands without swamping the card.
          borderLeft: `24px solid ${t.accent}`,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 32 }}>
          {avatar ? (
            <img
              src={avatar}
              width={152}
              height={152}
              style={{
                width: 152,
                height: 152,
                borderRadius: 32,
                objectFit: "cover",
              }}
              alt=""
            />
          ) : (
            // No avatar is the common case for a shop opened this morning, and
            // it still has to make a card. The initial on the accent reads as
            // deliberate rather than missing.
            <div
              style={{
                width: 152,
                height: 152,
                borderRadius: 32,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: t.accent,
                color: t.onAccent,
                fontSize: 76,
                fontWeight: 700,
              }}
            >
              {initial(shop.name)}
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div
              style={{
                fontSize: shop.name.length > 22 ? 60 : 76,
                fontWeight: 700,
                lineHeight: 1.05,
                letterSpacing: -1.5,
              }}
            >
              {clamp(shop.name, 40)}
            </div>
            <div style={{ fontSize: 30, color: t.muted }}>
              {`sailo.store/${shop.handle}`}
            </div>
          </div>
        </div>

        {description ? (
          <div
            style={{
              display: "flex",
              fontSize: 34,
              lineHeight: 1.4,
              color: t.muted,
              maxWidth: 940,
            }}
          >
            {description}
          </div>
        ) : null}

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            paddingTop: 32,
            borderTop: `2px solid ${t.hairline}`,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <SailoMark color={t.muted} size={34} />
            <div style={{ fontSize: 24, color: t.muted }}>Powered by Sailo</div>
          </div>

          {shop.location ? (
            <div style={{ fontSize: 24, color: t.muted }}>{clamp(shop.location, 40)}</div>
          ) : null}
        </div>
      </div>
    ),
    size,
  );
}
