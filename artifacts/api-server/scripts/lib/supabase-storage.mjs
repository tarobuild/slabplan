import { Readable } from "node:stream";

export const STONE_TRACK_UPLOADS_PREFIX = "stone-track/uploads";
export const SUPABASE_OBJECT_MISSING_STATUSES = new Set([400, 404]);

export function getRequiredEnv(key, env = process.env) {
  const value = env[key]?.trim();
  if (!value) {
    throw new Error(`${key} is not set.`);
  }
  return value;
}

export function getSupabaseStorageConfig(env = process.env) {
  const rawUrl = getRequiredEnv("SUPABASE_URL", env);
  return {
    url: rawUrl.endsWith("/") ? rawUrl.slice(0, -1) : rawUrl,
    bucketName: getRequiredEnv("SUPABASE_STORAGE_BUCKET", env),
    serviceRoleKey: getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY", env),
  };
}

export function uploadsObjectPrefix() {
  return `${STONE_TRACK_UPLOADS_PREFIX}/`;
}

function encodeStoragePath(value) {
  return value.split("/").map(encodeURIComponent).join("/");
}

export function fileUrlToObjectName({ fileUrl }) {
  if (!fileUrl || typeof fileUrl !== "string") {
    throw new Error("Stored file URL is missing.");
  }
  const match = /^\/uploads\/(.+)$/.exec(fileUrl);
  if (!match) {
    throw new Error(`Invalid stored file URL: ${fileUrl}`);
  }
  const relative = match[1];
  if (
    relative.includes("..") ||
    relative.startsWith("/") ||
    relative.includes("\0")
  ) {
    throw new Error(`Invalid stored file URL: ${fileUrl}`);
  }
  return `${uploadsObjectPrefix()}${relative}`;
}

export function objectNameToFileUrl({ objectName }) {
  if (!objectName || typeof objectName !== "string") return null;
  const prefix = uploadsObjectPrefix();
  if (!objectName.startsWith(prefix)) return null;
  const relative = objectName.slice(prefix.length);
  if (!relative) return null;
  return `/uploads/${relative}`;
}

export async function supabaseStorageRequest(
  config,
  storagePath,
  init = {},
  okStatuses = new Set([200]),
) {
  const headers = new Headers(init.headers);
  headers.set("apikey", config.serviceRoleKey);
  headers.set("Authorization", `Bearer ${config.serviceRoleKey}`);

  const response = await fetch(`${config.url}/storage/v1${storagePath}`, {
    ...init,
    headers,
  });

  if (!okStatuses.has(response.status)) {
    let body = "";
    try {
      body = await response.text();
    } catch {
      body = "";
    }
    throw new Error(
      `Supabase Storage request failed (${response.status}) for ${storagePath}${
        body ? `: ${body.slice(0, 240)}` : ""
      }`,
    );
  }

  return response;
}

export function createSupabaseStorage(env = process.env) {
  const config = getSupabaseStorageConfig(env);
  const encodedBucket = encodeURIComponent(config.bucketName);
  const objectPath = (objectName) =>
    `${encodedBucket}/${encodeStoragePath(objectName)}`;

  async function headBucket() {
    await supabaseStorageRequest(
      config,
      `/bucket/${encodedBucket}`,
      { method: "HEAD" },
      new Set([200]),
    );
  }

  async function uploadStream(objectName, stream, options = {}) {
    await supabaseStorageRequest(
      config,
      `/object/${objectPath(objectName)}`,
      {
        method: "POST",
        headers: {
          "Content-Type": options.contentType ?? "application/octet-stream",
          "x-upsert": options.upsert === false ? "false" : "true",
          ...(options.contentLengthBytes !== undefined
            ? { "Content-Length": String(options.contentLengthBytes) }
            : {}),
          ...(options.cacheControl
            ? { "Cache-Control": options.cacheControl }
            : {}),
        },
        body: Readable.toWeb(stream),
        duplex: "half",
      },
      new Set([200, 201]),
    );
  }

  async function uploadBuffer(objectName, buffer, options = {}) {
    await supabaseStorageRequest(
      config,
      `/object/${objectPath(objectName)}`,
      {
        method: "POST",
        headers: {
          "Content-Type": options.contentType ?? "application/octet-stream",
          "x-upsert": options.upsert === false ? "false" : "true",
          ...(options.cacheControl
            ? { "Cache-Control": options.cacheControl }
            : {}),
        },
        body: buffer,
      },
      new Set([200, 201]),
    );
  }

  async function getObjectInfo(objectName) {
    const response = await supabaseStorageRequest(
      config,
      `/object/${objectPath(objectName)}`,
      { method: "HEAD" },
      new Set([200, ...SUPABASE_OBJECT_MISSING_STATUSES]),
    );
    if (response.status !== 200) return null;
    return {
      objectName,
      sizeBytes: Number(response.headers.get("content-length") ?? 0),
      contentType: response.headers.get("content-type"),
      updated: response.headers.get("last-modified"),
    };
  }

  async function objectExists(objectName) {
    return (await getObjectInfo(objectName)) !== null;
  }

  async function downloadBuffer(objectName) {
    const response = await supabaseStorageRequest(
      config,
      `/object/${objectPath(objectName)}`,
      { method: "GET" },
      new Set([200]),
    );
    return Buffer.from(await response.arrayBuffer());
  }

  async function deleteObject(objectName) {
    await supabaseStorageRequest(
      config,
      `/object/${objectPath(objectName)}`,
      { method: "DELETE" },
      new Set([200, ...SUPABASE_OBJECT_MISSING_STATUSES]),
    );
  }

  async function deleteObjects(objectNames, concurrency = 10) {
    let deleted = 0;
    for (let i = 0; i < objectNames.length; i += concurrency) {
      const batch = objectNames.slice(i, i + concurrency);
      await Promise.all(
        batch.map(async (objectName) => {
          await deleteObject(objectName);
          deleted += 1;
        }),
      );
    }
    return deleted;
  }

  async function listPage(prefix, offset, limit) {
    const response = await supabaseStorageRequest(
      config,
      `/object/list/${encodedBucket}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prefix,
          limit,
          offset,
          sortBy: { column: "name", order: "asc" },
        }),
      },
      new Set([200]),
    );
    return await response.json();
  }

  async function listAllObjects(prefix, options = {}) {
    const limit = options.limit ?? 1000;
    const maxObjects = options.maxObjects ?? 500_000;
    const objects = [];

    async function walk(currentPrefix) {
      let offset = 0;
      while (true) {
        const page = await listPage(currentPrefix, offset, limit);
        for (const item of page) {
          const objectName = currentPrefix
            ? `${currentPrefix.replace(/\/+$/, "")}/${item.name}`
            : item.name;
          if (item.metadata === null && item.id === null) {
            await walk(objectName);
            continue;
          }
          objects.push({
            name: objectName,
            metadata: item.metadata ?? {},
            updated: item.updated_at ?? null,
            created: item.created_at ?? null,
          });
          if (objects.length > maxObjects) {
            throw new Error(
              `Storage listing exceeded maxObjects=${maxObjects}. ` +
                "Refusing to continue. Re-run with a higher cap or investigate why storage has so many objects.",
            );
          }
        }
        if (page.length < limit) break;
        offset += limit;
      }
    }

    await walk(prefix.replace(/\/+$/, ""));
    return objects;
  }

  return {
    bucketName: config.bucketName,
    headBucket,
    uploadStream,
    uploadBuffer,
    getObjectInfo,
    objectExists,
    downloadBuffer,
    deleteObject,
    deleteObjects,
    listAllObjects,
  };
}
