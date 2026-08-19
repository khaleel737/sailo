import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@sailo/db";
import {
  clients,
  integrationApps,
  type Automation,
  type AutomationRun,
  type Shop,
} from "@sailo/db/schema";
import { normalizeTags } from "@sailo/core/tags";
import { openSecret } from "@sailo/core/secret-box";
import { postWebhook, isWebhookTargetUrl } from "@sailo/webhooks/post";
import { ORDERS, send, sender } from "@sailo/mailer/transport";
import { esc, layout, para } from "@sailo/mailer/markup";

/**
 * What a scenario actually does — spec 31.
 *
 * Three generic actions, and each one has exactly one rule that would be a
 * security hole if it were relaxed. They are stated where they are enforced
 * rather than here, but they are the reason this file is separate from the
 * tick: a reader asking "can a seller point this at my internal network"
 * should not have to read a cursor machine to find the answer.
 */

export type ActionOutcome =
  | { ok: true; detail: string; status?: number; contentType?: string }
  | { ok: false; reason: string; status?: number; contentType?: string };

export async function performAction(input: {
  action: string;
  appId?: string;
  tag?: string;
  shop: Shop;
  automation: Automation;
  run: AutomationRun;
}): Promise<ActionOutcome> {
  switch (input.action) {
    case "http.request":
      return httpRequest(input);
    case "email.notify":
      return emailNotify(input);
    case "contact.tag":
      return contactTag(input);
    default:
      // A newer deploy's action. Refusing is right: guessing would run a step
      // whose validation this build does not have.
      return { ok: false, reason: `unknown action ${input.action}` };
  }
}

/**
 * A signed POST to a URL the seller owns.
 *
 * **`postWebhook` exactly, and never `fetch`.** That function is `node:https`
 * with the `lookup` hook, so the address that was approved is the address that
 * is connected to — the resolve-then-fetch shape is the SSRF hole spec 16
 * documents at length. It also enforces https, 443 only, no credentials in the
 * URL, no redirects, and a capped, discarded body.
 *
 * The URL is re-validated here as well as at the write, because a hostname
 * that was public when the seller saved it can resolve somewhere else
 * tomorrow, and this is the moment it matters.
 */
async function httpRequest(input: {
  appId?: string;
  shop: Shop;
  automation: Automation;
  run: AutomationRun;
}): Promise<ActionOutcome> {
  if (!input.appId) return { ok: false, reason: "no app configured" };

  const app = await getDb().query.integrationApps.findFirst({
    where: and(
      eq(integrationApps.id, input.appId),
      // Shop-scoped in the statement. An app id lives in a stored graph, and
      // a matcher that trusted it would let a scenario post through another
      // shop's credential.
      eq(integrationApps.shopId, input.shop.id),
    ),
  });
  if (!app) return { ok: false, reason: "that app is not this shop's" };
  if (app.disabledAt) return { ok: false, reason: "app disabled after repeated failures" };
  if (!app.baseUrl || !isWebhookTargetUrl(app.baseUrl)) {
    return { ok: false, reason: "that URL is not one we will post to" };
  }

  /*
   * The seller's key, decrypted only here and only into a header. It is never
   * returned by a query that feeds a page, never logged, and never part of an
   * outcome — `reason` and `detail` are both read back into the seller's panel.
   */
  const secret = app.secretCiphertext ? openSecret(app.secretCiphertext) : null;
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "user-agent": "Sailo-Scenario/1",
  };
  if (secret && app.headerName) {
    headers[app.headerName.toLowerCase()] = secret;
  }

  /*
   * The payload is the run's own facts and nothing else — no order body, no
   * contact record. A scenario POST is a *notification*: the consumer is told
   * what happened and to whom, and fetches the rest through the REST API with
   * their own key, which is the shape spec 16 already asks consumers to build
   * against.
   */
  const body = JSON.stringify({
    scenario: { id: input.automation.id, name: input.automation.name },
    contact: { email: input.run.email },
    runId: input.run.id,
    at: new Date().toISOString(),
  });

  const result = await postWebhook({ url: app.baseUrl, body, headers });

  await recordCheck(app.id, result.ok);

  return result.ok
    ? { ok: true, detail: `posted to ${hostOf(app.baseUrl)}`, status: result.status }
    : { ok: false, reason: result.reason, status: result.status ?? undefined };
}

/**
 * Mail the seller.
 *
 * **To the shop's own address and nowhere else.** The destination is read from
 * the shop row and is not a field of the action, because an action that mails
 * an arbitrary address is an open relay wearing a scenario's clothes — and it
 * would be one with our sending domain's reputation behind it.
 */
async function emailNotify(input: {
  shop: Shop;
  automation: Automation;
  run: AutomationRun;
}): Promise<ActionOutcome> {
  const to = input.shop.notificationEmail ?? input.shop.contactEmail;
  if (!to) return { ok: false, reason: "this shop has no notification address" };

  const result = await send({
    from: sender("Sailo", ORDERS),
    to,
    subject: `${input.automation.name} — ${input.run.email}`,
    html: layout(
      input.shop,
      input.automation.name,
      para(
        `Your scenario <strong>${esc(input.automation.name)}</strong> ran for <strong>${esc(input.run.email)}</strong>.`,
      ),
      { preheader: `${input.automation.name} ran.` },
    ),
  });

  return result.sent
    ? { ok: true, detail: `notified ${to}` }
    : { ok: false, reason: result.reason ?? "send failed" };
}

/**
 * Write a tag on the buyer — how a seller segments without leaving Sailo.
 *
 * **It must not create a client.** A trigger whose subject has no `clients`
 * row is a scenario with nothing to tag, and it fails visibly rather than
 * inventing a contact: a tag on a row nobody meant to exist is a contact in
 * the seller's audience that appeared from a scenario, and they would never
 * find out where it came from.
 */
async function contactTag(input: {
  tag?: string;
  shop: Shop;
  run: AutomationRun;
}): Promise<ActionOutcome> {
  const { tags } = normalizeTags(input.tag ?? "");
  const tag = tags[0];
  if (!tag) return { ok: false, reason: "no tag configured" };

  /*
   * Appended in the statement rather than read-modify-written, so two
   * scenarios tagging the same buyer in the same tick do not lose one of the
   * tags. `array_append` guarded by `not (tags @> ...)` keeps it idempotent —
   * a retried run does not add a duplicate.
   */
  const [updated] = await getDb()
    .update(clients)
    .set({ tags: sql`array_append(${clients.tags}, ${tag})`, updatedAt: new Date() })
    .where(
      and(
        eq(clients.shopId, input.shop.id),
        sql`lower(${clients.email}) = ${input.run.email}`,
        sql`not (${clients.tags} @> array[${tag}]::text[])`,
      ),
    )
    .returning({ id: clients.id });

  if (updated) return { ok: true, detail: `tagged ${tag}` };

  /*
   * Nothing came back, which is two different facts: the contact does not
   * exist, or they already carry the tag. Only the first is a failure, and
   * telling them apart needs one more read — worth it, because "already
   * tagged" reported as an error is an execution log full of red for a
   * scenario that is working.
   */
  const exists = await getDb().query.clients.findFirst({
    where: and(
      eq(clients.shopId, input.shop.id),
      sql`lower(${clients.email}) = ${input.run.email}`,
    ),
    columns: { id: true },
  });

  return exists
    ? { ok: true, detail: `already tagged ${tag}` }
    : { ok: false, reason: "no contact with that address in this shop" };
}

/**
 * Records whether an app answered, and disables it after enough failures.
 *
 * Spec 16's rule, reused rather than re-invented: a scenario posting into a
 * void for a month is the same failure as an endpoint doing it, and the seller
 * finds out either way.
 */
const DISABLE_AFTER = 20;

async function recordCheck(appId: string, ok: boolean): Promise<void> {
  await getDb()
    .update(integrationApps)
    .set({
      lastCheckedAt: new Date(),
      lastCheckOk: ok,
      // Reset on success, incremented on failure — *consecutive* failures, so
      // an endpoint that works most of the time is never disabled.
      failureCount: ok ? 0 : sql`${integrationApps.failureCount} + 1`,
      disabledAt: ok
        ? null
        : sql`case when ${integrationApps.failureCount} + 1 >= ${DISABLE_AFTER} then now() else ${integrationApps.disabledAt} end`,
      updatedAt: new Date(),
    })
    .where(eq(integrationApps.id, appId));
}

/** The host, for a detail line a seller reads. Never the full URL — it may carry a path secret. */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "the endpoint";
  }
}
