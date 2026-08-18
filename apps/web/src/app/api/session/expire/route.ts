import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";
import { auth } from "@/lib/auth";
import { localPath, parseSetCookie } from "@/lib/session-cookie";

/**
 * Throws away a session cookie the server will not honour, then sends the
 * visitor where they were going.
 *
 * The proxy redirects `/` to `/admin` on the *presence* of a session cookie,
 * which is the optimistic check Next and better-auth both recommend — a
 * database read there would run on every prefetch of every matched route.
 * Optimism needs a way to be wrong, and it had none: a cookie that no longer
 * resolves to a session sent `/` to `/admin`, `/admin` to `/login`, and left
 * the cookie exactly where it was. The next visit did the same thing, and so
 * did the one after that, for the thirty days of the cookie's Max-Age. A
 * seller who signed out on their phone could not reach sailo.store on their
 * laptop without clearing site data.
 *
 * The dead cookie is only ever discovered by code that has actually asked the
 * database — `requireUser` in `lib/session.ts` — and that runs while a Server
 * Component is rendering, where cookies cannot be written. A route handler is
 * the nearest place that can, so the guard redirects through here.
 *
 * Not `/api/auth/…`: that path belongs to better-auth's catch-all, and a
 * static segment quietly outranking someone else's route is the kind of
 * collision nobody finds until the library adds an endpoint by that name.
 */

export async function GET(request: NextRequest) {
  const to = new URL(
    localPath(request.nextUrl.searchParams.get("next")),
    request.nextUrl.origin,
  );

  /*
   * Re-checked here, not taken on trust from whoever linked to this route.
   *
   * This endpoint is a GET, so anything on the internet can point a browser at
   * it — `<img src="https://sailo.store/api/session/expire">` is enough.
   * Clearing unconditionally would make that a forced sign-out for any
   * signed-in seller who loads the attacker's page, which is why better-auth's
   * own sign-out is POST-only. Asking the database first makes the attempt a
   * no-op: a live session is left completely alone, and the only cookie this
   * can remove is one that was already worthless.
   */
  const stale =
    Boolean(getSessionCookie(request)) &&
    !(await auth.api.getSession({ headers: request.headers }));

  /*
   * 303, not 307: the visitor arrived here mid-redirect and what follows is a
   * plain GET of a page. It also stops any browser or proxy treating the hop
   * as repeatable against the original method.
   */
  if (!stale) return NextResponse.redirect(to, 303);

  const { headers } = await auth.api.signOut({
    headers: request.headers,
    returnHeaders: true,
  });

  /*
   * Re-stated through Next's own cookie store, with an explicit past expiry.
   *
   * Copying better-auth's `Set-Cookie` lines onto the response looked right
   * and silently did not work. `nextCookies()` — the plugin that exists so
   * Server Actions can set cookies — fires here too, writing the same three
   * cookies into Next's store, and Next dedupes by name and prefers its own.
   * Its serialiser then drops `Max-Age=0`, because zero is falsy, so what
   * reached the browser was `better-auth.session_token=; Path=/; HttpOnly;
   * SameSite=lax`: a cookie *emptied* rather than deleted. That is enough to
   * satisfy `getSessionCookie`, which reads an empty value as absent, so the
   * redirect loop did break — and three dead cookies stayed in the browser and
   * rode along with every request after it.
   *
   * `expires` in the past rather than `maxAge: 0`, since a zero is precisely
   * what got lost; a date always survives serialisation. Both are sent, so
   * `Max-Age` wins wherever a client honours it and `Expires` covers the rest.
   *
   * Which cookies, under which names, stays better-auth's answer — read back
   * off the headers it has just produced. In production they carry the
   * `__Secure-` prefix, and a hardcoded list here would be a second copy of
   * the library's own, drifting from it at the next release.
   */
  const jar = await cookies();
  for (const line of headers.getSetCookie()) {
    const cookie = parseSetCookie(line);
    if (!cookie.name) continue;
    jar.set(cookie.name, "", { ...cookie, expires: new Date(0), maxAge: 0 });
  }

  return NextResponse.redirect(to, 303);
}
