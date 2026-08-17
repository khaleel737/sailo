import { NextResponse } from "next/server";
import { cronAuthFailure } from "@sailo/security/cron-auth";
import { revalidateTag } from "next/cache";

/**
 * Nightly sitemap refresh. Scheduled from vercel.json.
 *
 * `sitemap.ts` caches its body with `cacheLife("days")`, but that clock only
 * ticks when somebody asks for the file: the first request after the window
 * serves the stale copy and rebuilds in the background, so whoever triggered
 * the refresh is also the one who does not benefit from it. That is usually a
 * crawler, which means the sitemap Google reads is reliably one visit behind.
 *
 * This makes the refresh happen on a schedule instead of on traffic. By the
 * time a crawler arrives the file is already current, and a site nobody has
 * requested in a week still has an up-to-date sitemap waiting.
 *
 * It is a refresh, not a rebuild: the work is one `revalidateTag`, and the
 * regeneration that follows runs the same two queries the page always ran.
 */
export async function GET(request: Request) {
  // Vercel signs cron invocations with CRON_SECRET. Without the check this is
  // a free way to make the database re-run the fleet-wide queries on demand.
  const denied = cronAuthFailure(request);
  if (denied) return denied;

  /*
   * The tag, not the path. `sitemap.ts` builds its body inside a `"use cache"`
   * function tagged `sitemap`; `revalidatePath` addressed a segment config
   * that no longer exists, so this had been a no-op since the Cache Components
   * migration — which is why the route had quietly gone back to running its
   * fleet-wide queries on every crawler hit.
   */
  revalidateTag("sitemap", "days");

  return NextResponse.json({ revalidated: "sitemap", at: Date.now() });
}
