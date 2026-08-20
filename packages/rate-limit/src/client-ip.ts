import { headers } from "next/headers";
import { ipFromHeaders } from "./ip";

/*
 * The `next/headers` half. The parsing lives in `./ip`, which is pure, so
 * code holding a `Request` imports that and code inside a server action —
 * where there is no Request — asks here.
 */

export { ipFromHeaders } from "./ip";

/** The caller's address inside a server action, where there is no Request. */
export async function callerIp(): Promise<string> {
  return ipFromHeaders(await headers());
}
