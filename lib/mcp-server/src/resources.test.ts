import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { ApiClient, ApiRequest } from "./api-client";
import { listResources } from "./resources";

describe("listResources", () => {
  test("surfaces backing API failures instead of returning partial empty lists", async () => {
    const client = {
      request: async (req: ApiRequest) => {
        if (req.path === "/jobs") {
          throw new Error("jobs endpoint unavailable");
        }
        if (req.path === "/leads") {
          return { status: 200, data: { leads: [] }, contentType: "application/json" };
        }
        return { status: 200, data: { clients: [] }, contentType: "application/json" };
      },
    } as unknown as ApiClient;

    await assert.rejects(listResources(client), /jobs endpoint unavailable/);
  });
});
