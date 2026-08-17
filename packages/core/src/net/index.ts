/**
 * Facts about network addresses, with no opinion about Sailo.
 *
 * `./ip` classifies an address as publicly routable or not, which is the guard
 * standing between a seller-supplied URL and our own network. It was
 * `@sailo/core/net` — a reasonable home while `@sailo/security` was the
 * only caller, and the wrong one once `@sailo/webhooks` needed it too: two domain
 * packages, so the import ran sideways.
 *
 * There is nothing about a shop in here. It is address arithmetic — the private
 * ranges, loopback, link-local, the IPv6 equivalents — which is why it can sit at
 * the bottom and be reached by anything.
 */
export * from "./ip";
