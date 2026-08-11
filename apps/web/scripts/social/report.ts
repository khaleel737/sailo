/**
 * Did any of this work?
 *
 *   npm run social:report          # last 7 days vs the 7 before
 *   npm run social:report -- 28    # any window
 *
 * Reads Google Analytics through the linked Composio account and prints social
 * sessions against the previous equivalent period, plus the landing pages those
 * visitors arrived on. The point is to make the posting loop falsifiable: if
 * social sessions are flat after a month of daily posts, the content is wrong
 * and the calendar needs different angles, not more of the same.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const PROPERTY = process.env.SAILO_GA_PROPERTY ?? "548806843";

type Row = { dimensionValues?: { value: string }[]; metricValues?: { value: string }[] };

async function ga(body: unknown): Promise<{ rows?: Row[] }> {
  const { stdout } = await run(
    "composio",
    [
      "proxy",
      `https://analyticsdata.googleapis.com/v1beta/properties/${PROPERTY}:runReport`,
      "--toolkit", "google_analytics",
      "-X", "POST",
      "-H", "Content-Type: application/json",
      "-d", JSON.stringify(body),
    ],
    { maxBuffer: 16 * 1024 * 1024, timeout: 120_000 },
  );
  const parsed = JSON.parse(stdout);
  if (parsed.error) throw new Error(parsed.error.message ?? JSON.stringify(parsed.error));
  return parsed;
}

const num = (r: Row, i = 0) => Number(r.metricValues?.[i]?.value ?? 0);
const dim = (r: Row, i = 0) => r.dimensionValues?.[i]?.value ?? "(none)";

function delta(now: number, before: number): string {
  if (before === 0) return now === 0 ? "—" : `+${now} new`;
  const pct = Math.round(((now - before) / before) * 100);
  return `${pct >= 0 ? "+" : ""}${pct}%`;
}

async function main() {
  const days = Number(process.argv[2]) || 7;
  const range = (from: number, to: number) => ({
    startDate: `${from}daysAgo`,
    endDate: to === 0 ? "today" : `${to}daysAgo`,
  });

  const channels = await ga({
    dateRanges: [range(days, 0), range(days * 2, days + 1)],
    dimensions: [{ name: "sessionDefaultChannelGroup" }],
    metrics: [{ name: "sessions" }],
  });

  // Two date ranges come back interleaved by a range index dimension, so group
  // by channel name rather than assuming row order.
  const current = new Map<string, number>();
  const previous = new Map<string, number>();
  for (const row of channels.rows ?? []) {
    const name = dim(row);
    const bucket = dim(row, 1) === "date_range_1" ? previous : current;
    bucket.set(name, (bucket.get(name) ?? 0) + num(row));
  }

  console.log(`\nSailo — last ${days} days vs previous ${days}\n`);
  const names = [...new Set([...current.keys(), ...previous.keys()])].toSorted(
    (a, b) => (current.get(b) ?? 0) - (current.get(a) ?? 0),
  );
  for (const name of names) {
    const now = current.get(name) ?? 0;
    const before = previous.get(name) ?? 0;
    const social = /social/i.test(name) ? " ←" : "";
    console.log(
      `  ${name.padEnd(22)} ${String(now).padStart(5)}  (was ${before}, ${delta(now, before)})${social}`,
    );
  }

  const sources = await ga({
    dateRanges: [range(days, 0)],
    dimensions: [{ name: "sessionSource" }],
    metrics: [{ name: "sessions" }, { name: "totalUsers" }],
    dimensionFilter: {
      orGroup: {
        expressions: [
          "instagram", "facebook", "linkedin", "t.co", "x.com", "twitter", "l.instagram", "lm.facebook",
        ].map((v) => ({
          filter: { fieldName: "sessionSource", stringFilter: { matchType: "CONTAINS", value: v } },
        })),
      },
    },
    limit: 25,
  });

  console.log("\nSocial sources\n");
  const rows = sources.rows ?? [];
  if (!rows.length) {
    console.log("  none yet — expected until the posts have been running a while");
  } else {
    for (const row of rows) {
      console.log(`  ${dim(row).padEnd(22)} ${String(num(row)).padStart(5)} sessions, ${num(row, 1)} users`);
    }
  }

  const pages = await ga({
    dateRanges: [range(days, 0)],
    dimensions: [{ name: "landingPage" }],
    metrics: [{ name: "sessions" }],
    limit: 8,
  });
  console.log("\nTop landing pages\n");
  for (const row of pages.rows ?? []) {
    console.log(`  ${dim(row).slice(0, 44).padEnd(46)} ${String(num(row)).padStart(5)}`);
  }
  console.log();
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exitCode = 1;
});
