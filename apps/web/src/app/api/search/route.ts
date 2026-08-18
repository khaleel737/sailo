import { createFromSource } from "fumadocs-core/search/server";
import { source } from "@/lib/docs-source";

/**
 * Search over the developer documentation.
 *
 * Static, in-process and unauthenticated. The corpus is four public pages that
 * change when we deploy, so there is no index to host, no key to rotate and no
 * third-party service in the path of a page that exists to be read before
 * somebody has an account.
 *
 * `/api/search` rather than `/api/v1/search`: everything under `/api/v1` is the
 * public REST contract, and `rest-contract.test.ts` walks that tree demanding
 * every route it finds is described in `@sailo/api/rest` and in the OpenAPI
 * document. This is app furniture, not part of the API anyone integrates
 * against, and putting it there would either fail that gate or force a lie into
 * the contract to satisfy it.
 */
export const { GET } = createFromSource(source);
