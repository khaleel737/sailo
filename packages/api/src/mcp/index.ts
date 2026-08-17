/**
 * The Model Context Protocol endpoint: Sailo's REST API, described so an
 * assistant can call it.
 *
 * `./protocol` is the JSON-RPC framing — pure, and tested as such. `./tools`
 * maps each tool onto the same `./rest` handlers a `curl` request reaches, which
 * is the whole design: an assistant and an integrator get identical behaviour
 * because they are one code path, and a tool that drifted from its endpoint
 * would be a tool that lies about what the API does.
 */

export * from "./protocol";
export * from "./tools";
