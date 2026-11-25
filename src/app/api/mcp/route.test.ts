import { test } from "node:test";
import assert from "node:assert/strict";
import { POST } from "@/app/api/mcp/route";

const VERSION = "2026-07-28";

function call(method: string, params: object): Promise<Response> {
  process.env.MCP_ACCESS_TOKEN = "test-only";
  const _meta = {
    "io.modelcontextprotocol/protocolVersion": VERSION,
    "io.modelcontextprotocol/clientInfo": { name: "test", version: "1" },
    "io.modelcontextprotocol/clientCapabilities": {},
  };
  return POST(
    new Request("http://localhost/api/mcp", {
      method: "POST",
      headers: {
        authorization: "Bearer test-only",
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": VERSION,
        "mcp-method": method,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: { ...params, _meta } }),
    }),
  );
}

test("the server doesn't offer tool-change notices", async () => {
  const { result } = await (await call("server/discover", {})).json();
  assert.deepEqual(result.capabilities, { tools: { listChanged: false } });
});

test("a client that listens for changes anyway is refused right away, not held open", async () => {
  const response = await call("subscriptions/listen", { notifications: { toolsListChanged: true } });
  assert.match(response.headers.get("content-type") ?? "", /application\/json/);
  assert.equal((await response.json()).error.code, -32603);
});
