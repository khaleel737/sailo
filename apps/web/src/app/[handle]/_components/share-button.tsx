"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Check, Download, Link2, Mail, MoreHorizontal, Share, X } from "lucide-react";
import type { Dictionary } from "@sailo/i18n";
import { cn } from "@sailo/design-system/web/cn";

/**
 * The share button on a storefront, and the sheet it opens.
 *
 * Sellers already share their link by hand — copy from the address bar, paste
 * into a bio. This puts that motion one tap from the shop itself, for the
 * *buyer* too: the person most likely to hand a shop to a friend is the one
 * standing in it. The sheet offers the places those handoffs actually happen
 * (WhatsApp first, because that is where Sailo's orders land), a copy row,
 * and a QR code a seller can hold up at a market stall.
 *
 * Everything renders in the shop's own palette. The one deliberate exception
 * is the QR tile, which stays ink-on-white in a dark shop — a scanner needs
 * dark modules on a light ground, and a themed QR that fails to scan is
 * decoration.
 */
export function ShareButton({
  url,
  title,
  heading,
  qrFileName,
  t,
  className,
}: {
  /** Absolute canonical URL — built server-side so it never depends on the address bar. */
  url: string;
  /** What the link is called in the message a share composes. */
  title: string;
  /** Sheet heading: "Share this shop" or "Share this product". */
  heading: string;
  /** Basename for the downloaded QR PNG — the handle or the product slug. */
  qrFileName: string;
  t: Dictionary;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  /*
   * `navigator.share` exists on most phones and almost no desktops. Read as
   * an external store — false on the server, the real answer on the client —
   * so hydration has nothing to argue about.
   */
  const canNative = useSyncExternalStore(
    subscribeToNothing,
    () => "share" in navigator,
    () => false,
  );
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);

  /*
   * The QR is drawn lazily, in the browser, the first time the sheet opens —
   * `qrcode` is already a dependency of the ticket PDFs, but the storefront
   * bundle should not carry it for the majority of visits where nobody shares.
   */
  useEffect(() => {
    if (!open || qr) return;
    let cancelled = false;
    import("qrcode")
      .then((m) =>
        m.toDataURL(url, {
          width: 512,
          margin: 1,
          color: { dark: "#14140f", light: "#ffffff" },
        }),
      )
      .then((data) => {
        if (!cancelled) setQr(data);
        return null;
      })
      // No QR is a quieter failure than no sheet: the block simply stays absent.
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open, qr, url]);

  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(id);
  }, [copied]);

  function close() {
    setOpen(false);
    setCopied(false);
    // Hand focus back to the control that opened the dialog.
    triggerRef.current?.focus();
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      /*
       * Older in-app browsers (the Instagram WebView above all, which is
       * exactly where these links get opened) can lack the async clipboard.
       * The textarea dance still works there.
       */
      const el = document.createElement("textarea");
      el.value = url;
      el.setAttribute("readonly", "");
      el.style.position = "fixed";
      el.style.opacity = "0";
      document.body.appendChild(el);
      el.select();
      try {
        document.execCommand("copy");
      } catch {
        /* nothing left to try */
      }
      el.remove();
    }
    setCopied(true);
  }

  function nativeShare() {
    // Cancelling the OS sheet rejects; that is a choice, not an error.
    navigator.share({ title, url }).catch(() => {});
  }

  const enc = encodeURIComponent;
  const channels: { name: string; href: string; icon: React.ReactNode }[] = [
    {
      name: "WhatsApp",
      href: `https://wa.me/?text=${enc(`${title}\n${url}`)}`,
      icon: <WhatsAppIcon />,
    },
    {
      name: "Telegram",
      href: `https://t.me/share/url?url=${enc(url)}&text=${enc(title)}`,
      icon: <TelegramIcon />,
    },
    {
      name: "X",
      href: `https://x.com/intent/post?text=${enc(title)}&url=${enc(url)}`,
      icon: <XIcon />,
    },
    {
      name: "Facebook",
      href: `https://www.facebook.com/sharer/sharer.php?u=${enc(url)}`,
      icon: <FacebookIcon />,
    },
  ];

  // What the copy row shows: the link as a person would say it, no scheme.
  const displayUrl = url.replace(/^https?:\/\//, "");

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-label={heading}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={cn(
          "surface-card text-muted inline-flex size-10 items-center justify-center rounded-full pointer-coarse:size-11 transition hover:opacity-70",
          className,
        )}
      >
        <Share className="size-4.5" aria-hidden />
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-label={heading}
        >
          <button
            type="button"
            aria-label={t.common.close}
            onClick={close}
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
          />

          <div className="surface-card animate-rise relative flex max-h-[92dvh] w-full max-w-md flex-col overflow-hidden rounded-t-2xl sm:rounded-2xl">
            <button
              type="button"
              onClick={close}
              aria-label={t.common.close}
              autoFocus
              className="text-muted absolute end-4 top-4 z-10 grid place-items-center transition pointer-coarse:-m-3 pointer-coarse:size-11 hover:opacity-70"
            >
              <X className="size-5" />
            </button>

            <div className="overflow-y-auto overscroll-contain p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
              <h2 className="pe-8 text-base font-semibold">{heading}</h2>

              <div className="mt-4 grid grid-cols-4 gap-2">
                {channels.map((channel) => (
                  <a
                    key={channel.name}
                    href={channel.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="surface-elevated flex flex-col items-center gap-1.5 rounded-xl py-3 transition hover:opacity-70"
                  >
                    {channel.icon}
                    <span className="text-muted text-[0.6875rem] font-medium">
                      {channel.name}
                    </span>
                  </a>
                ))}

                <a
                  href={`mailto:?subject=${enc(title)}&body=${enc(url)}`}
                  className="surface-elevated flex flex-col items-center gap-1.5 rounded-xl py-3 transition hover:opacity-70"
                >
                  <Mail className="size-5" aria-hidden />
                  <span className="text-muted text-[0.6875rem] font-medium">
                    {t.share.email}
                  </span>
                </a>

                {canNative ? (
                  <button
                    type="button"
                    onClick={nativeShare}
                    className="surface-elevated flex flex-col items-center gap-1.5 rounded-xl py-3 transition hover:opacity-70"
                  >
                    <MoreHorizontal className="size-5" aria-hidden />
                    <span className="text-muted text-[0.6875rem] font-medium">
                      {t.share.more}
                    </span>
                  </button>
                ) : null}
              </div>

              <div className="surface-elevated mt-3 flex items-center gap-2 rounded-xl p-2 ps-3">
                {/* A URL reads left-to-right even inside an RTL storefront. */}
                <span dir="ltr" className="text-muted min-w-0 flex-1 truncate text-sm">
                  {displayUrl}
                </span>
                <button
                  type="button"
                  onClick={copy}
                  className={cn(
                    "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-3 text-sm font-medium transition",
                    copied ? "surface-card" : "accent-bg hover:opacity-90",
                  )}
                >
                  {copied ? (
                    <Check className="size-4" aria-hidden />
                  ) : (
                    <Link2 className="size-4" aria-hidden />
                  )}
                  {copied ? t.share.copied : t.share.copyLink}
                </button>
              </div>
              {/* Announced for screen readers; the visual state change is the button itself. */}
              <span aria-live="polite" className="sr-only">
                {copied ? t.share.copied : ""}
              </span>

              {qr ? (
                <div className="mt-4 flex flex-col items-center gap-2">
                  <div className="rounded-xl bg-white p-2.5 shadow-sm">
                    {/*
                      A data URI drawn on the client — next/image has nothing
                      to optimise here and would only proxy it.
                    */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={qr} alt={t.share.scanToOpen} className="size-36" />
                  </div>
                  <p className="text-muted text-xs">{t.share.scanToOpen}</p>
                  <a
                    href={qr}
                    download={`${qrFileName}-qr.png`}
                    className="text-muted inline-flex items-center gap-1.5 text-xs font-medium underline underline-offset-2 transition hover:opacity-70"
                  >
                    <Download className="size-3.5" aria-hidden />
                    {t.share.downloadQr}
                  </a>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

/** A store that never updates: whether this browser can share is a constant. */
function subscribeToNothing() {
  return () => {};
}

/*
 * Brand glyphs, hand-inlined at 24×24 from the marks' published geometry.
 * lucide dropped its brand icons, and a component library for four paths is
 * not worth a dependency. `currentColor` keeps them in the shop's ink rather
 * than four competing brand palettes.
 */
function WhatsAppIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" fill="currentColor" aria-hidden>
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
    </svg>
  );
}

function TelegramIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" fill="currentColor" aria-hidden>
      <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" fill="currentColor" aria-hidden>
      <path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z" />
    </svg>
  );
}

function FacebookIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" fill="currentColor" aria-hidden>
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
    </svg>
  );
}
