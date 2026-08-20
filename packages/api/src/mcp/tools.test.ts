import { describe, expect, it } from "vitest";
import { MCP_TOOLS, findTool, toolsFor, toolResponse } from "./tools";
import { ENDPOINTS } from "../rest/endpoints";
import type { ApiCaller } from "../rest/auth";

/**
 * The shape of the tool catalogue, and the one rule about it that is a security
 * boundary rather than a convention.
 *
 * None of these call a handler — every handler needs a database, and what is
 * worth pinning here is the wiring rather than the queries. A tool whose schema
 * is malformed is invisible until a model sends an argument it silently drops;
 * a write tool visible to a read-only key is a hole.
 */

const caller = (scopes: string[]): ApiCaller =>
  ({
    shop: { id: "s", handle: "acme", currency: "GBP" },
    keyId: "k",
    scopes,
  }) as unknown as ApiCaller;

const readOnly = caller(["read"]);
const readWrite = caller(["read", "write"]);

describe("the tool catalogue", () => {
  it("names every tool once", () => {
    const names = MCP_TOOLS.map((tool) => tool.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("names them in snake_case", () => {
    /*
     * The argument spelling is documented as snake_case and the tool names
     * follow it. A single camelCase name is the kind of thing nobody notices
     * until a model guesses the other spelling and gets `-32602`.
     */
    for (const tool of MCP_TOOLS) {
      expect(tool.name, tool.name).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });

  it("gives every tool a description that says more than its name", () => {
    /*
     * A description that restates the name tells a model nothing it did not
     * already know, which is the failure this file's header warns about. The
     * floor is deliberately low — this catches an empty or one-word entry, not
     * a badly written one.
     */
    for (const tool of MCP_TOOLS) {
      expect(tool.description.length, tool.name).toBeGreaterThan(80);
      expect(tool.title.length, tool.name).toBeGreaterThan(0);
    }
  });

  it("closes every input schema to unknown arguments", () => {
    /*
     * `additionalProperties: false` on all of them. An open schema lets a model
     * send `payment_status` to a tool that reads `status`, get no error, and
     * report a filtered answer that was never filtered.
     */
    for (const tool of MCP_TOOLS) {
      expect(tool.inputSchema.type, tool.name).toBe("object");
      expect(tool.inputSchema.additionalProperties, tool.name).toBe(false);
    }
  });

  it("describes every property of every input schema", () => {
    /*
     * Except the free-form contact fields on `create_contact`, whose names are
     * the description — `name`, `email`, `phone`.
     */
    const selfEvident = new Set(["name", "email", "phone"]);

    for (const tool of MCP_TOOLS) {
      const properties = (tool.inputSchema.properties ?? {}) as Record<
        string,
        { description?: string }
      >;
      for (const [property, schema] of Object.entries(properties)) {
        if (selfEvident.has(property)) continue;
        expect(schema.description, `${tool.name}.${property}`).toBeTruthy();
      }
    }
  });

  it("marks every required argument as a real property", () => {
    for (const tool of MCP_TOOLS) {
      const required = (tool.inputSchema.required ?? []) as string[];
      const properties = Object.keys(
        (tool.inputSchema.properties ?? {}) as Record<string, unknown>,
      );
      for (const name of required) {
        expect(properties, `${tool.name}.${name}`).toContain(name);
      }
    }
  });
});

describe("scope filtering", () => {
  it("hides every write tool from a read-only key", () => {
    const visible = toolsFor(readOnly);
    expect(visible.length).toBeGreaterThan(0);
    expect(visible.every((tool) => tool.scope === "read")).toBe(true);
  });

  it("refuses to resolve a write tool by name for a read-only key", () => {
    /*
     * The half that matters. Hiding a tool from `tools/list` is a courtesy; a
     * model that guessed the name and called it anyway must still be refused,
     * and this is the lookup `tools/call` goes through.
     */
    const writeTools = MCP_TOOLS.filter((tool) => tool.scope === "write");
    expect(writeTools.length).toBeGreaterThan(0);

    for (const tool of writeTools) {
      expect(findTool(readOnly, tool.name), tool.name).toBeNull();
      expect(findTool(readWrite, tool.name), tool.name).not.toBeNull();
    }
  });

  it("shows every tool to a read-write key", () => {
    expect(toolsFor(readWrite)).toHaveLength(MCP_TOOLS.length);
  });

  it("keeps the write tools to contacts", () => {
    /*
     * The line the documentation states in as many words: an assistant can
     * change who is on a list and what they are labelled, and nothing else. A
     * write tool appearing here for orders, products or money is a change to
     * what a key means, and it should not be possible to make it quietly.
     */
    const writeNames = MCP_TOOLS.filter((tool) => tool.scope === "write").map((t) => t.name);
    expect(writeNames).toEqual(["create_contact", "tag_contact", "update_contact_lists"]);
  });
});

describe("tools against the REST catalogue", () => {
  it("exposes a tool for every documented read endpoint", () => {
    /*
     * The two surfaces are one code path, and this is what keeps them one
     * *offering*: an endpoint added to `ENDPOINTS` without a tool is a thing an
     * integrator can do and an assistant silently cannot.
     *
     * Keyed on the handler each one is for rather than on a name convention,
     * because `GET /contacts/{id}/lists` is `get_contact_lists` and no rule
     * derives that from the path.
     */
    const toolNames = new Set(MCP_TOOLS.map((tool) => tool.name));
    const expected: Record<string, string> = {
      getShop: "get_shop",
      listOrders: "list_orders",
      getOrder: "get_order",
      listProducts: "list_products",
      getProduct: "get_product",
      listContacts: "list_contacts",
      getContact: "get_contact",
      createContact: "create_contact",
      tagContact: "tag_contact",
      listLists: "list_lists",
      getList: "get_list",
      getContactLists: "get_contact_lists",
      updateContactLists: "update_contact_lists",
      listSubscriptions: "list_subscriptions",
      getSubscription: "get_subscription",
      listDisputes: "list_disputes",
      getDispute: "get_dispute",
      listBookings: "list_bookings",
      getBooking: "get_booking",
      listStaff: "list_staff",
      getStaff: "get_staff",
    };

    for (const endpoint of ENDPOINTS) {
      const tool = expected[endpoint.id];
      expect(tool, `no tool mapped for endpoint ${endpoint.id}`).toBeTruthy();
      expect(toolNames, `${endpoint.id} → ${tool}`).toContain(tool);
    }

    // And nothing in the map that is not an endpoint, so the map cannot rot.
    const endpointIds = new Set(ENDPOINTS.map((endpoint) => endpoint.id));
    for (const id of Object.keys(expected)) {
      expect(endpointIds, `${id} is mapped but is not an endpoint`).toContain(id);
    }
  });

  it("carries a tool for every endpoint and no more", () => {
    expect(MCP_TOOLS).toHaveLength(ENDPOINTS.length);
  });
});

describe("toolResponse", () => {
  it("sends a refusal as an execution error, not a protocol one", () => {
    /*
     * The distinction a model can act on. "No contact with that id" is
     * something it can recover from by looking for the right one; a JSON-RPC
     * error says the call was malformed and leaves it nothing to do.
     */
    const answer = toolResponse({
      ok: false,
      failure: { code: "not_found", message: "No such contact." },
    });

    expect(answer.isError).toBe(true);
    expect(answer.content).toEqual([{ type: "text", text: "No such contact." }]);
    expect(answer.structuredContent).toBeUndefined();
  });

  it("carries a page's envelope into structured content", () => {
    const answer = toolResponse({
      ok: true,
      data: [{ id: "1" }],
      page: { items: [], hasMore: true, nextCursor: "abc" },
    });

    expect(answer.isError).toBe(false);
    expect(answer.structuredContent).toEqual({
      data: [{ id: "1" }],
      has_more: true,
      next_cursor: "abc",
    });
  });

  it("serialises the same payload into the text block", () => {
    /*
     * Both, which the specification recommends for the reason it looks
     * redundant: a client that ignores structured content still shows the model
     * something rather than an empty result.
     */
    const answer = toolResponse({ ok: true, data: { id: "1", object: "shop" } });
    const [block] = answer.content as { type: string; text: string }[];

    expect(JSON.parse(block.text)).toEqual(answer.structuredContent);
  });
});
