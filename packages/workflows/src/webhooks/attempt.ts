/**
 * One delivery: sign it, post it, and write down what happened.
 *
 * The signing and the sending are here together on purpose — see the note on `body`
 * below, which is the one correctness property in this file that is easy to break by
 * tidying.
 */

import "server-only";
import { eq, sql } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { webhookDeliveries, webhookEndpoints } from "@sailo/db/schema";
import { maybeRow } from "@sailo/core/invariant";
import { postWebhook } from "@sailo/webhooks/post";
import { signWebhook } from "@sailo/webhooks/signature";
import { retire } from "./claim";
import { disableEndpoint } from "./disable";
import { attemptsExhausted, backoffFor, AUTO_DISABLE_AFTER } from "./policy";
import type { EndpointRow } from "./rows";

export async function attempt(
  row: EndpointRow,
  attemptNumber: number,
  now: Date,
): Promise<{ delivered: boolean; abandoned: boolean; disabled: boolean }> {
  const db = getDb();

  /*
   * The body is serialised once and both signed and sent as *that string*.
   *
   * Signing a re-serialisation of the same object is the classic way to ship a
   * signature nobody can verify: `JSON.stringify` is deterministic for a given
   * object in a given runtime, but "the bytes we signed" and "the bytes we
   * sent" being separate expressions is a correctness property held by
   * coincidence rather than by construction.
   */
  const body = JSON.stringify(row.payload);
  const headers = signWebhook({
    id: row.id,
    body,
    secret: row.secret,
    now,
  });

  if (!headers) {
    /*
     * An unusable secret cannot be fixed by retrying. Rotating it is the
     * seller's move, and the log has to say so or they will watch a delivery
     * retry five times and conclude their own server is at fault.
     */
    await retire(row.id, "this endpoint's signing secret is unusable — rotate it");
    return { delivered: false, abandoned: true, disabled: false };
  }

  const result = await postWebhook({
    url: row.url,
    body,
    headers: { ...headers, "sailo-event": row.event },
  });

  if (result.ok) {
    await db
      .update(webhookDeliveries)
      .set({
        status: "ok",
        deliveredAt: now,
        responseStatus: result.status,
        error: null,
      })
      .where(eq(webhookDeliveries.id, row.id));

    await db
      .update(webhookEndpoints)
      .set({
        // Consecutive, so any success clears the count entirely.
        failureCount: 0,
        lastAttemptAt: now,
        lastStatus: "ok",
        lastResponseStatus: result.status,
        updatedAt: now,
      })
      .where(eq(webhookEndpoints.id, row.endpointId));

    return { delivered: true, abandoned: false, disabled: false };
  }

  /* ---- It failed ---------------------------------------------------------- */

  const exhausted = attemptsExhausted(attemptNumber);
  const backoff = backoffFor(attemptNumber);

  await db
    .update(webhookDeliveries)
    .set({
      status: exhausted ? "failed" : "pending",
      responseStatus: result.status,
      error: result.reason.slice(0, 300),
      /*
       * Left where the lease put it when the delivery is abandoned. Moving it
       * would be writing a date meaning "next attempt" onto a row that will
       * never have one.
       */
      ...(exhausted ? {} : { nextAttemptAt: new Date(now.getTime() + backoff) }),
    })
    .where(eq(webhookDeliveries.id, row.id));

  const endpoint = maybeRow(
    await db
      .update(webhookEndpoints)
      .set({
        failureCount: sql`${webhookEndpoints.failureCount} + 1`,
        lastAttemptAt: now,
        lastStatus: "failed",
        lastResponseStatus: result.status,
        updatedAt: now,
      })
      .where(eq(webhookEndpoints.id, row.endpointId))
      .returning({
        failureCount: webhookEndpoints.failureCount,
        url: webhookEndpoints.url,
        label: webhookEndpoints.label,
        shopId: webhookEndpoints.shopId,
      }),
  );

  let disabled = false;
  if (endpoint && endpoint.failureCount >= AUTO_DISABLE_AFTER) {
    disabled = await disableEndpoint({
      endpointId: row.endpointId,
      shopId: endpoint.shopId,
      url: endpoint.url,
      label: endpoint.label,
      reason: result.reason,
      now,
    });
  }

  return { delivered: false, abandoned: exhausted, disabled };
}
