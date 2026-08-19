import "server-only";
import {
  downloadExpiry,
  hasDeliverableFiles,
  newDownloadToken,
  releasesImmediately,
} from "../orders/downloads";
import { isCodeSource } from "../catalog/code-pool";
import { smallest, soonest } from "./fulfilment";
import type { ResolvedLine } from "../orders/types";

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
 *
 * A LINK OR A CODE IS ALSO SOMETHING TO DELIVER — spec 48
 *
 * Before this only files minted a token, so a product whose whole good was a
 * licence key or a Notion invite had no delivery page at all: `0034` gave the
 * three modes equal standing and this function knew about one of them.
 * `digitalAccessForOrder` was written to gate a link and a code on
 * `downloadReleasedAt` and could never fire, because nothing set it.
 *
 * So `deliversAccess` is the other half. It carries no expiry and no download
 * cap — a code is not a fetch, and counting one against `downloadLimit` would
 * spend a buyer's file allowance on reading their own key — but it does mint
 * the token and it does take part in the "unlock now" agreement, because the
 * string is the good and handing it to an unpaid order gives the good away.
 */

export type DigitalDelivery = {
  /** True when at least one line has a file actually attached to it. */
  deliversFiles: boolean;
  /** True when at least one line hands over a link or a code. */
  deliversAccess: boolean;
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
  const fileLines: ResolvedLine[] = [];
  const accessLines: ResolvedLine[] = [];

  for (const line of opts.lines) {
    if (line.kind !== "digital") continue;
    /*
     * Per combination, not per product — the variant the buyer actually bought
     * is the one whose files decide whether there is anything to send.
     */
    if (await hasDeliverableFiles(line.productId, line.variantId ?? null)) {
      fileLines.push(line);
    }
    if (handsOverAccess(line.product)) accessLines.push(line);
  }

  const deliversFiles = fileLines.length > 0;
  const deliversAccess = accessLines.length > 0;

  if (!deliversFiles && !deliversAccess) {
    return {
      deliversFiles: false,
      deliversAccess: false,
      unlockNow: false,
      downloadToken: null,
      downloadExpiresAt: null,
      downloadLimit: null,
    };
  }

  return {
    deliversFiles,
    deliversAccess,
    /*
     * Every gated line has to agree, across both halves. One token cannot be
     * half-open, so a basket holding a free sample and a licence key held
     * until payment is held until payment.
     */
    unlockNow: [...fileLines, ...accessLines].every((line) =>
      releasesImmediately(line.product, {
        totalCents: opts.totalCents,
        paymentStatus: "unpaid",
      }),
    ),
    downloadToken: newDownloadToken(),
    /*
     * The shortest window and the tightest cap, so no line outlives its terms
     * — and read from the *file* lines only. An expiry on a code line would
     * take a buyer's own licence key off their page a month later, and a
     * download cap counted against reading a string would be the refused-file
     * bug all over again: `downloadLimit` counts fetches, and a code is not a
     * fetch.
     */
    downloadExpiresAt: soonest(
      fileLines.map((line) =>
        downloadExpiry(line.product.downloadExpiryDays, opts.now),
      ),
    ),
    downloadLimit: smallest(fileLines.map((line) => line.product.downloadLimit)),
  };
}

/**
 * Whether this product's good is a string rather than bytes.
 *
 * A shared code or link is one the seller typed; a pool or a generated pattern
 * is one minted per buyer. All four are "there is something to hand over on
 * the delivery page", which is the question the token answers.
 */
function handsOverAccess(product: ResolvedLine["product"]): boolean {
  if (product.kind !== "digital") return false;
  if (isCodeSource(product.codeSource)) return true;
  if (product.digitalDelivery === "link") return Boolean(product.digitalLinkUrl);
  if (product.digitalDelivery === "code") return Boolean(product.digitalAccessDetails);
  return false;
}
