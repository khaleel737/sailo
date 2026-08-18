import { appOrigin } from "@sailo/core/origin";
import {
  MCP_TOOLS,
  MODERN_VERSION,
  SERVER_INFO,
  SUPPORTED_VERSIONS,
  type McpTool,
} from "@sailo/api/mcp";
import { DefTable, Pre } from "./kit";

/**
 * The MCP reference, rendered from `MCP_TOOLS`.
 *
 * The same array the server answers `tools/list` from, and the same array
 * `tools/call` dispatches through — each tool carries its own `run`, so there
 * is no second list of names anywhere that could disagree with this one. A
 * tool added to the server is a tool on this page on the same deploy, and a
 * tool removed from it cannot linger here.
 *
 * Argument rows are walked out of each `inputSchema`, `required` array
 * included, for the same reason: a tool gaining an argument gains a row here
 * without anybody editing prose.
 */

/** How many tools there are, for prose that would otherwise count by hand. */
export function ToolCount() {
  return <>{MCP_TOOLS.length}</>;
}

/** The write tools, named — "create_contact and tag_contact". */
export function WriteToolNames() {
  return <>{MCP_TOOLS.filter((tool) => tool.scope === "write").map((tool) => tool.name).join(" and ")}</>;
}

export function ToolReference() {
  return (
    <>
      {MCP_TOOLS.map((tool) => (
        <ToolEntry key={tool.name} tool={tool} />
      ))}
    </>
  );
}

/* -------------------------------------------------------------------------- */

function ToolEntry({ tool }: { tool: McpTool }) {
  const properties = (tool.inputSchema.properties ?? {}) as Record<
    string,
    { type?: string; description?: string; items?: { type?: string }; enum?: unknown[] }
  >;
  const required = new Set((tool.inputSchema.required ?? []) as string[]);
  const names = Object.keys(properties);

  return (
    <div className="mt-8 border-t border-ink-200 pt-6" id={tool.name}>
      <h3 className="font-mono text-sm font-semibold text-ink-900">
        {tool.name}
        {tool.scope === "write" ? (
          <span className="ms-2 rounded bg-ink-100 px-1.5 py-0.5 font-sans text-[0.6875rem] font-medium text-ink-900">
            write
          </span>
        ) : null}
      </h3>

      <p className="mt-2 text-sm leading-relaxed text-ink-600">{tool.description}</p>

      {names.length === 0 ? (
        <p className="mt-2 text-xs italic text-ink-600">Takes no arguments.</p>
      ) : (
        <DefTable
          caption={`Arguments for ${tool.name}`}
          rows={names.map((name) => {
            const property = properties[name];
            return {
              term: name,
              note: [typeName(property), required.has(name) ? "required" : null]
                .filter(Boolean)
                .join(", "),
              /*
               * Several properties carry no description in the schema. Saying
               * so is better than inventing one — and it is the same gap the
               * model sees when it decides how to fill the argument.
               */
              body: property?.description ?? <span className="italic">No description.</span>,
            };
          })}
        />
      )}
    </div>
  );
}

function typeName(property: { type?: string; items?: { type?: string } } | undefined): string {
  if (!property?.type) return "";
  if (property.type === "array") return `${property.items?.type ?? "any"}[]`;
  return property.type;
}

/* -------------------------------------------------------------------------- */
/*  Connecting                                                                 */
/*                                                                             */
/*  Every snippet interpolates `appOrigin()` rather than naming a host, so a    */
/*  preview deployment hands out its own address and a reader copying from      */
/*  these pages configures the server they are actually reading.                */
/* -------------------------------------------------------------------------- */

const url = () => `${appOrigin()}/api/mcp`;

export function ClaudeCodeSnippet() {
  return (
    <Pre>{`claude mcp add --transport http sailo ${url()} \\
  --header "Authorization: Bearer sailo_sk_…"`}</Pre>
  );
}

export function McpJsonSnippet() {
  return (
    <Pre>{`{
  "mcpServers": {
    "sailo": {
      "type": "http",
      "url": "${url()}",
      "headers": { "Authorization": "Bearer sailo_sk_…" }
    }
  }
}`}</Pre>
  );
}

export function McpRemoteSnippet() {
  return (
    <Pre>{`{
  "mcpServers": {
    "sailo": {
      "command": "npx",
      "args": [
        "-y", "mcp-remote", "${url()}",
        "--header", "Authorization: Bearer sailo_sk_…"
      ]
    }
  }
}`}</Pre>
  );
}

export function CursorSnippet() {
  return (
    <Pre>{`{
  "mcpServers": {
    "sailo": {
      "url": "${url()}",
      "headers": { "Authorization": "Bearer sailo_sk_…" }
    }
  }
}`}</Pre>
  );
}

/* -------------------------------------------------------------------------- */
/*  Protocol                                                                   */
/* -------------------------------------------------------------------------- */

/*
 * From `mcp/protocol.ts`, for the same reason the tool table is from
 * `MCP_TOOLS`: a page naming a protocol version the server no longer speaks is
 * a page that sends a client into a handshake it will lose.
 */

export function ModernVersion() {
  return <>{MODERN_VERSION}</>;
}

export function SupportedVersions() {
  return <>{SUPPORTED_VERSIONS.join(", ")}</>;
}

export function ServerName() {
  return <>{SERVER_INFO.name}</>;
}

export function ServerVersion() {
  return <>{SERVER_INFO.version}</>;
}
