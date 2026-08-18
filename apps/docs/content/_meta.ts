import type { MetaRecord } from "nextra";

/**
 * The reading order.
 *
 * Nextra falls back to alphabetical for anything not listed here, which for
 * this site would open on `/api` and put the quickstart eleventh. The order
 * below is the one somebody actually needs: what Sailo speaks, how to make one
 * call, then the rules that apply to every call, then the three surfaces, then
 * the things you only read once you are integrating.
 *
 * Separators rather than a flat list, because the sidebar is thirty-odd
 * entries and an unbroken run of thirty is a list nobody scans.
 */
export default {
  index: "Introduction",
  quickstart: "Quickstart",

  "-- basics": { type: "separator", title: "How everything works" },
  authentication: "Authentication",
  conventions: "Conventions",
  pagination: "Pagination",
  errors: "Errors",
  "rate-limits": "Rate limits",

  "-- surfaces": { type: "separator", title: "Reference" },
  api: "REST API",
  objects: "Objects",
  webhooks: "Webhooks",
  mcp: "MCP server",

  "-- guides": { type: "separator", title: "Guides" },
  guides: "Building an integration",

  "-- meta": { type: "separator", title: "" },
  changelog: "Changelog",
  support: "Support",
} satisfies MetaRecord;
