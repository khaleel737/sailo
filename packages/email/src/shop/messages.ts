import "server-only";
import { PARTNERS, send, sender, type SendResult } from "../transport";
import {
  button,
  esc,
  fine,
  link,
  mutedPara,
  sailoLayout,
  section,
  strong,
} from "../markup";

/**
 * What the people running a shop are told about its arrangements.
 *
 * A seller and their affiliates, never a buyer. These exist because somebody
 * has money to notice or a setting to check — an affiliate was approved,
 * payout details changed.
 *
 * The notices that fire from a shop's own trade — an order arrived, a booking
 * needs answering, a webhook was switched off — are in `./seller.ts`.
 */

/**
 * Sent the moment someone becomes an active affiliate — approved from the
 * waiting list or added by the seller. This is how they learn where their
 * report lives; without it the only copy of the portal link sits in the
 * seller's admin, waiting to be pasted into a chat that may never happen.
 */
export async function sendAffiliateWelcome(opts: {
  to: string;
  shopName: string;
  /** "10" — already formatted, the way the shop shows it. */
  percent: string;
  shareUrl: string;
  portalUrl: string;
}): Promise<SendResult> {
  const { to, shopName, percent, shareUrl, portalUrl } = opts;

  // Share URLs run long; without a break they widen the card off a phone.
  const linkPara = (href: string) =>
    `<p style="margin:0;font-size:15px;line-height:1.6;word-break:break-all;">${link(href, href)}</p>`;

  const html = sailoLayout(
    `You're in — share ${esc(shopName)}, earn ${esc(percent)}%`,
    `${mutedPara(
      `Every order placed through your link earns you ${strong(`${percent}%`)} of the sale.`,
    )}
      ${section("Your link to share", linkPara(shareUrl))}
      ${section("Your referral report", linkPara(portalUrl))}
      ${fine(
        `The report shows your clicks, orders and what you're owed, and it's where you tell ${esc(shopName)} how you'd like to be paid. Keep the link to yourself: anyone who has it can see your earnings.`,
      )}`,
    { preheader: `Share ${shopName} and earn ${percent}% of every order.` },
  );

  return send({
    from: sender("Sailo", PARTNERS),
    to,
    subject: `Share ${shopName}, earn ${percent}% of every order`,
    html,
  });
}

/**
 * Sent to the affiliate whenever the payout details on their report change.
 *
 * This mail is the countermeasure to the portal's one real attack. The report
 * is opened by a bare link, and a leaked link would let a stranger quietly
 * point the commission at their own account. The change still goes through —
 * the token is the only credential there is — but it can never go through
 * silently: the owner of the email always hears about it, and the mail tells
 * them exactly which lever to pull if it wasn't them.
 */
export async function sendPayoutDetailsChanged(opts: {
  to: string;
  shopName: string;
  /** "Bank transfer" — English, like every mail Sailo sends. */
  methodLabel: string;
  /** Already masked. This mail must not be a second copy of the details. */
  maskedDetails: string;
  portalUrl: string;
}): Promise<SendResult> {
  const { to, shopName, methodLabel, maskedDetails, portalUrl } = opts;

  const html = sailoLayout(
    "Your payout details changed",
    `${mutedPara(
      `The payout details on your referral report for ${esc(shopName)} were just changed to ${strong(`${methodLabel} · ${maskedDetails}`)}.`,
    )}
      ${mutedPara(
        `If that was you, you're done. If it wasn't, someone else has your report link: open your report, put your own details back, and reset the link — the old one stops working the moment you do. Then tell ${esc(shopName)} so they hold your payout.`,
      )}
      ${button(portalUrl, "Open your report")}`,
    { preheader: `Payout details for ${shopName} are now ${methodLabel} · ${maskedDetails}.` },
  );

  return send({
    from: sender("Sailo", PARTNERS),
    to,
    subject: "Your payout details changed",
    html,
  });
}

