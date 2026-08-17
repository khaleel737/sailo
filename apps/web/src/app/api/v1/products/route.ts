import { listProducts } from "@sailo/api/rest";
import { handleList } from "@sailo/api/rest";

/**
 * `GET /api/v1/products` — the catalogue, newest first.
 *
 * `published` takes `true` or `false` and nothing else, and its absence means
 * *both*. That is deliberate: a caller syncing a storefront wants only the
 * published ones, and a caller auditing their own catalogue wants the drafts
 * too, and neither should have to know which one we picked as the default.
 */
export async function GET(request: Request) {
  return handleList(request, (caller, options, url) => {
    const published = url.searchParams.get("published");

    return listProducts(caller, {
      ...options,
      kind: url.searchParams.get("kind"),
      published: published === null ? null : published === "true",
    });
  });
}
