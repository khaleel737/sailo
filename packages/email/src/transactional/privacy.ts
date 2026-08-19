import "server-only";
import { ORDERS, send, sender, type SendResult } from "@sailo/mailer/transport";
import {
  button,
  esc,
  fine,
  mutedPara,
  para,
  sailoLayout,
  section,
  strong,
} from "@sailo/mailer/markup";

/**
 * The two mails a buyer's data request needs. Spec 52.
 *
 * Transactional in the strictest sense: neither is marketing, neither carries an
 * unsubscribe link, and both are sent to an address *because that address asked*
 * — which is also why the first one is the only thing standing between a public
 * form and a deletion primitive.
 *
 * ## The confirmation mail is the security control
 *
 * Nothing is assembled and nothing is deleted until this link is clicked. That
 * makes the mail itself the verification, and it has to read as one: it says
 * what was asked for, it says that nothing has happened yet, and it says what
 * to do if the reader did not ask — because the case where somebody *else*
 * typed their address into a shop's form is exactly the case the link defends
 * against.
 *
 * ## The export mail carries a link and never a file
 *
 * Personal data as an attachment is personal data in an inbox for ever, which is
 * the thing being asked about. The link expires and the object behind it is
 * actually deleted by the hourly sweep, so "expired" means gone rather than
 * merely unlinked.
 */

const KIND_WORDS: Record<string, string> = {
  access: "a copy of the information this shop holds about you",
  portability: "a portable copy of the information this shop holds about you",
  erasure: "the information this shop holds about you to be deleted",
};

/**
 * "Confirm it's you" — the mail that turns a form submission into a request.
 *
 * Sent to whatever address was typed, which is the point: an address that did
 * not ask receives a mail saying so and can ignore it, and the request expires
 * unverified.
 */
export async function sendDataRequestVerification(opts: {
  to: string;
  shopName: string;
  kind: string;
  verifyUrl: string;
  /** Days the link is good for, so the mail can say rather than imply. */
  expiresInDays: number;
}): Promise<SendResult> {
  const asked = KIND_WORDS[opts.kind] ?? "your data";

  const html = sailoLayout(
    `Confirm your request to ${esc(opts.shopName)}`,
    `${para(
      `Somebody asked ${strong(esc(opts.shopName))} for ${esc(asked)}, using this email address.`,
    )}
      ${mutedPara(
        `Nothing has happened yet, and nothing will until you click below. ${strong("We have not looked anything up and we have not deleted anything.")}`,
      )}
      ${section("", button(opts.verifyUrl, "Yes, this was me"))}
      ${fine(
        `The link works for ${opts.expiresInDays} days. If you did not make this request, ignore this email — without that click nothing is assembled, sent or removed.`,
      )}`,
    {
      preheader: `Confirm your data request to ${opts.shopName}. Nothing happens until you do.`,
    },
  );

  return send({
    from: sender("Sailo", ORDERS),
    to: opts.to,
    subject: `Confirm your request to ${opts.shopName}`,
    html,
  });
}

/** "Your copy is ready" — a link, never an attachment, and it expires. */
export async function sendDataExportReady(opts: {
  to: string;
  shopName: string;
  downloadUrl: string;
  expiresInDays: number;
}): Promise<SendResult> {
  const html = sailoLayout(
    `Your data from ${esc(opts.shopName)}`,
    `${para(
      `${strong(esc(opts.shopName))} has put together everything they hold about you.`,
    )}
      ${section("", button(opts.downloadUrl, "Download your copy"))}
      ${fine(
        `This link works for ${opts.expiresInDays} days, after which the file is deleted from our servers. We send a link rather than an attachment so that your data does not sit in an inbox for ever. This covers this shop only — other shops on Sailo keep their own separate records.`,
      )}`,
    { preheader: `Your copy is ready, and the link expires in ${opts.expiresInDays} days.` },
  );

  return send({
    from: sender("Sailo", ORDERS),
    to: opts.to,
    subject: `Your data from ${opts.shopName}`,
    html,
  });
}

/**
 * "Here is what we did" — the answer to an erasure, including the refusals.
 *
 * A refusal is an answer: where retention is required the mail names which
 * data, why, and for how long, from the decision table rather than from a
 * sentence somebody typed. `statement` is `erasureStatement`'s output.
 */
export async function sendErasureCompleted(opts: {
  to: string;
  shopName: string;
  statement: string;
}): Promise<SendResult> {
  const lines = opts.statement
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => mutedPara(esc(line)))
    .join("");

  const html = sailoLayout(
    `Your deletion request to ${esc(opts.shopName)}`,
    `${para(`${strong(esc(opts.shopName))} has acted on your request.`)}
      ${section("", lines)}
      ${fine(
        "Some records must be kept by law even after a deletion request — an invoice is a tax record and cannot be unmade. Where that applies it is named above, with the reason.",
      )}`,
    { preheader: `What ${opts.shopName} deleted, and what they had to keep.` },
  );

  return send({
    from: sender("Sailo", ORDERS),
    to: opts.to,
    subject: `Your deletion request to ${opts.shopName}`,
    html,
  });
}
