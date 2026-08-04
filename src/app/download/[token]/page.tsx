import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Clock, Download, FileDown, Lock, Store } from "lucide-react";
import { getDownloadByToken, downloadState } from "@/lib/downloads";
import { getShopT } from "@/i18n/server";
import { interpolate } from "@/i18n";
import { formatBytes, shopThemeVars } from "@/lib/utils";

/** A private link — never something a search engine should hold on to. */
export const metadata: Metadata = {
  title: "Your download",
  robots: { index: false, follow: false },
};

export default async function DownloadPage({
  params,
}: PageProps<"/download/[token]">) {
  const { token } = await params;
  const record = await getDownloadByToken(token);
  if (!record) notFound();

  const { order, shop, files } = record;
  const state = downloadState(order);
  const { locale, t, dir } = await getShopT(shop.locale);

  return (
    <div
      data-surface={shop.theme === "dark" ? "dark" : "light"}
      dir={dir}
      lang={locale}
      style={shopThemeVars(shop.accentColor)}
      className="min-h-screen"
    >
      <div className="mx-auto w-full max-w-[560px] px-4 pb-20 pt-10">
        <Link
          href={`/${shop.handle}`}
          className="text-muted mb-6 inline-flex items-center gap-1.5 text-sm transition hover:opacity-70"
        >
          <Store className="size-4" />
          {shop.name}
        </Link>

        <h1 className="text-2xl font-bold leading-tight tracking-tight">
          {t.download.title}
        </h1>
        <p className="text-muted mt-1 text-sm">
          {order.productTitle}
          {order.variantLabel ? ` — ${order.variantLabel}` : ""}
        </p>

        {state.open ? (
          <>
            <ul className="surface-card mt-6 divide-y divide-black/5 rounded-2xl">
              {files.map((file) => (
                <li key={file.id}>
                  <a
                    href={`/api/download/${token}/${file.id}`}
                    className="flex items-center gap-3 p-4 transition hover:opacity-70"
                  >
                    <FileDown className="size-5 shrink-0 opacity-60" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {file.name}
                      </span>
                      {file.sizeBytes ? (
                        <span className="text-muted block text-xs">
                          {formatBytes(file.sizeBytes)}
                        </span>
                      ) : null}
                    </span>
                    <span className="accent-bg flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold">
                      <Download className="size-3.5" />
                      {t.download.file}
                    </span>
                  </a>
                </li>
              ))}
            </ul>

            <div className="text-muted mt-4 space-y-1 text-xs">
              {state.remaining !== null ? (
                <p>
                  {interpolate(t.download.remaining, { count: state.remaining })}
                </p>
              ) : null}
              {order.downloadExpiresAt ? (
                <p className="flex items-center gap-1.5">
                  <Clock className="size-3.5" />
                  {interpolate(t.download.expires, {
                    date: order.downloadExpiresAt.toLocaleDateString(locale, {
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                    }),
                  })}
                </p>
              ) : null}
            </div>
          </>
        ) : (
          <div className="surface-card mt-6 flex items-start gap-3 rounded-2xl p-4">
            <Lock className="mt-0.5 size-5 shrink-0 opacity-60" />
            <p className="text-sm leading-relaxed">
              {!state.released
                ? interpolate(t.download.notReady, { shop: shop.name })
                : state.expired
                  ? interpolate(t.download.expired, { shop: shop.name })
                  : interpolate(t.download.usedUp, { shop: shop.name })}
              {shop.contactEmail ? (
                <span className="text-muted mt-1 block text-xs">
                  {interpolate(t.checkout.questions, {
                    email: shop.contactEmail,
                  })}
                </span>
              ) : null}
            </p>
          </div>
        )}

        <Link
          href={`/${shop.handle}`}
          className="surface-elevated mt-6 flex h-11 w-full items-center justify-center rounded-xl text-sm font-medium transition hover:opacity-70"
        >
          {interpolate(t.download.visitShop, { shop: shop.name })}
        </Link>
      </div>
    </div>
  );
}
