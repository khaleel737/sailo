import type { MetaRecord } from "nextra";

/**
 * What it is, how to connect a client, what it may do, what it can call, and —
 * last, for the person debugging rather than adopting — the wire protocol.
 *
 * `permissions` before `tools` because "what can an assistant do to my shop" is
 * the question somebody asks before they paste a key, and the tool table is the
 * answer to a question they only have afterwards.
 */
export default {
  index: "Overview",
  connect: "Connecting a client",
  permissions: "What it can do",
  tools: "Tool reference",
  protocol: "Protocol",
} satisfies MetaRecord;
