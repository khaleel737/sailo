import { boolean, index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * BetterAuth's own tables. Their shape is dictated by the adapter, so nothing
 * here is ours to redesign — kept apart so that stays obvious.
 */

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified")
    .$defaultFn(() => false)
    .notNull(),
  image: text("image"),
  /**
   * Owned by the `twoFactor` plugin — flipped only after a TOTP code has been
   * verified against the freshly enrolled secret, never on enrolment alone.
   */
  twoFactorEnabled: boolean("two_factor_enabled").default(false).notNull(),
  createdAt: timestamp("created_at")
    .$defaultFn(() => new Date())
    .notNull(),
  updatedAt: timestamp("updated_at")
    .$defaultFn(() => new Date())
    .notNull(),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  /**
   * Where the sign-in came from, resolved once at session creation from
   * Vercel's geo headers (see the session hook in `lib/auth.ts`). Nullable
   * because sessions created before this existed — and local dev, which has
   * no geo headers — have nothing truthful to say.
   */
  city: text("city"),
  country: text("country"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
});

/**
 * One row per enrolled user, owned by the `twoFactor` plugin. `secret` and
 * `backupCodes` arrive encrypted with BETTER_AUTH_SECRET; `verified` stays
 * false until the first TOTP code proves the authenticator really holds the
 * secret, and `failedVerificationCount`/`lockedUntil` are the plugin's own
 * database-backed account lockout.
 */
export const twoFactor = pgTable(
  "two_factor",
  {
    id: text("id").primaryKey(),
    secret: text("secret").notNull(),
    backupCodes: text("backup_codes").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    verified: boolean("verified").default(true).notNull(),
    failedVerificationCount: integer("failed_verification_count")
      .default(0)
      .notNull(),
    lockedUntil: timestamp("locked_until"),
  },
  (t) => [
    index("two_factor_user_id_idx").on(t.userId),
    index("two_factor_secret_idx").on(t.secret),
  ],
);

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").$defaultFn(() => new Date()),
  updatedAt: timestamp("updated_at").$defaultFn(() => new Date()),
});

/* -------------------------------------------------------------------------- */
/*  Sailo domain                                                              */
/* -------------------------------------------------------------------------- */

/**
 * A shop is the single public page a user owns — the Linktree equivalent.
 * One shop per user keeps onboarding to a single step.
 */

/* -------------------------------------------------------------------------- */
/*  The organization plugin's tables — spec 37                                 */
/* -------------------------------------------------------------------------- */

/**
 * A shop's team, as `better-auth/plugins/organization` models it.
 *
 * The shapes are the plugin's, read from
 * `node_modules/better-auth/dist/plugins/organization/schema.d.mts`, and
 * nothing here is ours to redesign — the same rule the four tables above
 * follow. What is ours is `shops.organization_id`, which points at one of
 * these, and the role vocabulary in `@sailo/auth/permissions`.
 *
 * `team` and `teamMember` are deliberately **absent**. The plugin offers
 * sub-teams inside an organization and a Sailo shop is one team; creating the
 * tables would invite somebody to invent a use for them, and an unused concept
 * is more expensive than an unused table.
 */
export const organization = pgTable("organization", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  /** The plugin requires this unique; nothing in Sailo shows it to anyone. */
  slug: text("slug").notNull().unique(),
  logo: text("logo"),
  metadata: text("metadata"),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at"),
});

/**
 * A person in a shop's team, with the role that decides what they may do.
 *
 * `role` is text because the plugin treats it as text, and
 * `@sailo/auth/permissions` refuses anything that is not one of the three
 * rather than defaulting it — a row written by a future build must not fall
 * through to the most permissive answer.
 */
export const member = pgTable(
  "member",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role").default("member").notNull(),
    createdAt: timestamp("created_at").notNull(),
  },
  (t) => [
    /*
     * The lookup every guarded request makes: "this user, in this shop's
     * organization, with what role". Without it, `requireShop` reads the whole
     * member table on every page of every admin screen.
     */
    index("member_user_org_idx").on(t.userId, t.organizationId),
    // One membership per person per shop. Two rows would make "their role" a
    // question with two answers, and whichever the query returned first would
    // decide what they can do.
    uniqueIndex("member_org_user_key").on(t.organizationId, t.userId),
  ],
);

export const invitation = pgTable(
  "invitation",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role"),
    status: text("status").default("pending").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").notNull(),
    inviterId: text("inviter_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [index("invitation_org_idx").on(t.organizationId, t.status)],
);

export type Organization = typeof organization.$inferSelect;
export type Member = typeof member.$inferSelect;
export type Invitation = typeof invitation.$inferSelect;
