import { createAccessControl } from "better-auth/plugins/access";

/**
 * What a person other than the owner may do in a shop — spec 37.
 *
 * WHAT IS OURS AND WHAT IS THE PLUGIN'S
 *
 * `better-auth/plugins/organization` ships members, invitations with an
 * expiry, acceptance, revocation, and the evaluator below. None of that is
 * written here, deliberately: it is the half most easily got subtly wrong by
 * hand — an invite token with no expiry, a revoked member whose session
 * outlives the revocation — and it is tested upstream.
 *
 * What *is* ours is this file: the vocabulary. Resources named after what a
 * seller thinks they are doing rather than after tables, and three roles built
 * from them.
 *
 * WHY `refund` AND `export` ARE THEIR OWN ACTIONS
 *
 * They are the two a seller most often wants to withhold, and folding them
 * into `write` and `read` would make the roles useless for the case they exist
 * for. "My assistant handles orders" means answering buyers and marking things
 * shipped; it does not mean moving money back out of the account, and it does
 * not mean downloading the customer list on their way to a competitor.
 */

export const shopAccess = createAccessControl({
  products: ["read", "write"],
  orders: ["read", "write", "refund"],
  /**
   * `write` is here and the spec's sketch did not have it, which was a gap
   * rather than a decision: tagging a buyer, adding a note and typing a contact
   * in are things somebody handling orders does all day, and with only
   * `read`/`export` they would have had to borrow an unrelated resource. The
   * withheld action is still `export` — the one a seller cares about, because
   * it is the whole customer list leaving on somebody's way out.
   */
  customers: ["read", "write", "export"],
  marketing: ["read", "send"],
  /** Payouts, invoices, the tax report — anything that says what came in. */
  money: ["read"],
  /** Rails, shipping, legal pages, and the shop itself. */
  settings: ["read", "write"],
  /** Inviting people, and taking them out again. */
  team: ["read", "write"],
} as const);

/**
 * Everything, including `team:write` and `settings:write`.
 *
 * The owner cannot be removed and cannot be demoted: a shop with nobody able
 * to administer it is unrecoverable, and there is no support path back from it
 * that does not involve somebody at Sailo editing a row by hand.
 */
export const ownerRole = shopAccess.newRole({
  products: ["read", "write"],
  orders: ["read", "write", "refund"],
  customers: ["read", "write", "export"],
  marketing: ["read", "send"],
  money: ["read"],
  settings: ["read", "write"],
  team: ["read", "write"],
});

/**
 * Runs the shop day to day, and cannot move money or change what the shop *is*.
 *
 * No `team` (they cannot invite themselves a colleague or remove the owner),
 * no `money` (the payout account is not theirs to look at), and `settings` is
 * read-only — a manager who could edit the payment rails could redirect the
 * shop's income, which is the whole reason that one is not `write`.
 *
 * **And no `orders:refund`.** Spec 37 describes this role as "everything except
 * `team`, `money` and `settings:write`" and then, in its own testing section,
 * asks that a refund *fail for a manager and succeed for the owner*. The second
 * is the one to follow: a refund is money leaving the seller's account, `money`
 * is exactly the resource this role does not carry, and `refund` was split out
 * of `write` precisely so it could be withheld. With the manager holding it, no
 * shipped role would exercise the distinction the statement map exists for.
 */
export const managerRole = shopAccess.newRole({
  products: ["read", "write"],
  orders: ["read", "write"],
  customers: ["read", "write", "export"],
  marketing: ["read", "send"],
  settings: ["read"],
});

/**
 * "Let my assistant handle orders", which is the request this feature exists
 * for, and nothing beyond it.
 *
 * Reads the catalogue, works the order queue, sees who the customer is. No
 * refunds, no export, no marketing, no money, no settings.
 */
export const staffRole = shopAccess.newRole({
  products: ["read"],
  orders: ["read", "write"],
  /*
   * `write` and not `export`. Tagging a buyer and writing a note are part of
   * handling an order; taking the list away is not, and it is the action a
   * seller most often means when they say "not everything".
   */
  customers: ["read", "write"],
});

export const SHOP_ROLES = {
  owner: ownerRole,
  manager: managerRole,
  staff: staffRole,
} as const;

export type ShopRole = keyof typeof SHOP_ROLES;

export const SHOP_ROLE_IDS = ["owner", "manager", "staff"] as const;

export function isShopRole(value: unknown): value is ShopRole {
  return typeof value === "string" && value in SHOP_ROLES;
}

/**
 * `orders:refund`, `settings:write` — one string, because that is what a call
 * site should be able to write without importing two things.
 */
export type ShopPermission = {
  [R in keyof typeof shopAccess.statements]: `${R & string}:${(typeof shopAccess.statements)[R][number] & string}`;
}[keyof typeof shopAccess.statements];

/** Every permission there is, for the settings screen and for the tests. */
export const SHOP_PERMISSIONS = Object.entries(shopAccess.statements).flatMap(
  ([resource, actions]) =>
    (actions as readonly string[]).map((action) => `${resource}:${action}`),
) as ShopPermission[];

/**
 * Whether a role grants a permission.
 *
 * A thin wrapper over the plugin's own `authorize`, and thin on purpose: this
 * is not a second evaluator, it is the string form the call sites use split
 * into the shape `authorize` wants. Anything that decided *for itself* whether
 * a manager may refund would be the second opinion this file exists to prevent.
 *
 * An unknown role is refused rather than defaulted. `member.role` is a text
 * column, so a row written by a future build — or by hand — must not fall
 * through to the most permissive answer.
 */
export function roleCan(role: string, permission: ShopPermission): boolean {
  if (!isShopRole(role)) return false;
  const [resource, action] = permission.split(":") as [string, string];
  return SHOP_ROLES[role].authorize({ [resource]: [action] }).success;
}
