import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { shops } from "./shop";
import { clients } from "./orders";

/**
 * The audience as an address book: lists a seller groups people into, and
 * fields a seller invents to describe them.
 *
 * **`clients` is the contact.** There is no contact table here and there must
 * not be one. That row already carries the identity this release settled on —
 * `(shop, email OR phone)`, either sufficient — as two unique indexes Postgres
 * has enforced since `0012`, which is what makes the WhatsApp buyer with no
 * address a first-class contact rather than a row nothing can key. Everything
 * below hangs off `clientId` for that reason: an address-keyed membership
 * cannot hold a contact who has no address, and that contact is the whole
 * point of the amendment.
 *
 * The other half of the spec's premise — a shop-scoped `newsletter_subscribers`
 * to merge in — does not exist in this tree either. `/[handle]/subscribe`
 * upserts `clients` with `source = 'subscribe'`; the table of that name is
 * *Sailo's own* mailing list, platform-wide and with no `shopId`. See
 * `0047_audience.sql`, which argues both of these at length.
 *
 * **Suppression is not here.** `emailSuppressions` in `./audience` is already
 * the account-level opt-out, already keyed on the address so it outlives any
 * row, and already refuses to be lifted for `bounced` or `complained`. A list
 * write can never resurrect it — that is rule 1, and a second home for the
 * same fact is how a rule like that gets weakened by accident.
 */

/* --------------------------------------------------------------------------
   Lists
-------------------------------------------------------------------------- */

/**
 * A group a seller puts people into, by hand or by signup form.
 *
 * A list is *not* a segment. A segment is a question re-asked at send time
 * (`./audience`'s `segmentSql`); a list is a set somebody was put in and can
 * be seen to be in. Sellers need both and confuse them constantly, which is
 * why the two never share a table: a rule that silently stopped matching
 * would look identical to a member who was never added.
 */
export const contactLists = pgTable(
  "contact_lists",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),

    name: text("name").notNull(),
    description: text("description"),

    /**
     * Whether joining needs a click in the joiner's own inbox.
     *
     * Default true, and the default is the product decision rather than a
     * courtesy. Sailo sends every seller's mail through one domain, so a list
     * filled with addresses nobody confirmed spends a reputation that is not
     * only the seller's own. A seller may turn it off for a list imported from
     * somewhere consent was already collected — and importing is exactly where
     * that claim is least trustworthy, so the toggle says so.
     */
    doubleOptIn: boolean("double_opt_in").default(true).notNull(),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    /*
     * Folded. "VIPs" and "vips" are one list to every seller who has ever
     * typed both, and two lists is how half an audience quietly stops being
     * mailed. The migration owns the real expression index; this records it.
     */
    uniqueIndex("contact_lists_shop_name_key").on(t.shopId, sql`lower(${t.name})`),
    index("contact_lists_shop_idx").on(t.shopId, t.createdAt),
  ],
);

/**
 * One person's place on one list.
 *
 * Keyed `(list, client)` rather than `(list, email)`, which is the one place
 * this file departs from the spec as written and the reason is at the top of
 * the file: the amended identity admits contacts with no address, and they
 * have to be able to join a list.
 */
export const contactListMembers = pgTable(
  "contact_list_members",
  {
    listId: uuid("list_id")
      .notNull()
      .references(() => contactLists.id, { onDelete: "cascade" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),

    /**
     * The address as it read when they joined, or null for a contact who has
     * none.
     *
     * A snapshot and not a lookup, for the reason `broadcastDeliveries.email`
     * is one: which address was on the list in March is a fact, and a buyer
     * correcting their address in June must not rewrite it. Recipient
     * assembly still reads `clients.email` — the current address is what a
     * send needs — so this column is history, never a target.
     */
    email: text("email"),

    /**
     * `subscribed` receives. `pending` is waiting on a double-opt-in click and
     * receives nothing. `removed` left this list and is kept rather than
     * deleted — rule 2 turns on removal and unsubscribe being different verbs,
     * and a seller who cannot see that somebody left will re-import them.
     */
    status: text("status").default("subscribed").notNull(),
    /** signup | import | manual | purchase | api — see `MEMBER_SOURCES`. */
    source: text("source").default("manual").notNull(),

    joinedAt: timestamp("joined_at").defaultNow().notNull(),
    removedAt: timestamp("removed_at"),
  },
  (t) => [
    primaryKey({ columns: [t.listId, t.clientId] }),
    /* Recipient assembly reads (list, status); a `pending` member must not be
       paged past on the way to finding the subscribed ones. */
    index("contact_list_members_list_status_idx").on(t.listId, t.status),
    /* "Which lists is this person on", and the reverse lookup the
       `list.joined` trigger needs. */
    index("contact_list_members_client_idx").on(t.clientId),
  ],
);

/* --------------------------------------------------------------------------
   Fields
-------------------------------------------------------------------------- */

/**
 * A question a seller decided to keep the answer to.
 *
 * `scope` is what makes one table serve two surfaces: the contact card, the
 * checkout form, or both. That is deliberate rather than convenient — "what
 * size are you" asked at checkout and the same question on the contact card
 * are one field, and two tables would mean two answers that disagree.
 */
export const contactFields = pgTable(
  "contact_fields",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),

    /**
     * An identifier, not a label: `^[a-z][a-z0-9_]{0,39}$`, immutable once
     * created, and refused when it would shadow a standard name.
     *
     * Immutable because it is what a merge tag resolves — renaming `size` to
     * `shirt_size` would silently blank `{{fields.size}}` in every automation
     * body already using it. The check constraint is in the migration as well
     * as in `@sailo/marketing/contacts`, because a template that resolves by
     * name is not a place to find out a name was never validated.
     */
    key: text("key").notNull(),
    /** What the seller and the buyer see. Free text, escaped at render. */
    label: text("label").notNull(),
    /** One of `FIELD_TYPES`. */
    type: text("type").default("text").notNull(),

    /**
     * The closed set a `dropdown` may answer with. Empty for every other type.
     *
     * Validated server-side on every submit rather than trusted from the form.
     * A free-text value accepted into a dropdown is how a validation gap
     * becomes a CSV injection two exports later — a select element is a
     * suggestion to a browser, not a constraint on a request.
     */
    options: jsonb("options").$type<string[]>().default([]).notNull(),
    required: boolean("required").default(false).notNull(),

    /** contact | checkout | both — see `FIELD_SCOPES`. */
    scope: text("scope").default("contact").notNull(),
    position: integer("position").default(0).notNull(),

    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("contact_fields_shop_key_key").on(t.shopId, t.key)],
);

/**
 * One answer, by one contact, to one field.
 *
 * `jsonb` and not `text` because the eight types are eight shapes, and because
 * it is the one encoding where *answered with nothing* and *never answered*
 * are different values rather than both NULL. Rule 5 turns on exactly that
 * difference: an import with a blank column overwrites a standard field and
 * leaves a custom one alone, which is undecidable if blank and absent are the
 * same thing.
 */
export const contactFieldValues = pgTable(
  "contact_field_values",
  {
    /* Denormalised for the reason `broadcastDeliveries.shopId` is: every
       question asked of this table is shop-scoped, and a join to ask it is a
       join some future call site will forget. */
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    fieldId: uuid("field_id")
      .notNull()
      .references(() => contactFields.id, { onDelete: "cascade" }),

    value: jsonb("value"),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.clientId, t.fieldId] }),
    index("contact_field_values_shop_field_idx").on(t.shopId, t.fieldId),
  ],
);
