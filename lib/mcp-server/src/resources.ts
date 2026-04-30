import { ApiClient } from "./api-client";

export type McpResourceDescriptor = {
  uri: string;
  name: string;
  description?: string;
  mimeType: string;
};

export type McpResourceContent = {
  uri: string;
  mimeType: string;
  text: string;
};

const URI_PATTERNS = [
  { kind: "job" as const, prefix: "cadstone://job/", path: (id: string) => `/jobs/${id}` },
  { kind: "lead" as const, prefix: "cadstone://lead/", path: (id: string) => `/leads/${id}` },
  { kind: "client" as const, prefix: "cadstone://client/", path: (id: string) => `/clients/${id}` },
  { kind: "file" as const, prefix: "cadstone://file/", path: (id: string) => `/files/${id}` },
  { kind: "folder" as const, prefix: "cadstone://folder/", path: (id: string) => `/folders/${id}` },
];

export function parseResourceUri(uri: string): { restPath: string; kind: string } | null {
  for (const pattern of URI_PATTERNS) {
    if (uri.startsWith(pattern.prefix)) {
      const id = uri.slice(pattern.prefix.length);
      if (id.length === 0) return null;
      return { restPath: pattern.path(id), kind: pattern.kind };
    }
  }
  return null;
}

export async function listResources(client: ApiClient): Promise<McpResourceDescriptor[]> {
  const [jobsRes, leadsRes, clientsRes] = await Promise.all([
    client
      .request<{ jobs?: Array<{ id: string; title: string }> }>({
        method: "GET",
        path: "/jobs",
        query: { pageSize: 25 },
        toolName: "resources/list",
      })
      .then((r) => r.data)
      .catch(() => ({ jobs: [] })),
    client
      .request<{ leads?: Array<{ id: string; title: string }> }>({
        method: "GET",
        path: "/leads",
        query: { pageSize: 25 },
        toolName: "resources/list",
      })
      .then((r) => r.data)
      .catch(() => ({ leads: [] })),
    client
      .request<{ clients?: Array<{ id: string; companyName: string }> }>({
        method: "GET",
        path: "/clients",
        query: { pageSize: 25 },
        toolName: "resources/list",
      })
      .then((r) => r.data)
      .catch(() => ({ clients: [] })),
  ]);

  const descriptors: McpResourceDescriptor[] = [];

  for (const job of jobsRes?.jobs ?? []) {
    descriptors.push({
      uri: `cadstone://job/${job.id}`,
      name: `Job: ${job.title}`,
      description: "Construction job with assignees, schedule, daily logs, and files.",
      mimeType: "application/json",
    });
  }

  for (const lead of leadsRes?.leads ?? []) {
    descriptors.push({
      uri: `cadstone://lead/${lead.id}`,
      name: `Lead: ${lead.title}`,
      description: "Pre-sale lead with contacts, salespeople, and attachments.",
      mimeType: "application/json",
    });
  }

  for (const c of clientsRes?.clients ?? []) {
    descriptors.push({
      uri: `cadstone://client/${c.id}`,
      name: `Client: ${c.companyName}`,
      description: "Client/company record with contacts and associated jobs.",
      mimeType: "application/json",
    });
  }

  return descriptors;
}

export async function readResource(
  client: ApiClient,
  uri: string,
): Promise<McpResourceContent> {
  const parsed = parseResourceUri(uri);
  if (!parsed) {
    throw new Error(`Unknown resource URI: ${uri}`);
  }

  const result = await client.request({
    method: "GET",
    path: parsed.restPath,
    toolName: "resources/read",
  });

  return {
    uri,
    mimeType: "application/json",
    text: JSON.stringify(result.data, null, 2),
  };
}
