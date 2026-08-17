import { handleMcp, mcpMethodNotAllowed } from "@sailo/api/mcp";

/**
 * Sailo's MCP endpoint — one shop, addressed by a language model.
 *
 * The protocol itself is `@sailo/api/mcp`, because this endpoint answers on two
 * origins during the cutover and a protocol implemented twice is a protocol that
 * will disagree with itself. What is left here is what is actually Next's.
 *
 * `maxDuration` is one of those things: a tool call can fan out to several
 * queries, and the platform default is shorter than the slowest legitimate one.
 */
export const maxDuration = 60;

/*
 * The current revision has no GET stream and no session to delete. A server that
 * receives either says so with 405 rather than inventing a behaviour, and an
 * older client that tries falls back correctly.
 */
export function GET() {
  return mcpMethodNotAllowed();
}

export function DELETE() {
  return mcpMethodNotAllowed();
}

export function POST(request: Request) {
  return handleMcp(request);
}
