import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";

test("@workspace/mcp-server package exports resolve to built JavaScript for Node consumers", () => {
  const output = execFileSync(
    process.execPath,
    [
      "-e",
      [
        "Promise.all([",
        "  import('@workspace/mcp-server'),",
        "  import('@workspace/mcp-server/http'),",
        "  import('@workspace/mcp-server/stdio'),",
        "]).then(([main, http, stdio]) => {",
        "  if (!main.ApiClient || !main.createCadstoneMcpServer) throw new Error('missing main export');",
        "  if (!http.createMcpHttpHandler) throw new Error('missing http export');",
        "  if (!stdio.runStdioServer) throw new Error('missing stdio export');",
        "  console.log('ok');",
        "})",
      ].join("\n"),
    ],
    { encoding: "utf8" },
  );

  assert.equal(output.trim(), "ok");
});
