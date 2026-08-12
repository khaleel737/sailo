/**
 * Creator shortlist, validated against the YouTube API.
 *
 *   composio link youtube          # once
 *   npx tsx scripts/social/creators.ts
 *
 * The candidate list below is hand-researched — the YouTube toolkit has no
 * search tool, so discovery happens off-platform and this script's job is the
 * part that actually matters: checking whether a channel is *alive*.
 *
 * The metric that decides it is median views on recent uploads divided by
 * subscribers, not the subscriber count. Subscribers are cumulative and never
 * go down, so a 220k channel doing 4k views is a dead list with a big number on
 * it, while a 36k channel doing 8k views is reaching a quarter of its audience
 * every time it posts. For a partner deal paid on conversions, the second one
 * is worth more, and the first one will quote you a higher price.
 *
 * Median rather than mean: one viral video shouldn't launder a flat channel.
 */
import { composio } from "./publish";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

type Fit = "high" | "medium" | "low";

type Candidate = {
  handle: string;
  /** Why their audience is or isn't Sailo's. Drives the fit weight. */
  note: string;
  /** Second person, drops straight into the outreach email. */
  pitch: string;
  fit: Fit;
  region: string;
};

/**
 * Fit is about whose audience these are, not how big they are.
 *
 * HIGH — teaches small *physical* or *service* sellers, or sells into markets
 * where card processing is the blocker. That is exactly Sailo's wedge: no
 * checkout to configure, no processor country list, orders over WhatsApp.
 *
 * MEDIUM — general small-business marketing. The audience overlaps but the
 * pitch has to work harder.
 *
 * LOW — US creator-economy channels whose audience sells courses and coaching.
 * That is Stan's home turf and Sailo's weakest ground: no checkout, no course
 * hosting, no email automation. Listed deliberately so the ranking shows why
 * they are not the first call, rather than quietly omitting them.
 */
const CANDIDATES: Candidate[] = [
  {
    handle: "StarlaMoore",
    pitch: "your audience already runs a real catalogue on Etsy, and keeps hitting the question of where else to send people",
    note: "Etsy SEO coach; audience is handmade/physical sellers who already run a catalogue and want their own link",
    fit: "high",
    region: "US",
  },
  {
    handle: "KaraBuntin",
    pitch: "your audience sells physical products and wants the practical mechanics rather than funnel theory",
    note: "Six-figure Etsy seller, ~49k sales; practical physical-product audience, small but unusually engaged",
    fit: "high",
    region: "US",
  },
  {
    handle: "heydominik",
    pitch: "you teach people to grow on Instagram, and the link in their bio is exactly where that growth stops converting",
    note: "Instagram growth with real dashboards; audience is exactly the people whose link in bio sells nothing",
    fit: "medium",
    region: "DE/EU",
  },
  {
    handle: "adamerhart",
    pitch: "your audience is small business owners who need the marketing to end in an order, not a landing page",
    note: "Marketing for small business owners; broad, tool-review friendly, does sponsored integrations",
    fit: "medium",
    region: "CA",
  },
  {
    handle: "SimonSquibb",
    pitch: "so much of your audience is starting something physical and local, where a full checkout platform is overkill",
    note: "Huge early-stage founder audience, strong physical/local-business skew — but large channels price on subs",
    fit: "medium",
    region: "UK",
  },
  {
    handle: "TheEcommerceMom",
    pitch: "your audience sells physical goods and buys tools on a genuine recommendation, not a discount code",
    note: "Etsy and reselling; small channel, physical goods, the kind that converts on a genuine tool recommendation",
    fit: "high",
    region: "US",
  },
];

type Row = {
  handle: string;
  fit: Fit;
  region: string;
  note: string;
  pitch: string;
  channelId?: string;
  title?: string;
  subscribers?: number;
  totalViews?: number;
  videoCount?: number;
  medianRecentViews?: number;
  viewsPerSub?: number;
  daysSinceUpload?: number;
  score?: number;
  error?: string;
};

const n = (v: unknown) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : undefined;
};

function median(xs: number[]): number | undefined {
  if (!xs.length) return undefined;
  const s = xs.toSorted((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  const hi = s[mid];
  if (hi === undefined) return undefined;
  if (s.length % 2) return hi;
  const lo = s[mid - 1];
  return lo === undefined ? hi : Math.round((lo + hi) / 2);
}

/** Pull whatever shape the tool returns without guessing one nesting depth. */
function dig(obj: unknown, keys: string[]): unknown {
  const seen = new Set<unknown>();
  const walk = (o: unknown): unknown => {
    if (!o || typeof o !== "object" || seen.has(o)) return undefined;
    seen.add(o);
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      if (keys.includes(k) && (typeof v === "string" || typeof v === "number")) return v;
    }
    for (const v of Object.values(o as Record<string, unknown>)) {
      const hit = walk(v);
      if (hit !== undefined) return hit;
    }
    return undefined;
  };
  return walk(obj);
}

async function validate(c: Candidate): Promise<Row> {
  const row: Row = { handle: c.handle, fit: c.fit, region: c.region, note: c.note, pitch: c.pitch };

  const id = await composio("YOUTUBE_GET_CHANNEL_ID_BY_HANDLE", { channel_handle: c.handle });
  if (!id.ok) return { ...row, error: id.error ?? "handle lookup failed" };
  row.channelId = String(dig(id.data, ["channelId", "channel_id", "id"]) ?? "");
  if (!row.channelId) return { ...row, error: "no channel id returned" };

  const stats = await composio("YOUTUBE_GET_CHANNEL_STATISTICS", {
    id: row.channelId,
    part: "snippet,statistics",
  });
  if (!stats.ok) return { ...row, error: stats.error ?? "statistics failed" };
  row.title = String(dig(stats.data, ["title"]) ?? c.handle);
  row.subscribers = n(dig(stats.data, ["subscriberCount", "subscriber_count"]));
  row.totalViews = n(dig(stats.data, ["viewCount", "view_count"]));
  row.videoCount = n(dig(stats.data, ["videoCount", "video_count"]));

  const vids = await composio("YOUTUBE_LIST_CHANNEL_VIDEOS", {
    channelId: row.channelId,
    maxResults: 12,
  });
  if (vids.ok) {
    const items = JSON.stringify(vids.data);
    const views = [...items.matchAll(/"viewCount"\s*:\s*"?(\d+)"?/g)].map((m) => Number(m[1]));
    row.medianRecentViews = median(views);
    const dates = [...items.matchAll(/"publishedAt"\s*:\s*"([^"]+)"/g)].map((m) =>
      Date.parse(m[1] ?? ""),
    );
    const newest = Math.max(...dates.filter(Number.isFinite));
    if (Number.isFinite(newest)) {
      row.daysSinceUpload = Math.floor((Date.now() - newest) / 86_400_000);
    }
  }

  if (row.subscribers && row.medianRecentViews) {
    row.viewsPerSub = Number((row.medianRecentViews / row.subscribers).toFixed(3));
  }

  /*
   * Reach that is actually delivered, weighted by how much of the audience is
   * ours, and discounted for a channel that has gone quiet. A dormant channel
   * with great historic numbers cannot run a review next month.
   */
  const fitWeight = { high: 1, medium: 0.6, low: 0.25 }[c.fit];
  const stale =
    row.daysSinceUpload === undefined ? 0.7 : row.daysSinceUpload > 90 ? 0.3 : row.daysSinceUpload > 30 ? 0.7 : 1;
  row.score = Math.round((row.medianRecentViews ?? 0) * fitWeight * stale);

  return row;
}

async function main() {
  const rows: Row[] = [];
  for (const c of CANDIDATES) {
    const row = await validate(c);
    rows.push(row);
    console.log(
      row.error
        ? `  ✗ ${c.handle.padEnd(18)} ${row.error.slice(0, 90)}`
        : `  ✓ ${c.handle.padEnd(18)} ${String(row.subscribers ?? "?").padStart(9)} subs  ` +
          `${String(row.medianRecentViews ?? "?").padStart(8)} median  ` +
          `${row.viewsPerSub ?? "?"} v/sub  ${row.daysSinceUpload ?? "?"}d ago`,
    );
  }

  rows.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));

  console.log("\nRanked — score = median recent views × audience fit × recency\n");
  console.log(
    `  ${"channel".padEnd(20)}${"fit".padEnd(8)}${"subs".padStart(10)}${"median".padStart(10)}${"v/sub".padStart(8)}${"score".padStart(9)}`,
  );
  for (const r of rows) {
    if (r.error) continue;
    console.log(
      `  ${(r.title ?? r.handle).slice(0, 19).padEnd(20)}${r.fit.padEnd(8)}` +
        `${String(r.subscribers ?? "?").padStart(10)}${String(r.medianRecentViews ?? "?").padStart(10)}` +
        `${String(r.viewsPerSub ?? "?").padStart(8)}${String(r.score ?? "?").padStart(9)}`,
    );
  }

  const out = join(process.cwd(), "scripts", "social", ".out");
  await mkdir(out, { recursive: true });
  const path = join(out, "creators.json");
  await writeFile(path, JSON.stringify(rows, null, 2), "utf8");
  console.log(`\n${path}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
