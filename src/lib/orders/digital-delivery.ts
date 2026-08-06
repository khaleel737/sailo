import "server-only";
import {
  downloadExpiry,
  hasDeliverableFiles,
  newDownloadToken,
  releasesImmediately,
} from "@/lib/downloads";
import { smallest, soonest } from "@/lib/orders/delivery";
import type { ResolvedLine } from "@/lib/orders/types";

/**
 * What an order's files are, and when the buyer may have them.
 *
 * One link covers every downloadable line in the basket rather than one per
 * product, so the terms have to be reconciled across lines that may disagree.
 * The strictest wins every time: the soonest expiry, the smallest download
 * cap, and — the one that matters — files open early only if *every*
 * downloadable line is willing. One line held until payment holds all of them,
 * because a single link cannot be half-unlocked.
 *
 * `kind === "digital"` is not sufficient on its own. A seller can mark a
 * product digital and not have uploaded the file yet, and minting a token for
 * an order with nothing behind it gives the buyer a link to an empty page.
 */

export type DigitalDelivery = {
  /** True when at least one line has a file actually attached to it. */
  deliversFiles: boolean;
  /** True when those files open without waiting for the money. */
  unlockNow: boolean;
  /** Null when there is nothing to deliver — its presence is the authority. */
  downloadToken: string | null;
  downloadExpiresAt: Date | null;
  downloadLimit: number | null;
};

export async function resolveDigitalDelivery(opts: {
  lines: ResolvedLine[];
  totalCents: number;
  now: Date;
}): Promise<DigitalDelivery> {
  const digitalLines: ResolvedLine[] = [];
  for (const line of opts.lines) {
    if (line.kind !== "digital") continue;
    if (await hasDeliverableFiles(line.productId)) digitalLines.push(line);
  }

  const deliversFiles = digitalLines.length > 0;
  if (!deliversFiles) {
    return {
      deliversFiles: false,
      unlockNow: false,
      downloadToken: null,
      downloadExpiresAt: null,
      downloadLimit: null,
    };
  }

  return {
    deliversFiles: true,
    unlockNow: digitalLines.every((line) =>
      releasesImmediately(line.product, {
        totalCents: opts.totalCents,
        paymentStatus: "unpaid",
      }),
    ),
    downloadToken: newDownloadToken(),
    // The shortest window and the tightest cap, so no line outlives its terms.
    downloadExpiresAt: soonest(
      digitalLines.map((line) =>
        downloadExpiry(line.product.downloadExpiryDays, opts.now),
      ),
    ),
    downloadLimit: smallest(digitalLines.map((line) => line.product.downloadLimit)),
  };
}
