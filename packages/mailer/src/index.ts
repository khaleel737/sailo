/**
 * How mail is made and sent. Not what it says.
 *
 * WHY THIS IS A SEPARATE PACKAGE FROM `@sailo/email`
 *
 * `@sailo/email` was two things wearing one name. The *messages* — a receipt, a
 * password reset, a broadcast — are domain content: they know about orders,
 * shops and sellers, and they belong with the domain. The *transport* and the
 * *markup* know none of that. They are a Resend client and a set of HTML
 * building blocks.
 *
 * Keeping them together forced four packages into a sibling dependency they did
 * not want. `@sailo/marketing` needs `layout` and `sendBatch` to compose and
 * deliver a broadcast; `@sailo/security` needs them to email the staff when a
 * sending reputation goes bad; `@sailo/webhooks` needs them to tell a seller it
 * has disabled their endpoint. None of those wants an order receipt, and every
 * one of them had to depend on the package that holds one — a domain package
 * reaching sideways for a vendor client.
 *
 * Split, they reach *downwards* for a capability, which is what they were
 * always doing:
 *
 *   @sailo/mailer   the Resend seam, the HTML kit, the sending domains  (capability)
 *   @sailo/email    the messages, grouped by who receives them          (domain)
 *
 * `./markup` is deliberately vendor-free. It builds table-based HTML with inline
 * styles because that is what mail clients from 2007 onwards agree on, and it
 * would be the same code behind any provider. `./transport` is the only file
 * here that names Resend.
 */

export * from "./transport";
export * from "./markup";
