import { NextResponse } from "next/server";
import { ipFromHeaders } from "@sailo/rate-limit/client-ip";
import { rateLimit } from "@sailo/rate-limit";
import {
  DEFAULT_COOKIE_DAYS,
  REFERRAL_COOKIE,
  normalizeReferralCode,
} from "@sailo/partners/program";
import { getProgramSettings } from "@sailo/partners/settings";

/**
 * How long the cookie lives, from the programme's own settings.
 *
 * The one database read this route does, and it is worth it: the attribution
 * window is something /hq can change, and a cookie hard-coded to 90 days would
 * make a 180-day setting a promise the browser silently breaks.
 *
 * Wrapped, because the property this route is built around is that a click
 * never fails. A settings table that cannot be reached falls back to the
 * default rather than five-hundreding somebody's referral link.
 */
async function cookieMaxAge(): Promise<number> {
  try {
    const { cookieDays } = await getProgramSettings();
    return cookieDays * 24 * 60 * 60;
  } catch {
    return DEFAULT_COOKIE_DAYS * 24 * 60 * 60;
  }
}

/**
 * `sailo.store/r/<code>` — the link a creator shares to bring in another one.
 *
 * All this does is remember the code and send the visitor to signup. Nothing
 * is decided here and nothing is written: the cookie is read exactly once,
 * later, when a shop is actually created (`attributeReferral`), and thrown
 * away in the same breath.
 *
 * **It never looks the code up.** That is the point, and it is worth being
 * explicit about because the obvious implementation is worse. "Valid code →
 * signup, unknown code → homepage" is an oracle: anyone can enumerate which
 * codes exist by watching where they land, which turns a public link into a
 * directory of every seller who has ever opened the referral card. Sending
 * every caller to the same place, with the same cookie, means the response
 * carries no information about the code at all — and an unknown code simply
 * attributes nothing when signup reads it. It also saves a database round
 * trip on a public, unauthenticated path, which is the second reason not to
 * do it.
 *
 * A malformed code sets no cookie, so a crafted path cannot park arbitrary
 * text in a visitor's jar for us to read back later.
 */
export async function GET(
  request: Request,
  { params }: RouteContext<"/r/[code]">,
) {
  /*
   * Public and unauthenticated, so it is rate limited like every other public
   * route. Generous, because the honest traffic here is a link in someone's
   * bio being tapped: this is a ceiling on scripted abuse, not on a launch.
   *
   * Throttled is not a refusal. The visitor still lands on signup — they just
   * arrive without attribution, which costs the referrer one signup and costs
   * the visitor nothing. Turning a burst of real clicks into a wall of 429s
   * would be the worse trade by a distance.
   */
  const ip = ipFromHeaders(request.headers);
  const verdict = await rateLimit(`ref:${ip}`, 60, 60);

  const { code: raw } = await params;
  const code = verdict.allowed ? normalizeReferralCode(raw) : null;

  const signup = new URL("/signup", request.url);
  const response = NextResponse.redirect(signup, {
    /*
     * 302, not 308. The destination depends on nothing about the code, but a
     * permanent redirect would be cached by the browser and the next visit to
     * the same link would skip this handler — and skip refreshing the cookie.
     */
    status: 302,
  });

  if (code) {
    response.cookies.set(REFERRAL_COOKIE, code, {
      maxAge: await cookieMaxAge(),
      path: "/",
      /*
       * `httpOnly` even though nothing secret is in here. No client code reads
       * this value — signup reads it on the server — so there is no reason to
       * expose it to script, and one less thing in `document.cookie` is one
       * less thing a third-party tag on a landing page can copy.
       *
       * `lax` because the visitor arrives by following a link from someone
       * else's site, which is exactly the navigation `lax` permits and
       * `strict` would drop — a `strict` cookie set here would be invisible
       * on the very next request.
       */
      httpOnly: true,
      sameSite: "lax",
      secure: signup.protocol === "https:",
    });
  }

  return response;
}
