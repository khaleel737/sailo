import { appOrigin } from "@sailo/core/origin";
import {
  MCP_TOOLS,
  MODERN_VERSION,
  LEGACY_VERSIONS,
  SERVER_INFO,
  SUPPORTED_VERSIONS,
  type McpTool,
} from "@sailo/api/mcp";
import { DefTable, Label, Pre, Prose, ScopePill } from "./kit";

/**
 * The MCP reference, rendered from `MCP_TOOLS`.
 *
 * The same array the server answers `tools/list` from, and the same array
 * `tools/call` dispatches through — each entry carries its own `run`, so there
 * is no second list of names anywhere that could disagree with this one. A tool
 * added to the server is a tool on this page on the same deploy, and a tool
 * removed from it cannot linger here.
 *
 * Argument rows are walked out of each `inputSchema`, `required` array
 * included, for the same reason: a tool gaining an argument gains a row without
 * anybody editing prose. Where a property carries no description in the schema,
 * this says so rather than inventing one — that gap is exactly what the model
 * sees when it decides how to fill the argument, and hiding it from a developer
 * debugging a bad call would be the wrong kindness.
 */

/* -------------------------------------------------------------------------- */
/*  Counts and names                                                           */
/* -------------------------------------------------------------------------- */

export function ToolCount() {
  return <>{MCP_TOOLS.length}</>;
}

export function ReadToolCount() {
  return <>{MCP_TOOLS.filter((tool) => tool.scope === "read").length}</>;
}

/** The write tools, named — "create_contact and tag_contact". */
export function WriteToolNames() {
  return (
    <>
      {MCP_TOOLS.filter((tool) => tool.scope === "write")
        .map((tool) => tool.name)
        .join(" and ")}
    </>
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

export function LegacyVersions() {
  return <>{LEGACY_VERSIONS.join(", ")}</>;
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

/* -------------------------------------------------------------------------- */
/*  The index and the entries                                                  */
/* -------------------------------------------------------------------------- */

/** Every tool as one table — name, scope, one line. */
export function ToolIndex() {
  return (
    <DefTable
      caption="Every tool the MCP server exposes"
      headers={["Tool", "What it does"]}
      rows={MCP_TOOLS.map((tool) => ({
        term: tool.name,
        note: tool.scope === "write" ? "needs a write key" : "any key",
        body: (
          <a className="ref-index-path" href={`#${tool.name}`}>
            {tool.title}
          </a>
        ),
      }))}
    />
  );
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
  const properties = (tool.inputSchema.properties ?? {}) as Record<string, SchemaProperty>;
  const required = new Set((tool.inputSchema.required ?? []) as string[]);
  const names = Object.keys(properties);

  return (
    <section className="ref-entry" id={tool.name} data-tool={tool.name}>
      <h3 className="ref-entry-title">
        <span>{tool.name}</span>
        <ScopePill scope={tool.scope} />
      </h3>

      {/*
        The description is printed exactly as the server sends it to the model.
        Not paraphrased for a human reader, on purpose: when an assistant does
        something surprising, this text is the reason, and a prettier version
        here would send somebody looking for a cause that is not in the code.
      */}
      <p className="ref-entry-lead">
        <Prose>{tool.description}</Prose>
      </p>

      <Label>Arguments</Label>
      {names.length === 0 ? (
        <p className="ref-entry-lead">Takes none.</p>
      ) : (
        <DefTable
          caption={`Arguments for ${tool.name}`}
          headers={["Argument", "What it does"]}
          rows={names.map((name) => {
            const property = properties[name];
            return {
              term: name,
              note: [typeName(property), required.has(name) ? "required" : "optional"]
                .filter(Boolean)
                .join(" · "),
              body: property?.description ? (
                <Prose>{property.description}</Prose>
              ) : (
                <em>No description in the schema.</em>
              ),
            };
          })}
        />
      )}
    </section>
  );
}

type SchemaProperty = {
  type?: string;
  description?: string;
  items?: { type?: string };
};

function typeName(property: SchemaProperty | undefined): string {
  if (!property?.type) return "";
  if (property.type === "array") return `${property.items?.type ?? "any"}[]`;
  return property.type;
}

/* -------------------------------------------------------------------------- */
/*  Connecting                                                                 */
/*                                                                             */
/*  Every snippet interpolates `appOrigin()` rather than naming a host, so a    */
/*  preview deployment hands out its own address and a reader copying from      */
/*  these pages configures the server they are actually reading about.          */
/* -------------------------------------------------------------------------- */

const url = () => `${appOrigin()}/api/mcp`;

/** `claude mcp add …` — the one-liner, for Claude Code. */
export function ClaudeCodeSnippet() {
  return (
    <Pre>{`claude mcp add --transport http sailo ${url()} \\
  --header "Authorization: Bearer sailo_sk_…"`}</Pre>
  );
}

/** `.mcp.json` — committed to a repository so a whole team shares one connection. */
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

/** The `mcp-remote` bridge, for a client that speaks stdio and not HTTP. */
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

/** `.cursor/mcp.json`, or `~/.cursor/mcp.json` for every project. */
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

/** VS Code's own `.vscode/mcp.json` shape, which names the server under `servers`. */
export function VsCodeSnippet() {
  return (
    <Pre>{`{
  "servers": {
    "sailo": {
      "type": "http",
      "url": "${url()}",
      "headers": { "Authorization": "Bearer sailo_sk_…" }
    }
  }
}`}</Pre>
  );
}

/**
 * The handshake, over `curl`.
 *
 * Worth printing because it is how somebody debugging a client that will not
 * connect finds out whether the problem is theirs. A `tools/list` that answers
 * here and not in the client is a client configuration problem; one that fails
 * here names its own reason in the JSON-RPC error.
 */
export function CurlToolsListSnippet() {
  return (
    <Pre>{`curl -X POST ${url()} \\
  -H "Authorization: Bearer sailo_sk_…" \\
  -H "Content-Type: application/json" \\
  -H "MCP-Protocol-Version: ${MODERN_VERSION}" \\
  -H "Mcp-Method: tools/list" \\
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/list",
    "params": { "_meta": { "io.modelcontextprotocol/protocolVersion": "${MODERN_VERSION}" } }
  }'`}</Pre>
  );
}

/** A single tool call, for the same reason. */
export function CurlToolCallSnippet() {
  return (
    <Pre>{`curl -X POST ${url()} \\
  -H "Authorization: Bearer sailo_sk_…" \\
  -H "Content-Type: application/json" \\
  -H "MCP-Protocol-Version: ${MODERN_VERSION}" \\
  -H "Mcp-Method: tools/call" \\
  -H "Mcp-Name: get_shop" \\
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/call",
    "params": {
      "name": "get_shop",
      "arguments": {},
      "_meta": { "io.modelcontextprotocol/protocolVersion": "${MODERN_VERSION}" }
    }
  }'`}</Pre>
  );
}
