/**
 * What counts as a paying shop, and as a session that is still open.
 *
 * Every figure on the security overview is either "all shops" or "paying shops", and every session figure is either "all sessions" or "live" ones. Two spellings of either would make two numbers on one screen disagree about the same set.
 */

import "server-only";
import { and, gt, inArray, isNotNull, ne, or } from "drizzle-orm";
import { session as sessionTable, shops } from "@sailo/db/schema";
import { ENTITLED } from "../billing-state";

export const live = () => gt(sessionTable.expiresAt, new Date());

export const PAID = or(
  isNotNull(shops.compPlan),
  and(ne(shops.plan, "free"), inArray(shops.subscriptionStatus, ENTITLED)),
);
