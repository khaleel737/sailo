import "server-only";
import type { Shop } from "@sailo/db/schema";
import { formatMoney } from "@sailo/core/currency";
import { appOrigin } from "@sailo/core/origin";
import { ORDERS, send, sender, type SendResult } from "@sailo/mailer/transport";
import {
  button,
  detailTable,
  esc,
  fine,
  mutedPara,
  sailoLayout,
  section,
  strong,
  well,
} from "@sailo/mailer/markup";
import { playbookFor } from "@sailo/core/disputes";

/**
 * What a seller is told when a bank takes their money back.
 *
 * The most consequential mail Sailo sends. Everything else here reports
 * something that has finished happening; these arrive with a clock running, and
 * the thing that answers a chargeback is usually a document only the seller has.
 * A seller who does not read this loses by default — not because the case was
 * weak, but because nobody sent the carrier's proof of delivery.
 *
 * Three rules, all of them learned from what makes this kind of mail useless:
 *
 * 1. **Say what has happened to the money, exactly.** An inquiry has taken
 *    nothing; a chargeback has taken the amount *and* a fee. "A dispute was
 *    opened on your $42 sale" is wrong in both directions depending on which it
 *    is, and a seller reconciling their bank against it finds a number that does
 *    not exist.
 * 2. **Ask for one thing.** The playbook already knows which evidence decides
 *    this reason for this kind of sale. A list of nine possible documents is a
 *    list nobody actions.
 * 3. **Never mention a rate.** A seller cannot act on a ratio and one they are
 *    close to reads as a threat from their own software. Deadlines and documents
 *    are actionable; the rate is /hq's business.
 *
 * Same contract as every builder in this package: returns a `SendResult`, never
 * throws. Whether to send at all — the claim that makes it idempotent, the
 * address, the ceiling — is `@sailo/workflows/disputes`.
 */

const appUrl = appOrigin;

/** Where all of these point: the payments page, which is where the case is. */
function paymentsUrl(): string {
  return `${appUrl()}/admin/payments`;
}

function deadlineLine(dueBy: Date | null, now: Date): string | null {
  if (!dueBy) return null;
  const days = Math.floor((dueBy.getTime() - now.getTime()) / 86_400_000);
  if (days < 0) return "The deadline has passed.";
  if (days === 0) return "The deadline is today.";
  if (days === 1) return "You have until tomorrow.";
  return `You have ${days} days.`;
}

export type DisputeNotice = {
  shop: Shop;
  to: string;
  /** Resolved by the caller: `shop.contactEmail`, else the account email. */
  amountCents: number;
  feeCents: number;
  deductedCents: number;
  currency: string;
  reason: string;
  dueBy: Date | null;
  /** True while the bank is only asking — no money has moved. */
  inquiry: boolean;
  /** What the buyer bought, for recognising which sale this is. */
  orderTitle: string | null;
  /** The documents this case needs and Sailo does not hold. */
  missing: readonly string[];
  now?: Date;
};

/**
 * "A buyer disputed a payment."
 *
 * Sent once, on the event that opens the case. The subject names the amount
 * because that is what makes it get opened — a seller scanning an inbox for
 * something urgent recognises their own money faster than they recognise the
 * word "dispute".
 */
export async function sendSellerDisputeOpened(
  opts: DisputeNotice,
): Promise<SendResult> {
  const {
    shop,
    to,
    amountCents,
    feeCents,
    deductedCents,
    currency,
    reason,
    dueBy,
    inquiry,
    orderTitle,
    missing,
  } = opts;
  const now = opts.now ?? new Date();

  const playbook = playbookFor(reason);
  const amount = formatMoney(amountCents, currency);
  const deadline = deadlineLine(dueBy, now);

  /*
   * Bank debits and card disputes are answered by completely different work.
   * A `bank_debit` return has no issuer to persuade — the payer's own bank sent
   * the money back — so a seller handed an evidence checklist for one is being
   * sent to do something that cannot change the outcome.
   */
  const isCard = playbook.rail === "card";

  const money = inquiry
    ? mutedPara(
        `Nothing has been taken. ${strong(esc(amount))} is being questioned, and answering well usually stops it becoming a chargeback — which is when the money actually moves.`,
      )
    : mutedPara(
        `${strong(esc(formatMoney(deductedCents || amountCents + feeCents, currency)))} has been taken out of your balance: ` +
          `the ${esc(amount)} sale${feeCents > 0 ? `, plus the ${esc(formatMoney(feeCents, currency))} chargeback fee the card network charges whatever the outcome` : ""}. ` +
          `You get the sale amount back if you win.`,
      );

  const ask = !isCard
    ? mutedPara(
        "This one came back through the payer's own bank rather than a card network, so there is no evidence to send and nothing to contest. If the goods have not gone out, hold them; otherwise invoice again.",
      )
    : missing.length > 0
      ? section(
          "What we still need from you",
          `${well(missing.map((line) => `• ${esc(line)}`).join("<br />"))}` +
            fine(
              "Everything else is already on file — the buyer's details, their address, what they were charged, when they agreed to your terms. These are the ones only you have. PDF, JPEG or PNG, 4.5 MB across them all.",
            ),
        )
      : section(
          "What happens next",
          mutedPara(
            "Everything the bank asks for is already on file, so there is nothing you need to send. We will answer it before the deadline.",
          ),
        );

  const body = `
    ${mutedPara(
      `${strong(esc(orderTitle ?? "A payment"))} on ${esc(shop.name)} has been disputed by the buyer's bank.`,
    )}
    ${money}
    ${section(
      "What the bank says",
      detailTable([
        { label: "Reason", value: playbook.label },
        { label: "Amount", value: amount },
        ...(dueBy
          ? [{ label: "Respond by", value: dueBy.toISOString().slice(0, 10) }]
          : []),
      ]),
    )}
    ${isCard ? mutedPara(esc(playbook.guidance)) : ""}
    ${ask}
    ${button(paymentsUrl(), "Open your payments page")}
    ${
      deadline && isCard
        ? fine(
            `${deadline} The bank closes the window itself — evidence sent a minute late is not late, it is unanswered.`,
          )
        : ""
    }
  `;

  return send({
    from: sender("Sailo", ORDERS),
    to,
    subject: inquiry
      ? `A buyer's bank is asking about a ${amount} payment`
      : `${amount} has been charged back — ${deadline ?? "action needed"}`,
    html: sailoLayout(
      inquiry ? "A bank is questioning a payment" : "A buyer disputed a payment",
      body,
      {
        preheader: inquiry
          ? `No money has moved yet. ${deadline ?? ""}`.trim()
          : `${formatMoney(deductedCents || amountCents + feeCents, currency)} out of your balance. ${deadline ?? ""}`.trim(),
      },
    ),
  });
}

/**
 * The nudge, a few days out.
 *
 * Twenty-odd days is long enough to read the first mail, mean to deal with it,
 * and forget. Sent once — the columns behind it exist so that a seller is nagged
 * exactly once rather than every time the sweep runs, which is how a useful
 * reminder becomes filtered mail.
 */
export async function sendSellerDisputeDeadline(
  opts: DisputeNotice,
): Promise<SendResult> {
  const { shop, to, amountCents, currency, reason, dueBy, missing, orderTitle } = opts;
  const now = opts.now ?? new Date();

  const playbook = playbookFor(reason);
  const amount = formatMoney(amountCents, currency);
  const deadline = deadlineLine(dueBy, now) ?? "The deadline is close.";

  const body = `
    ${mutedPara(
      `The chargeback on ${strong(esc(orderTitle ?? "a payment"))} at ${esc(shop.name)} still needs answering. ${esc(deadline)}`,
    )}
    ${section(
      "The case",
      detailTable([
        { label: "Reason", value: playbook.label },
        { label: "Amount", value: amount },
        ...(dueBy
          ? [{ label: "Respond by", value: dueBy.toISOString().slice(0, 10) }]
          : []),
      ]),
    )}
    ${
      missing.length > 0
        ? section(
            "Still missing",
            `${well(missing.map((line) => `• ${esc(line)}`).join("<br />"))}` +
              fine(
                "Without these the case is answered with what we hold, which for this reason is not usually enough.",
              ),
          )
        : mutedPara(
            "Everything the bank asks for is on file. Nothing is needed from you — this is only a note that the case is still open.",
          )
    }
    ${button(paymentsUrl(), "Open your payments page")}
    ${fine("After the deadline the bank stops accepting evidence, and the case is decided on what was sent.")}
  `;

  return send({
    from: sender("Sailo", ORDERS),
    to,
    subject: `${deadline} — ${amount} chargeback still unanswered`,
    html: sailoLayout("A chargeback deadline is close", body, {
      preheader: `${deadline} ${missing.length > 0 ? `Still missing: ${missing[0]}` : "Everything is on file."}`,
    }),
  });
}

/**
 * How it ended.
 *
 * Worth sending on a win as much as a loss. A seller who was told money left and
 * never told it came back reconciles a hole that is not there, and rings support
 * about it.
 */
export async function sendSellerDisputeClosed(opts: {
  shop: Shop;
  to: string;
  amountCents: number;
  feeCents: number;
  currency: string;
  reason: string;
  orderTitle: string | null;
  /** Stripe's terminal status: `won`, `lost`, or a deflected inquiry. */
  status: string;
}): Promise<SendResult> {
  const { shop, to, amountCents, feeCents, currency, reason, orderTitle, status } =
    opts;

  const won = status === "won";
  const prevented = status === "warning_closed" || status === "prevented";
  const amount = formatMoney(amountCents, currency);
  const playbook = playbookFor(reason);

  const body = won
    ? `
      ${mutedPara(
        `The bank decided in your favour on ${strong(esc(orderTitle ?? "a disputed payment"))} at ${esc(shop.name)}.`,
      )}
      ${mutedPara(`${strong(esc(amount))} has gone back into your balance.`)}
      ${
        feeCents > 0
          ? fine(
              `The ${esc(formatMoney(feeCents, currency))} chargeback fee is not returned. The card network charges it for handling the case, whoever wins.`,
            )
          : ""
      }
      ${button(paymentsUrl(), "Open your payments page")}
    `
    : prevented
      ? `
      ${mutedPara(
        `The bank's question about ${strong(esc(orderTitle ?? "a payment"))} at ${esc(shop.name)} has been closed without becoming a chargeback.`,
      )}
      ${mutedPara("No money moved, and nothing further is needed.")}
      ${button(paymentsUrl(), "Open your payments page")}
    `
      : `
      ${mutedPara(
        `The bank decided against us on ${strong(esc(orderTitle ?? "a disputed payment"))} at ${esc(shop.name)}.`,
      )}
      ${mutedPara(
        `${strong(esc(amount))} stays with the buyer${feeCents > 0 ? `, and the ${esc(formatMoney(feeCents, currency))} chargeback fee stands` : ""}. There is no further appeal through Stripe.`,
      )}
      ${section("What decides this kind of case", mutedPara(esc(playbook.guidance)))}
      ${fine(
        "Losing one is not a mark against your shop on its own. What the card networks watch is how many disputes are raised, not how many are lost — so the thing worth changing is whatever led to the buyer calling their bank.",
      )}
      ${button(paymentsUrl(), "Open your payments page")}
    `;

  return send({
    from: sender("Sailo", ORDERS),
    to,
    subject: won
      ? `You won the ${amount} chargeback`
      : prevented
        ? `The question about ${amount} is closed`
        : `The ${amount} chargeback was lost`,
    html: sailoLayout(
      won
        ? "You won the chargeback"
        : prevented
          ? "Closed, with no chargeback"
          : "The chargeback was lost",
      body,
    ),
  });
}

/**
 * The one email that can prevent a chargeback rather than answer one.
 *
 * An early fraud warning is the issuer telling the network the cardholder has
 * called this transaction fraud. A chargeback almost always follows within days,
 * and refunding *first* avoids both the chargeback and its fee.
 *
 * The wording has to be careful about what refunding does not fix: the fraud
 * report itself still counts towards Visa's ratio either way. So this is framed
 * as keeping the goods, not as keeping a record clean — a seller who believes
 * refunding erases the report will be surprised later, and by something they
 * cannot undo.
 */
export async function sendSellerFraudWarning(opts: {
  shop: Shop;
  to: string;
  amountCents: number;
  currency: string;
  fraudType: string;
  orderTitle: string | null;
  orderId: string | null;
}): Promise<SendResult> {
  const { shop, to, amountCents, currency, fraudType, orderTitle, orderId } = opts;
  const amount = formatMoney(amountCents, currency);

  const body = `
    ${mutedPara(
      `The cardholder's bank has reported ${strong(esc(orderTitle ?? "a payment"))} on ${esc(shop.name)} as fraud.`,
    )}
    ${mutedPara(
      `This is a warning, not a chargeback — the money is still yours today. A chargeback usually follows within a few days, and if it does you lose the ${esc(amount)} ${strong("and")} a chargeback fee on top.`,
    )}
    ${section(
      "The report",
      detailTable([
        { label: "Amount", value: amount },
        { label: "Reported as", value: fraudType.replace(/_/g, " ") },
      ]),
    )}
    ${section(
      "What you can do",
      mutedPara(
        "Refunding now normally stops the chargeback and its fee. If nothing has shipped, this is almost always the right call — you keep the goods and lose only the sale.",
      ) +
        mutedPara(
          "If it has shipped, or you believe the charge is genuine, leave it and gather your proof of delivery. We will answer the chargeback if one arrives.",
        ),
    )}
    ${button(orderId ? `${appUrl()}/admin/orders/${orderId}` : paymentsUrl(), orderId ? "Open the order" : "Open your payments page")}
    ${fine(
      "Refunding does not remove the fraud report itself — that stays on the card network's record for this payment either way. What it avoids is losing the goods as well as the money.",
    )}
  `;

  return send({
    from: sender("Sailo", ORDERS),
    to,
    subject: `Fraud warning on a ${amount} payment — refunding now avoids the chargeback`,
    html: sailoLayout("A payment has been reported as fraud", body, {
      preheader: `A chargeback usually follows within days. Refunding first avoids it and the fee.`,
    }),
  });
}
