import "server-only";
import { EventEmitter } from "node:events";
import { createSubscriber, rateLimit, withRedis } from "@sailo/rate-limit";

/**
 * The realtime bus: how a write in one place becomes a repaint somewhere else.
 *
 * A seller's dashboard shows numbers that other people move — a buyer places
 * an order from a webhook, a visitor lands on the storefront, a reviewer
 * submits from the product page. None of those happen in the seller's own
 * request, so until now the only way a dashboard learned about them was its
 * owner pressing refresh. This module is the missing wire: write paths
 * announce "something about shop X changed", and whatever is streaming to
 * that shop's open dashboards forwards the announcement so they re-render.
 *
 * Two properties are load-bearing, and both are inherited from `redis.ts`:
 *
 * 1. **An event is a hint, never the data.** The payload names a kind and
 *    nothing else; the dashboard that receives it re-reads Postgres exactly
 *    the way a manual refresh would. A lost event costs one stale interval,
 *    a duplicated event costs one redundant read, and nothing anywhere can
 *    be wrong — only late. That is what lets every path below fail open.
 *
 * 2. **Publishing must cost the hot path nothing.** The order webhook and
 *    the visit beacon are the two busiest writes in the app; neither may
 *    block, slow down, or — above all — fail because the announcement layer
 *    had a bad moment. `publish*` never throws, and hot paths hand it to
 *    `after()` rather than awaiting it.
 *
 * Delivery is Redis pub/sub between instances, because on Vercel the webhook
 * that writes an order and the function holding a dashboard's stream are
 * different processes. When Redis is absent or cold, publishes fall back to
 * a process-local emitter: in development (one process) that is
 * indistinguishable from the real thing, and in production it degrades to
 * best-effort — same-instance events still arrive, and the stream layer
 * tells the client to poll for the rest.
 *
 * Three audiences, three channel families:
 *
 *   - `shop:{id}`      → that seller's /admin
 *   - `hq`             → the staff panel, every shop folded into one channel
 *   - `affiliate:{id}` → that affiliate's /partner portal
 *
 * A shop publish mirrors itself onto `hq` for the kinds /hq charts actually
 * plot, so a write path only ever makes one call and cannot forget the
 * second audience.
 */

/**
 * What changed, at the granularity a dashboard cares about. One kind per
 * domain, not per table: "an order changed" is enough to re-read whatever
 * orders a page shows, and a finer vocabulary would just be more places for
 * a write path to pick the wrong word.
 *
 * `account` is platform-level — a signup, a plan change — and only ever
 * travels the hq channel.
 */
export type EventKind =
  | "order"
  | "payment"
  | "review"
  | "affiliate"
  | "visit"
  | "booking"
  | "support"
  | "client"
  | "catalog"
  | "account";

export type BusEvent = { kind: EventKind };

/**
 * Kinds that arrive faster than anyone can read a dashboard, and the window
 * that tames them. Visits scale with storefront traffic — a busy shop sees
 * several a second — and every event an open dashboard receives becomes a
 * re-render and a round of queries. One announcement per shop per window is
 * still "live" to a human eye; per-visit would be a self-inflicted load
 * test. Everything else on the shop channel happens at human frequency and
 * goes straight through.
 */
const SHOP_GATE_SECONDS: Partial<Record<EventKind, number>> = {
  visit: 10,
};

/**
 * Which shop events /hq also hears, and how often at most. The staff panel
 * aggregates every shop, so at platform scale even "human frequency" kinds
 * add up — one announcement per kind per window across the whole platform
 * is plenty for charts that plot days. Visits are deliberately absent: no
 * /hq page counts them live, and they would drown everything else.
 */
const HQ_GATE_SECONDS: Partial<Record<EventKind, number>> = {
  order: 10,
  payment: 10,
  review: 30,
  affiliate: 30,
  support: 10,
  client: 30,
  catalog: 30,
  booking: 30,
  account: 5,
};

const shopChannel = (shopId: string) => `sailo:ev:shop:${shopId}`;
const affiliateChannel = (affiliateId: string) =>
  `sailo:ev:affiliate:${affiliateId}`;
const HQ_CHANNEL = "sailo:ev:hq";

/**
 * On `globalThis` because in development the module graph is rebuilt on
 * every edit, and an emitter living in module scope would strand a running
 * stream's listener on the old copy — publishes would land on the new one
 * and the dashboard would quietly go deaf until reconnect.
 */
const globals = globalThis as typeof globalThis & {
  sailoLocalBus?: EventEmitter;
};

function localBus(): EventEmitter {
  if (!globals.sailoLocalBus) {
    const bus = new EventEmitter();
    // One listener per open dashboard stream on this instance; the default
    // ceiling of ten would start warning at eleven browser tabs.
    bus.setMaxListeners(0);
    globals.sailoLocalBus = bus;
  }
  return globals.sailoLocalBus;
}

/**
 * The local half of a publish gate, kept even when Redis is up: it can only
 * remove same-instance duplicates the Redis window would have removed
 * anyway, and when Redis is down it is the only thing standing between a
 * burst of visits and a burst of re-renders.
 */
const lastGatedPublish = new Map<string, number>();

function localGateAllows(key: string, windowSeconds: number): boolean {
  const now = Date.now();
  const last = lastGatedPublish.get(key);
  if (last !== undefined && now - last < windowSeconds * 1000) return false;

  // The map grows with (channel × gated kind) pairs that published at least
  // once. Prune opportunistically rather than on a timer: a timer is process
  // state to leak, and this runs only when a gated kind is already loud.
  if (lastGatedPublish.size > 10_000) {
    const cutoff = now - 60_000;
    for (const [k, at] of lastGatedPublish) {
      if (at < cutoff) lastGatedPublish.delete(k);
    }
  }

  lastGatedPublish.set(key, now);
  return true;
}

/**
 * The cross-instance window rides the existing rate limiter: one allowance
 * per key per window. It fails open when Redis is cold — which is exactly
 * when publishes fall back to local delivery, where the local gate takes
 * over. Both gates always run; the local one is a subset of the Redis one
 * whenever both are up.
 */
async function gateAllows(key: string, windowSeconds: number): Promise<boolean> {
  const viaRedis = await rateLimit(`ev:${key}`, 1, windowSeconds);
  if (!viaRedis.allowed) return false;
  return localGateAllows(key, windowSeconds);
}

async function publishTo(channel: string, event: BusEvent): Promise<void> {
  const delivered = await withRedis(async (redis) => {
    await redis.publish(channel, JSON.stringify(event));
    return true;
  }, false);

  /*
   * Local delivery only when Redis delivery didn't happen. When Redis is up
   * the stream layer is subscribed there, so emitting locally as well would
   * hand same-instance dashboards every event twice.
   */
  if (!delivered) localBus().emit(channel, event);
}

/**
 * Announces that something about a shop changed. Fire-and-forget by design:
 * never throws, never matters to the caller's response, and callers on a
 * hot path should hand it to `after()` rather than awaiting it.
 *
 * Mirrors onto the hq channel for the kinds the staff panel plots, so a
 * write path makes exactly one call per change and /hq cannot be forgotten.
 */
export async function publishShopEvent(
  shopId: string,
  kind: EventKind,
): Promise<void> {
  try {
    const gate = SHOP_GATE_SECONDS[kind];
    if (!gate || (await gateAllows(`${shopId}:${kind}`, gate))) {
      await publishTo(shopChannel(shopId), { kind });
    }

    const hqGate = HQ_GATE_SECONDS[kind];
    if (hqGate && (await gateAllows(`hq:${kind}`, hqGate))) {
      await publishTo(HQ_CHANNEL, { kind });
    }
  } catch {
    // A lost announcement is one stale interval on a dashboard. Nothing to
    // do with it that's better than carrying on.
  }
}

/**
 * Platform-level changes with no single shop behind them — a signup, a plan
 * change, a subscription falling past due. hq channel only.
 */
export async function publishHqEvent(kind: EventKind): Promise<void> {
  try {
    const gate = HQ_GATE_SECONDS[kind];
    if (!gate || (await gateAllows(`hq:${kind}`, gate))) {
      await publishTo(HQ_CHANNEL, { kind });
    }
  } catch {
    // Same trade as above.
  }
}

/**
 * Changes an affiliate's portal shows: a conversion landing, a commission
 * paid, their status or terms edited. Low frequency by nature, so no gate.
 */
export async function publishAffiliateEvent(
  affiliateId: string,
  kind: EventKind,
): Promise<void> {
  try {
    await publishTo(affiliateChannel(affiliateId), { kind });
  } catch {
    // Same trade as above.
  }
}

export type EventSubscription = {
  /**
   * Whether cross-instance delivery is on. When false, the caller is
   * hearing this process only, and should arrange another way (polling)
   * to learn about writes that happen elsewhere.
   */
  live: boolean;
  /** Detaches everything. Safe to call more than once. */
  close: () => Promise<void>;
};

/**
 * Feeds every announcement on one channel to `onEvent`, until closed.
 *
 * `onLost` fires (once) if cross-instance delivery dies mid-subscription —
 * the subscriber socket erroring out from under us. The caller owns a
 * long-lived response stream and is the only one who can decide what that
 * means; the honest move is usually to end the stream and let the client
 * reconnect into whatever mode is available then.
 */
async function subscribeTo(
  channel: string,
  onEvent: (event: BusEvent) => void,
  onLost?: () => void,
): Promise<EventSubscription> {
  const localListener = (event: BusEvent) => onEvent(event);
  localBus().on(channel, localListener);

  let lost = false;
  const reportLost = () => {
    if (lost) return;
    lost = true;
    onLost?.();
  };

  const subscriber = await createSubscriber();
  if (subscriber) {
    subscriber.on("error", reportLost);
    try {
      await subscriber.subscribe(channel, (message: string) => {
        const event = parseEvent(message);
        if (event) onEvent(event);
      });
    } catch {
      reportLost();
    }
  }

  let closed = false;
  return {
    live: subscriber !== null && !lost,
    close: async () => {
      if (closed) return;
      closed = true;
      localBus().off(channel, localListener);
      if (subscriber) {
        // `destroy` rather than a graceful quit: the stream this fed is
        // already gone, and a subscriber connection has nothing to flush.
        try {
          subscriber.destroy();
        } catch {
          // Already dead is the outcome we wanted.
        }
      }
    },
  };
}

export function subscribeShopEvents(
  shopId: string,
  onEvent: (event: BusEvent) => void,
  onLost?: () => void,
): Promise<EventSubscription> {
  return subscribeTo(shopChannel(shopId), onEvent, onLost);
}

export function subscribeHqEvents(
  onEvent: (event: BusEvent) => void,
  onLost?: () => void,
): Promise<EventSubscription> {
  return subscribeTo(HQ_CHANNEL, onEvent, onLost);
}

export function subscribeAffiliateEvents(
  affiliateId: string,
  onEvent: (event: BusEvent) => void,
  onLost?: () => void,
): Promise<EventSubscription> {
  return subscribeTo(affiliateChannel(affiliateId), onEvent, onLost);
}

const KINDS: ReadonlySet<string> = new Set([
  "order",
  "payment",
  "review",
  "affiliate",
  "visit",
  "booking",
  "support",
  "client",
  "catalog",
  "account",
] satisfies EventKind[]);

function parseEvent(message: string): BusEvent | null {
  try {
    const parsed: unknown = JSON.parse(message);
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      typeof (parsed as { kind?: unknown }).kind === "string" &&
      KINDS.has((parsed as { kind: string }).kind)
    ) {
      return { kind: (parsed as { kind: string }).kind as EventKind };
    }
  } catch {
    // Fall through: a malformed message is dropped, not fatal.
  }
  return null;
}
