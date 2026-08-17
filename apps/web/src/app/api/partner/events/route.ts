import { partnerEventStream } from "@sailo/api/streams";

/**
 * The partner portal's ear. The portal has no session — the unguessable token in
 * the URL is the credential, exactly as it is for the page itself
 * (`/partner/[token]`) — so the stream authenticates the same way.
 *
 * The handler, the rate limit and the token check are `@sailo/api/streams`,
 * because this endpoint answers on two origins and a door implemented twice is a
 * door that gets fixed once.
 *
 * `maxDuration` stays here: an SSE connection is meant to be held open, and the
 * platform default would cut it.
 */
export const maxDuration = 300;

export const GET = partnerEventStream;
