import "server-only";
import { notInArray, sql } from "drizzle-orm";
import { user } from "@sailo/db/schema";
import { staffEmails } from "@sailo/security/staff";

/**
 * `user` rows that are customers, not us.
 *
 * The staff account lives in the same table as every seller — identity is
 * shared, privilege is not — so any list or metric that means "people who
 * signed up to sell" has to say so in its query. `staffEmails()` is never
 * empty and always lowercased, which is what keeps the `not in` honest.
 */
export function notStaff() {
  return notInArray(sql`lower(${user.email})`, staffEmails());
}
