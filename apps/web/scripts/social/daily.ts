/**
 * The daily run. Renders the day's post and publishes it to every connected
 * network.
 *
 *   npm run social:dry     # render + print the captions, publish nothing
 *   npm run social         # for real
 *
 * Safety properties that matter for something running unattended:
 *
 * - Idempotent per day. Every success is appended to `runs.jsonl` and a
 *   platform already marked posted for today is skipped, so a retry after a
 *   partial failure finishes the job instead of double-posting.
 * - Deterministic content. The post is chosen by day-of-year, so the retry
 *   publishes the same thing the first attempt was publishing.
 * - Partial failure is normal. One network erroring never blocks the others,
 *   and an unlinked network is `skipped`, not an error.
 *
 * Canvas per network: square for the two Meta feeds where height is reach, and
 * the 1.91:1 for LinkedIn and X where the timeline crops tall images anyway.
 */
import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { postForDate, type Post } from "./content";
import { renderBoth } from "./render";
import {
  postFacebook,
  postInstagram,
  postLinkedIn,
  postX,
  uploadArt,
  type Outcome,
} from "./publish";

const LOG_DIR = join(process.cwd(), "scripts", "social", ".log");
const LOG = join(LOG_DIR, "runs.jsonl");

const ALL = ["instagram", "facebook", "linkedin", "x"] as const;
type Platform = (typeof ALL)[number];

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Platforms already published today, so a re-run cannot repeat them. */
async function alreadyPosted(day: string): Promise<Set<string>> {
  const done = new Set<string>();
  try {
    const text = await readFile(LOG, "utf8");
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      try {
        const row = JSON.parse(line);
        if (row.day === day && row.status === "posted") done.add(row.platform);
      } catch {
        /* A truncated line is not worth failing the run over. */
      }
    }
  } catch {
    /* No log yet — nothing has been posted. */
  }
  return done;
}

async function record(day: string, post: Post, outcome: Outcome) {
  await mkdir(LOG_DIR, { recursive: true });
  await appendFile(
    LOG,
    JSON.stringify({ day, at: new Date().toISOString(), postId: post.id, ...outcome }) + "\n",
    "utf8",
  );
}

function announce(o: Outcome) {
  const mark = o.status === "posted" ? "✓" : o.status === "skipped" ? "–" : "✗";
  const tail =
    o.status === "posted" ? o.id : o.status === "skipped" ? o.reason : o.reason.slice(0, 180);
  console.log(`  ${mark} ${o.platform.padEnd(10)} ${tail}`);
}

async function main() {
  const dry = process.argv.includes("--dry-run");
  const only = process.argv
    .filter((a) => a.startsWith("--only="))
    .flatMap((a) => a.slice(7).split(","))
    .filter((p): p is Platform => (ALL as readonly string[]).includes(p));

  /*
   * Kill switch. `touch scripts/social/.paused` stops the scheduled run without
   * unloading the launchd job or editing anything — the fastest way to halt
   * posting from a phone over SSH, or to hold the feed during an incident.
   */
  if (existsSync(join(process.cwd(), "scripts", "social", ".paused"))) {
    console.log("Paused (scripts/social/.paused exists) — nothing posted.");
    return;
  }

  const day = today();
  const post = postForDate(new Date());
  const targets: Platform[] = only.length ? only : [...ALL];

  console.log(`\nSailo daily — ${day}`);
  console.log(`post: ${post.id}  (${post.pillar} · ${post.template})\n`);

  const art = await renderBoth(post);
  console.log(`art:  ${art.square}\n      ${art.wide}\n`);

  if (dry) {
    for (const p of targets) {
      const caption = post.caption[p === "x" ? "x" : (p as "instagram" | "facebook" | "linkedin")];
      console.log(`── ${p} ${"─".repeat(Math.max(0, 60 - p.length))}`);
      console.log(caption + (post.link && p !== "instagram" ? `\n\n${post.link}` : ""));
      console.log();
    }
    console.log("Dry run — nothing was published.");
    return;
  }

  const done = await alreadyPosted(day);
  if (done.size) console.log(`already posted today: ${[...done].join(", ")}\n`);

  const squareUrl = await uploadArt(art.square, `${day}/${post.id}`);
  const wideUrl = await uploadArt(art.wide, `${day}/${post.id}`);

  const jobs: Record<Platform, () => Promise<Outcome>> = {
    instagram: () => postInstagram(post, squareUrl),
    facebook: () => postFacebook(post, squareUrl),
    linkedin: () => postLinkedIn(post, wideUrl),
    x: () => postX(post, wideUrl),
  };

  for (const platform of targets) {
    if (done.has(platform)) {
      announce({ platform, status: "skipped", reason: "already posted today" });
      continue;
    }
    let outcome: Outcome;
    try {
      outcome = await jobs[platform]();
    } catch (err) {
      outcome = { platform, status: "failed", reason: (err as Error).message };
    }
    announce(outcome);
    await record(day, post, outcome);
  }

  console.log(`\nblob: ${squareUrl}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
