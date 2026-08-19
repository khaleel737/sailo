"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Check, Copy, Download, ExternalLink, QrCode, Share2 } from "lucide-react";
import { Button, Dialog } from "@sailo/design-system/web";
import { cn } from "@sailo/design-system/web/cn";
import { interpolate } from "@sailo/i18n";
import { useAdminT } from "./admin-i18n";

/**
 * The admin's share dialog — a link as a picture.
 *
 * The storefront has had this for buyers (`[handle]/_components/share-button`);
 * the seller's own panel showed the same links as bare text with a copy
 * button, which answers "put it in my bio" and nothing else. The QR answers
 * the other half of how a link actually travels: a market stall, a counter
 * card, a slide at the end of a talk, a phone held up to another phone.
 *
 * One dialog for every admin link that leaves the building — the shop itself
 * on the overview, the sign-up form on broadcasts — so the seller learns the
 * shape once. The QR is drawn lazily in the browser on first open: `qrcode`
 * is already a dependency of the ticket PDFs, and the panel bundle should not
 * carry it for the visits where nobody shares.
 *
 * The tile stays ink-on-white whatever surrounds it. A scanner needs dark
 * modules on a light ground; a themed QR that fails to scan is decoration.
 */
export function ShareLinkButton({
  url,
  title,
  body,
  fileName,
  variant = "secondary",
  label,
}: {
  /** Absolute URL — built server-side so it never depends on the address bar. */
  url: string;
  /** Dialog heading: "Share your shop", "Share your sign-up link". */
  title: string;
  /** One line under the heading saying where a scan lands. */
  body: string;
  /** Basename for the downloaded PNG — the handle, or what the link is. */
  fileName: string;
  /** `onDark` sits in the ink hero; `secondary` anywhere on a light card. */
  variant?: "onDark" | "secondary";
  /** Trigger text. Defaults to the dictionary's "Share". */
  label?: string;
}) {
  const a = useAdminT();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "focus-ring press inline-flex shrink-0 items-center rounded-xl transition pointer-coarse:h-11",
          // Sized to whichever row it sits in: the hero's h-9 chips, or the
          // design system's md buttons on a light card.
          variant === "onDark"
            ? "h-9 gap-1.5 bg-white/15 px-3.5 text-xs font-semibold text-white hover:bg-white/25"
            : "h-10 gap-2 border border-ink-200 bg-white px-4 text-sm font-medium text-ink-900 shadow-xs hover:border-ink-300 hover:bg-ink-50",
        )}
      >
        <QrCode className={variant === "onDark" ? "size-3.5" : "size-4"} />
        {label ?? a.share.share}
      </button>

      <ShareLinkDialog
        open={open}
        onClose={() => setOpen(false)}
        url={url}
        title={title}
        body={body}
        fileName={fileName}
      />
    </>
  );
}

/** `navigator.share` exists on most phones and almost no desktops. Read as an
 *  external store — false on the server, the real answer on the client — so
 *  hydration has nothing to argue about. */
function subscribeToNothing() {
  return () => {};
}

function ShareLinkDialog({
  open,
  onClose,
  url,
  title,
  body,
  fileName,
}: {
  open: boolean;
  onClose: () => void;
  url: string;
  title: string;
  body: string;
  fileName: string;
}) {
  const a = useAdminT();
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const canNative = useSyncExternalStore(
    subscribeToNothing,
    () => "share" in navigator,
    () => false,
  );

  /*
   * Drawn once per URL, on first open. 512px is crisp on the dialog's ~200px
   * tile and prints cleanly at business-card size; `margin: 2` keeps the
   * quiet zone scanners want even when the PNG is dropped onto a busy flyer.
   */
  useEffect(() => {
    if (!open || qr) return;
    let cancelled = false;
    import("qrcode")
      .then((m) =>
        m.toDataURL(url, {
          width: 512,
          margin: 2,
          color: { dark: "#101014", light: "#ffffff" },
        }),
      )
      .then((data) => {
        if (!cancelled) setQr(data);
        return null;
      })
      // No QR is a quieter failure than no dialog — the link half still works.
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

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // Clipboard can be blocked — the address is on screen and selectable.
    }
  }

  const displayUrl = url.replace(/^https?:\/\//, "");

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={body}
      size="sm"
      closeLabel={a.common.cancel}
      footer={
        <>
          {qr ? (
            <a
              href={qr}
              download={`${fileName}-qr.png`}
              className="focus-ring press inline-flex h-10 items-center gap-2 rounded-xl border border-ink-200 bg-white px-4 text-sm font-medium text-ink-900 shadow-xs transition hover:border-ink-300 hover:bg-ink-50 pointer-coarse:h-11"
            >
              <Download className="size-4" />
              {a.share.downloadQr}
            </a>
          ) : null}
          {canNative ? (
            <Button
              type="button"
              onClick={() => navigator.share({ title, url }).catch(() => {})}
            >
              <Share2 className="size-4" />
              {a.share.share}
            </Button>
          ) : (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="focus-ring press inline-flex h-10 items-center gap-2 rounded-xl bg-ink-900 px-4 text-sm font-medium text-white shadow-xs transition hover:bg-ink-800 pointer-coarse:h-11"
            >
              <ExternalLink className="size-4" />
              {a.common.visit}
            </a>
          )}
        </>
      }
    >
      <div className="flex flex-col items-center gap-4">
        {/*
          The tile. A fixed box either way, so the dialog doesn't jump when
          the code lands — the skeleton and the image are the same size.
        */}
        {qr ? (
          /* A data: URI drawn in this same browser — next/image would add a
             proxy hop and optimize nothing. */
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={qr}
            alt={interpolate(a.share.qrAlt, { url: displayUrl })}
            width={208}
            height={208}
            className="animate-pop size-52 rounded-2xl border border-ink-200 bg-white p-3 shadow-xs"
          />
        ) : (
          <div
            role="status"
            aria-label={a.share.drawing}
            className="skeleton size-52 rounded-2xl"
          />
        )}

        <div className="flex w-full items-center gap-2 rounded-xl border border-ink-200 bg-ink-50 p-1.5 ps-3">
          <code dir="ltr" className="min-w-0 flex-1 truncate text-xs text-ink-700">
            {displayUrl}
          </code>
          <button
            type="button"
            onClick={copy}
            className="focus-ring press inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-white px-3 text-xs font-semibold text-ink-900 shadow-xs transition hover:bg-ink-100 pointer-coarse:h-11"
          >
            {copied ? (
              <Check className="animate-pop size-3.5 text-brand-600" strokeWidth={3} />
            ) : (
              <Copy className="size-3.5" />
            )}
            {copied ? a.broadcasts.copied : a.broadcasts.copyLink}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
