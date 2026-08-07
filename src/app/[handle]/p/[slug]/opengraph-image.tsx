import { ImageResponse } from "next/og";
import { getProductBySlug, getShopByHandle } from "@/lib/queries";
import { priceRange } from "@/lib/variants";
import { formatMoney } from "@/lib/utils";
import {
  SailoMark,
  cardTheme,
  clamp,
  fetchImage,
  initial,
} from "@/lib/og";

/*
 * These four exports must be literals. Next parses route segment config
 * statically at build time, so `export const size = OG_SIZE` is not read at
 * all — the build rejects it, and before it did, the renderer ran with no
 * declared size.
 */
export const alt = "Product on Sailo";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
/* An hour: long enough that a crawler is not redrawing the card,
   short enough that a renamed shop is current the same session. */
export const revalidate = 3600;


/**
 * The card a single product turns into when its link is shared.
 *
 * A product link is what a seller actually posts — "this one, £24, link in
 * bio" — so the preview has to answer what it is and what it costs before
 * anybody taps. Before this it was the raw product photo at whatever aspect
 * the seller uploaded, with no name and no price on it.
 *
 * Split down the middle: the photograph earns half the card, the facts get the
 * other half on the shop's own background.
 */
export default async function Image({
  params,
}: {
  params: Promise<{ handle: string; slug: string }>;
}) {
  const { handle, slug } = await params;
  const shop = await getShopByHandle(handle);
  const product = shop ? await getProductBySlug(shop.id, slug) : null;

  // Directly requestable, so it must not throw for a bad handle or slug.
  if (!shop || !product) {
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
  const photo = await fetchImage(product.images[0]?.url);
  const range = priceRange(product, product.variants);
  /*
   * The shop's own declared language, not `getShopLocale` — a card is fetched
   * by a scraper with no cookie and cached once for every viewer, so there is
   * no visitor here whose preference could apply.
   */
  const cardLocale = shop.locale ?? "en";
  const price = range.varies
    ? `From ${formatMoney(range.min, shop.currency, cardLocale)}`
    : formatMoney(range.min, shop.currency, cardLocale);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          background: t.background,
          color: t.ink,
        }}
      >
        {photo ? (
          <img
            src={photo}
            width={520}
            height={630}
            style={{ width: 520, height: 630, objectFit: "cover" }}
            alt=""
          />
        ) : (
          <div
            style={{
              width: 520,
              height: 630,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: t.accent,
              color: t.onAccent,
              fontSize: 200,
              fontWeight: 700,
            }}
          >
            {initial(product.title)}
          </div>
        )}

        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            padding: 64,
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <div style={{ fontSize: 26, color: t.muted, letterSpacing: 1 }}>
              {clamp(shop.name, 30).toUpperCase()}
            </div>
            <div
              style={{
                fontSize: product.title.length > 30 ? 52 : 64,
                fontWeight: 700,
                lineHeight: 1.08,
                letterSpacing: -1.2,
              }}
            >
              {clamp(product.title, 60)}
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
            {/* The price is the fact the card exists to carry, so it gets the
                accent and sits on its own line rather than in the body copy. */}
            <div
              style={{
                display: "flex",
                alignSelf: "flex-start",
                background: t.accent,
                color: t.onAccent,
                fontSize: 40,
                fontWeight: 700,
                padding: "14px 28px",
                borderRadius: 999,
              }}
            >
              {price}
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <SailoMark color={t.muted} size={28} />
              <div style={{ fontSize: 22, color: t.muted }}>
                {`sailo.store/${shop.handle}`}
              </div>
            </div>
          </div>
        </div>
      </div>
    ),
    size,
  );
}
