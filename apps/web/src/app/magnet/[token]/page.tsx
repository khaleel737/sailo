import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Download, FileDown } from "lucide-react";
import { eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { productFiles } from "@sailo/db/schema";
import { magnetForToken } from "@sailo/marketing/leads/server";
import { getShopT } from "@/i18n/server";
import { interpolate } from "@sailo/i18n";
import { PoweredBy } from "@/components/shared/powered-by";
import { formatBytes } from "@sailo/core/format";
import { shopThemeVars } from "@sailo/design-system/web/cn";

/* Reads a token from the URL, so there is nothing to prerender. */
export const instant = false;

/** A private link — never something a search engine should hold on to. */
export const metadata: Metadata = {
  title: "Your download",
  robots: { index: false, follow: false },
};

/**
 * Where a lead magnet is handed over — spec 07.
 *
 * Its own page rather than `/download/[token]`, and that is the deliberate
 * half of this feature. The order download page resolves an *order*: it renders
 * tickets, event join links and membership state, and the route behind it
 * writes `download_events` because a download is the whole of a digital sale's
 * chargeback evidence. A lead has none of those things and must never acquire
 * them — giving every one of those lines a second meaning to serve a free PDF
 * is how a money path stops being readable.
 *
 * So this page is the small one: the shop's chrome, the files, and nothing
 * else. What it shares with the order gate is the part worth sharing — the
 * stored-file guard, which lives in `@sailo/storage/urls` and is applied by the
 * route that streams the bytes.
 */
export default async function MagnetPage({
  params,
}: PageProps<"/magnet/[token]">) {
  const { token } = await params;
  const grant = await magnetForToken(token);
  /*
   * One answer for every failure — no such token, expired, shop gone. A page
   * that distinguished them would tell whoever is trying tokens which of their
   * guesses were once real.
   */
  if (!grant) notFound();

  const { lead, shop, product } = grant;
  const { t, dir } = await getShopT(shop.locale);

  const files = await getDb()
    .select()
    .from(productFiles)
    .where(eq(productFiles.productId, product.id));

  const left =
    product.downloadLimit === null
      ? null
      : Math.max(0, product.downloadLimit - lead.magnetDownloads);

  return (
    <div
      data-surface={shop.theme === "dark" ? "dark" : "light"}
      dir={dir}
      style={shopThemeVars(shop.accentColor)}
      className="min-h-screen px-4 py-10"
    >
      <div className="mx-auto max-w-lg space-y-5">
        <div>
          <h1 className="text-xl font-bold tracking-tight">{product.title}</h1>
          <p className="text-muted mt-1 text-sm">{shop.name}</p>
        </div>

        {files.length === 0 ? (
          <p className="text-muted text-sm">{t.download.notReady}</p>
        ) : (
          <ul className="space-y-2">
            {files.map((file) => (
              <li key={file.id}>
                <a
                  href={`/api/magnet/${token}/${file.id}`}
                  className="surface-elevated flex items-center gap-3 rounded-2xl p-4 text-sm font-medium"
                >
                  <FileDown className="size-5 shrink-0 opacity-70" />
                  <span className="min-w-0 flex-1 truncate">{file.name}</span>
                  {file.sizeBytes ? (
                    <span className="text-muted text-xs">
                      {formatBytes(file.sizeBytes)}
                    </span>
                  ) : null}
                  <Download className="size-4 shrink-0 opacity-70" />
                </a>
              </li>
            ))}
          </ul>
        )}

        {lead.magnetExpiresAt ? (
          <p className="text-muted text-xs">
            {interpolate(t.download.expires, {
              date: lead.magnetExpiresAt.toISOString().slice(0, 10),
            })}
          </p>
        ) : null}
        {left !== null ? (
          <p className="text-muted text-xs">
            {interpolate(t.download.remaining, { count: String(left) })}
          </p>
        ) : null}

        <Link href={`/${shop.handle}`} className="text-sm font-medium underline">
          {interpolate(t.download.visitShop, { shop: shop.name })}
        </Link>

        <PoweredBy shop={shop} t={t} />
      </div>
    </div>
  );
}
