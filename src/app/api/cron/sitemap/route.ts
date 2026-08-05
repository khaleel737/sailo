import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";

/**
 * Nightly sitemap refresh. Scheduled from vercel.json.
 *
 * `sitemap.ts` already carries `revalidate = 86_400`, but that clock only ticks
 * when somebody asks for the file: the first request after the window serves
 * the stale copy and rebuilds in the background, so whoever triggered the
 * refresh is also the one who does not benefit from it. That is usually a
 * crawler, which means the sitemap Google reads is reliably one visit behind.
 *
 * This makes the refresh happen on a schedule instead of on traffic. By the
 * time a crawler arrives the file is already current, and a site nobody has
 * requested in a week still has an up-to-date sitemap waiting.
 *
 * It is a refresh, not a rebuild: the work is one `revalidatePath`, and the
 * regeneration that follows runs the same two queries the page always ran.
 */
export async function GET(request: Request) {
  // Vercel signs cron invocations with CRON_SECRET. Without the check this is
  // a free way to make the database re-run the fleet-wide queries on demand.
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  revalidatePath("/sitemap.xml");

  return NextResponse.json({ revalidated: "/sitemap.xml", at: Date.now() });
}
