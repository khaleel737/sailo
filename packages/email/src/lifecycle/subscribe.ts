import "server-only";
import type { Shop } from "@sailo/db/schema";
import { ORDERS, send, sender, type SendResult } from "@sailo/mailer/transport";
import { button, esc, layout, para } from "@sailo/mailer/markup";

/**
 * The one message that asks permission.
 *
 * Everything else in this package is sent because something happened; this is
 * sent to find out whether the next thing may be. It is the double opt-in
 * confirmation that turns an address typed into a storefront form into a
 * subscriber a seller may broadcast to.
 *
 * That makes it the boundary between transactional and marketing mail, and the
 * reason it sits under `./lifecycle` rather than beside the receipts: a receipt
 * goes to whoever bought, and everything under here goes only to whoever said
 * yes.
 */

/**
 * The one email a shop may send to an address that has not consented to
 * anything — because it is the email that asks.
 *
 * Transactional, not marketing: it is the direct, immediate answer to
 * somebody typing that address into a form seconds earlier, it carries no
 * offer, and it is the only way the consent it asks for can ever be given.
 * Everything else this feature sends is gated on the answer.
 *
 * It deliberately says what happens if the recipient did *not* ask. A signup
 * form is a way to type a stranger's address, so the person who did not ask
 * needs to read, in the first screenful, that ignoring this email is the
 * whole of the action required — and that nothing has been added anywhere
 * yet.
 */
export async function sendSubscribeConfirmation(opts: {
  shop: Shop;
  to: string;
  name: string | null;
  confirmUrl: string;
  labels: {
    subject: string;
    title: string;
    body: string;
    cta: string;
  };
}): Promise<SendResult> {
  const { shop, labels } = opts;

  const body = `
    ${para(
      `${opts.name ? `${esc(opts.name)}, ` : ""}${esc(labels.body)}`,
    )}
    ${button(opts.confirmUrl, labels.cta)}
  `;

  return send({
    from: sender(shop.name, ORDERS),
    to: opts.to,
    subject: labels.subject,
    html: layout(shop, labels.title, body, { preheader: labels.subject }),
    replyTo: shop.contactEmail ?? undefined,
  });
}

