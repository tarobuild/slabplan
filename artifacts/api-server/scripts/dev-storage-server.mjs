#!/usr/bin/env node
import { createServer } from "node:http";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
const storageRoot = process.env.DEV_STORAGE_ROOT
  ? path.resolve(process.env.DEV_STORAGE_ROOT)
  : path.join(repoRoot, "artifacts", "demo-storage");
const bucketName = process.env.SUPABASE_STORAGE_BUCKET || "slabplan-files";
const port = Number.parseInt(process.env.DEV_STORAGE_PORT || "54329", 10);
const host = process.env.DEV_STORAGE_HOST || "127.0.0.1";

function sendJson(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function decodeObjectPath(rawPath) {
  const parts = rawPath.split("/").filter(Boolean).map(decodeURIComponent);
  const bucket = parts.shift();
  if (bucket !== bucketName || parts.length === 0) return null;
  if (
    parts.some(
      (segment) =>
        segment === "." ||
        segment === ".." ||
        segment.includes("\\") ||
        segment.includes("\0"),
    )
  ) {
    return null;
  }
  const objectName = parts.join("/");
  return {
    objectName,
    diskPath: path.join(storageRoot, bucketName, objectName),
  };
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${host}:${port}`);

    if (req.method === "HEAD" && url.pathname === `/storage/v1/bucket/${encodeURIComponent(bucketName)}`) {
      res.writeHead(200).end();
      return;
    }

    if (req.method === "POST" && url.pathname.startsWith("/storage/v1/object/")) {
      const target = decodeObjectPath(url.pathname.slice("/storage/v1/object/".length));
      if (!target) return sendJson(res, 404, { message: "not found" });
      const body = await readBody(req);
      await mkdir(path.dirname(target.diskPath), { recursive: true });
      await writeFile(target.diskPath, body);
      return sendJson(res, 201, { Key: target.objectName });
    }

    if (req.method === "HEAD" && url.pathname.startsWith("/storage/v1/object/info/")) {
      const target = decodeObjectPath(url.pathname.slice("/storage/v1/object/info/".length));
      if (!target) return sendJson(res, 404, { message: "not found" });
      try {
        await stat(target.diskPath);
        res.writeHead(200).end();
      } catch {
        res.writeHead(404).end();
      }
      return;
    }

    if (req.method === "GET" && url.pathname.startsWith("/storage/v1/object/")) {
      const target = decodeObjectPath(url.pathname.slice("/storage/v1/object/".length));
      if (!target) return sendJson(res, 404, { message: "not found" });
      try {
        const body = await readFile(target.diskPath);
        res.writeHead(200, { "content-type": "application/octet-stream" });
        res.end(body);
      } catch {
        sendJson(res, 404, { message: "not found" });
      }
      return;
    }

    if (req.method === "DELETE" && url.pathname.startsWith("/storage/v1/object/")) {
      const target = decodeObjectPath(url.pathname.slice("/storage/v1/object/".length));
      if (!target) return sendJson(res, 404, { message: "not found" });
      await rm(target.diskPath, { force: true });
      return sendJson(res, 200, { message: "deleted" });
    }

    sendJson(res, 404, { message: "not found" });
  } catch (error) {
    sendJson(res, 500, { message: error instanceof Error ? error.message : "storage error" });
  }
});

server.listen(port, host, () => {
  console.log(`Local dev storage listening at http://${host}:${port}`);
  console.log(`Bucket: ${bucketName}`);
  console.log(`Root: ${storageRoot}`);
});
