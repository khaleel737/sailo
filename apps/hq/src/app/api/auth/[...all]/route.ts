import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/lib/auth";

/**
 * better-auth's own endpoints, on this origin.
 *
 * Without this file the panel has no `/api/auth/*` to talk to: the sign-in form
 * would post into a 404 and the magic link would have nowhere to land. It is
 * separate from apps/web's identical-looking route on purpose — the two apps
 * are two origins with two instances, and this one serves exactly one endpoint
 * family that matters, `/sign-in/magic-link`.
 *
 * `getAuth()` rather than a module-scope `auth`, because building the instance
 * needs a database connection and Next imports this module while collecting
 * page data at build time. See the note in `lib/auth.ts`.
 */
const handler = toNextJsHandler((request: Request) => getAuth().handler(request));

export const { GET, POST } = handler;
