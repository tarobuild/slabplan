import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { PassThrough, Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { after, before, describe, test } from "node:test";

const crypto = await import("../scripts/lib/backup-crypto.mjs");
const gcs = await import("../scripts/lib/gcs-backup-store.mjs");
const manifestLib = await import("../scripts/lib/file-backup-manifest.mjs");
const backup = await import("../scripts/file-backup.mjs");
const restore = await import("../scripts/file-backup-restore.mjs");

const KEY_HEX = "a1".repeat(32);
const OTHER_KEY_HEX = "b2".repeat(32);
const TOKEN = "test-access-token";

function sha256(buffer: Buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

async function collect(stream: NodeJS.ReadableStream) {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer));
  return Buffer.concat(chunks);
}

function chunked(buffer: Buffer, size: number) {
  const parts: Buffer[] = [];
  for (let i = 0; i < buffer.length; i += size) parts.push(buffer.subarray(i, i + size));
  return Readable.from(parts.length ? parts : [], { objectMode: false });
}

async function encrypt(plain: Buffer, key: Buffer, segmentBytes: number, pieceSize = 7) {
  return await collect(chunked(plain, pieceSize).pipe(crypto.createBackupEncryptStream(key, { segmentBytes })));
}

async function decrypt(cipher: Buffer, key: Buffer, pieceSize = 5) {
  const out = new PassThrough();
  const done = pipeline(chunked(cipher, pieceSize), crypto.createBackupDecryptStream(key), out);
  const [plain] = await Promise.all([collect(out), done]);
  return plain;
}

describe("backup encryption format", () => {
  const key = crypto.parseBackupMasterKey(KEY_HEX);

  test("round-trips boundary sizes with exact ciphertext lengths", async () => {
    for (const segmentBytes of [16, 64]) {
      for (const size of [0, 1, 15, 16, 17, 63, 64, 65, 128, 129, 1000]) {
        const plain = randomBytes(size);
        const cipher = await encrypt(plain, key, segmentBytes);
        assert.equal(cipher.length, crypto.encryptedLengthFor(size, segmentBytes), `length for ${size}/${segmentBytes}`);
        assert.ok(!cipher.includes(plain) || size < 8, "ciphertext must not contain plaintext");
        assert.deepEqual(await decrypt(cipher, key), plain, `round trip ${size}/${segmentBytes}`);
      }
    }
  });

  test("uses a fresh salt and nonce prefix for every object", async () => {
    const plain = Buffer.from("same content");
    const first = await encrypt(plain, key, 64);
    const second = await encrypt(plain, key, 64);
    assert.notDeepEqual(first, second);
    assert.deepEqual(first.subarray(12, 20), second.subarray(12, 20), "key id is stable");
  });

  test("rejects tampering, truncation, reordering, extension and wrong keys", async () => {
    const plain = randomBytes(16 * 5 + 3);
    const cipher = await encrypt(plain, key, 16);
    const sealed = 16 + crypto.BACKUP_TAG_BYTES;
    const header = crypto.BACKUP_HEADER_BYTES;

    const flipped = Buffer.from(cipher);
    flipped[header + 3] ^= 0x01;
    await assert.rejects(decrypt(flipped, key), /segment 0 failed authentication/);

    const headerSalt = Buffer.from(cipher);
    headerSalt[25] ^= 0x01;
    await assert.rejects(decrypt(headerSalt, key), /failed authentication/);

    await assert.rejects(decrypt(cipher.subarray(0, cipher.length - 1), key), /failed authentication/);
    // Drop the final segment: the previous non-final segment must not verify as final.
    await assert.rejects(decrypt(cipher.subarray(0, header + sealed * 5), key), /failed authentication/);
    await assert.rejects(decrypt(cipher.subarray(0, header + 4), key), /truncated inside its final segment/);
    await assert.rejects(decrypt(cipher.subarray(0, 20), key), /truncated before its header/);
    await assert.rejects(decrypt(Buffer.alloc(0), key), /truncated before its header/);

    const swapped = Buffer.concat([
      cipher.subarray(0, header),
      cipher.subarray(header + sealed, header + sealed * 2),
      cipher.subarray(header, header + sealed),
      cipher.subarray(header + sealed * 2),
    ]);
    await assert.rejects(decrypt(swapped, key), /failed authentication/);

    await assert.rejects(decrypt(Buffer.concat([cipher, randomBytes(40)]), key), /failed authentication/);

    const wrongKey = crypto.parseBackupMasterKey(OTHER_KEY_HEX);
    await assert.rejects(decrypt(cipher, wrongKey), /encrypted with key id [0-9a-f]{16}, not the configured key id/);

    const notBackup = Buffer.from(cipher);
    notBackup.write("NOPE", 0);
    await assert.rejects(decrypt(notBackup, key), /not a SlabPlan encrypted backup/);
  });

  test("parses master keys without echoing invalid input", () => {
    for (const bad of ["", "short", "zz".repeat(32), "0".repeat(64), `${KEY_HEX}00`]) {
      assert.throws(
        () => crypto.parseBackupMasterKey(bad),
        (error: Error) => !bad || !error.message.includes(bad),
      );
    }
    assert.equal(crypto.parseBackupMasterKey(` ${KEY_HEX}\n`).length, 32);
  });

  test("derives keyed blob digests that hide object names", () => {
    const name = "slabplan/uploads/organizations/org-a/job/documents/secret-name.pdf";
    const a = crypto.backupBlobDigest(key, name, "etag|10|t");
    assert.match(a, /^[0-9a-f]{64}$/);
    assert.equal(a, crypto.backupBlobDigest(key, name, "etag|10|t"));
    assert.notEqual(a, crypto.backupBlobDigest(key, name, "etag2|10|t"));
    assert.notEqual(a, crypto.backupBlobDigest(crypto.parseBackupMasterKey(OTHER_KEY_HEX), name, "etag|10|t"));
    assert.ok(!a.includes("secret"));
  });
});

type StoredObject = {
  name: string;
  data: Buffer;
  generation: string;
  md5Hash: string;
  timeCreated: string;
  metadata: Record<string, string>;
  contentType: string;
};

type Session = {
  name: string;
  contentType: string;
  metadata: Record<string, string>;
  ifGenerationMatch: string | null;
  chunks: Buffer[];
  received: number;
  finalized: StoredObject | null;
};

/** In-process fake of the GCS JSON API subset the backup client uses. */
class FakeGcs {
  objects = new Map<string, StoredObject>();
  sessions = new Map<string, Session>();
  server!: Server;
  origin = "";
  failNextChunkPuts = 0;
  truncateNextChunkAck = false;
  foreignSessionOrigin = false;
  generation = 1;
  pageSize = 3;
  uploadsStarted = 0;
  bucket = "slabplan-backup-test";

  async start() {
    this.server = createServer((req, res) => {
      this.handle(req).then(
        ({ status, headers = {}, body }) => {
          res.writeHead(status, headers);
          res.end(body);
        },
        (error) => {
          res.writeHead(500, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: { message: String(error) } }));
        },
      );
    });
    await new Promise<void>((resolve) => this.server.listen(0, "127.0.0.1", resolve));
    this.origin = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  async stop() {
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  private async body(req: IncomingMessage) {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
  }

  private json(status: number, value: unknown) {
    return { status, headers: { "content-type": "application/json" }, body: JSON.stringify(value) };
  }

  private resource(object: StoredObject) {
    return {
      name: object.name,
      size: String(object.data.length),
      generation: object.generation,
      md5Hash: object.md5Hash,
      timeCreated: object.timeCreated,
      metadata: object.metadata,
    };
  }

  private async handle(req: IncomingMessage): Promise<{ status: number; headers?: Record<string, string>; body?: string | Buffer }> {
    if (req.headers.authorization !== `Bearer ${TOKEN}`) return this.json(401, { error: { message: "unauthenticated" } });
    const url = new URL(req.url ?? "/", this.origin);
    const bucketPath = `/storage/v1/b/${this.bucket}/o`;
    const uploadPath = `/upload/storage/v1/b/${this.bucket}/o`;

    if (req.method === "GET" && url.pathname === bucketPath) {
      const prefix = url.searchParams.get("prefix") ?? "";
      const names = [...this.objects.keys()].filter((name) => name.startsWith(prefix)).sort();
      const start = Number(url.searchParams.get("pageToken") ?? 0);
      const page = names.slice(start, start + this.pageSize);
      const next = start + this.pageSize < names.length ? String(start + this.pageSize) : undefined;
      return this.json(200, { items: page.map((name) => this.resource(this.objects.get(name)!)), nextPageToken: next });
    }

    if (req.method === "POST" && url.pathname === uploadPath && url.searchParams.get("uploadType") === "resumable") {
      const meta = JSON.parse((await this.body(req)).toString("utf8"));
      const ifGenerationMatch = url.searchParams.get("ifGenerationMatch");
      if (ifGenerationMatch === "0" && this.objects.has(meta.name)) return this.json(412, { error: { message: "precondition failed" } });
      const id = randomBytes(8).toString("hex");
      this.uploadsStarted += 1;
      this.sessions.set(id, { name: meta.name, contentType: meta.contentType, metadata: meta.metadata ?? {}, ifGenerationMatch, chunks: [], received: 0, finalized: null });
      const origin = this.foreignSessionOrigin ? "http://127.0.0.2:1" : this.origin;
      return { status: 200, headers: { location: `${origin}${uploadPath}?uploadType=resumable&upload_id=${id}` } };
    }

    if (url.pathname === uploadPath && url.searchParams.get("upload_id")) {
      const session = this.sessions.get(url.searchParams.get("upload_id")!);
      if (!session) return this.json(404, { error: { message: "no session" } });
      if (req.method === "DELETE") {
        this.sessions.delete(url.searchParams.get("upload_id")!);
        return { status: 499 };
      }
      const range = String(req.headers["content-range"] ?? "");
      const data = await this.body(req);
      const rangeHeader = (): Record<string, string> => (session.received > 0 ? { range: `bytes=0-${session.received - 1}` } : {});
      if (range === "bytes */*") {
        if (session.finalized) return this.json(200, this.resource(session.finalized));
        return { status: 308, headers: rangeHeader() };
      }
      const match = /^bytes (\d+)-(\d+)\/(\*|\d+)$/.exec(range);
      if (!match) return this.json(400, { error: { message: "bad range" } });
      const [start, end] = [Number(match[1]), Number(match[2])];
      if (start !== session.received || end - start + 1 !== data.length) return this.json(400, { error: { message: "range mismatch" } });
      if (this.failNextChunkPuts > 0) {
        this.failNextChunkPuts -= 1;
        // Simulate a lost response after the service persisted the bytes.
        session.chunks.push(data);
        session.received += data.length;
        return this.json(503, { error: { message: "backend unavailable" } });
      }
      if (match[3] === "*") {
        if (data.length % (256 * 1024) !== 0) return this.json(400, { error: { message: "unaligned chunk" } });
        session.chunks.push(data);
        session.received += data.length;
        if (this.truncateNextChunkAck) {
          this.truncateNextChunkAck = false;
          return { status: 308, headers: { range: `bytes=0-${session.received - 2}` } };
        }
        return { status: 308, headers: rangeHeader() };
      }
      session.chunks.push(data);
      session.received += data.length;
      if (session.received !== Number(match[3])) return this.json(400, { error: { message: "size mismatch" } });
      if (session.ifGenerationMatch === "0" && this.objects.has(session.name)) return this.json(412, { error: { message: "precondition failed" } });
      const all = Buffer.concat(session.chunks);
      const object: StoredObject = {
        name: session.name,
        data: all,
        generation: String(this.generation++),
        md5Hash: createHash("md5").update(all).digest("base64"),
        timeCreated: new Date().toISOString(),
        metadata: session.metadata,
        contentType: session.contentType,
      };
      this.objects.set(session.name, object);
      session.finalized = object;
      return this.json(200, this.resource(object));
    }

    const objectPrefix = `${bucketPath}/`;
    if (url.pathname.startsWith(objectPrefix)) {
      const name = decodeURIComponent(url.pathname.slice(objectPrefix.length));
      const object = this.objects.get(name);
      if (!object) return this.json(404, { error: { message: "not found" } });
      if (req.method === "GET" && url.searchParams.get("alt") === "media") {
        return { status: 200, headers: { "content-type": "application/octet-stream" }, body: object.data };
      }
      if (req.method === "DELETE") {
        this.objects.delete(name);
        return { status: 204 };
      }
    }
    return this.json(404, { error: { message: `unhandled ${req.method} ${url.pathname}` } });
  }
}

type SourceObject = { data: Buffer; eTag: string; updated: string; mimetype: string; cacheControl?: string };

/** In-memory stand-in for scripts/lib/supabase-storage.mjs. */
class FakeSource {
  bucketName: string;
  objects = new Map<string, SourceObject>();
  lieAboutSize = new Set<string>();
  constructor(bucketName = "slabplan-files") {
    this.bucketName = bucketName;
  }
  put(name: string, data: Buffer, mimetype = "application/octet-stream") {
    this.objects.set(name, { data, eTag: `"${createHash("md5").update(data).digest("hex")}"`, updated: new Date().toISOString(), mimetype, cacheControl: "max-age=3600" });
  }
  async listAllObjects(prefix: string) {
    const normalized = prefix.replace(/\/+$/, "");
    return [...this.objects.entries()]
      .filter(([name]) => name.startsWith(`${normalized}/`))
      .map(([name, object]) => ({
        name,
        metadata: {
          eTag: object.eTag,
          size: this.lieAboutSize.has(name) ? object.data.length - 1 : object.data.length,
          mimetype: object.mimetype,
          cacheControl: object.cacheControl,
          lastModified: object.updated,
        },
        updated: object.updated,
        created: object.updated,
      }));
  }
  async downloadStream(name: string) {
    const object = this.objects.get(name);
    if (!object) throw new Error(`Supabase Storage request failed (400) for /object/${this.bucketName}/${name}`);
    return chunked(object.data, 100_000);
  }
  async getObjectInfo(name: string) {
    const object = this.objects.get(name);
    return object ? { objectName: name, sizeBytes: object.data.length, contentType: object.mimetype } : null;
  }
  async objectExists(name: string) {
    return this.objects.has(name);
  }
  async uploadStream(name: string, stream: NodeJS.ReadableStream, options: { upsert?: boolean; contentType?: string }) {
    if (options.upsert === false && this.objects.has(name)) throw new Error("exists");
    const data = await collect(stream);
    this.put(name, data, options.contentType);
  }
  async deleteObject(name: string) {
    this.objects.delete(name);
  }
}

const ORG_A = "0b6c1d3e-aaaa-4bbb-8ccc-000000000001";
const ORG_B = "0b6c1d3e-aaaa-4bbb-8ccc-000000000002";
const DUMP_DATE = "2026-09-28";

function seedSource() {
  const source = new FakeSource();
  const files: Record<string, Buffer> = {
    [`slabplan/uploads/organizations/${ORG_A}/job-1/documents/1-uuid-TEST-plan set.pdf`]: Buffer.concat([Buffer.from("PLAINTEXT-MARKER-ORG-A "), randomBytes(700 * 1024)]),
    [`slabplan/uploads/organizations/${ORG_A}/job-1/photos/2-uuid-TEST-été.jpg`]: Buffer.from("PLAINTEXT-MARKER-ORG-A photo"),
    [`slabplan/uploads/organizations/${ORG_A}/job-2/documents/3-uuid-empty.txt`]: Buffer.alloc(0),
    [`slabplan/uploads/organizations/${ORG_B}/job-9/documents/4-uuid-TEST-contract.pdf`]: Buffer.from("PLAINTEXT-MARKER-ORG-B contract"),
    [`slabplan/uploads/organizations/${ORG_B}/job-9/documents/5-uuid-TEST-notes.txt`]: Buffer.from("PLAINTEXT-MARKER-ORG-B notes"),
    ["slabplan/uploads/legacy-job/documents/6-uuid-TEST-legacy.txt"]: Buffer.from("PLAINTEXT-MARKER-LEGACY"),
    [`slabplan/uploads/organizations/${ORG_A}/job-1/documents/1-uuid-TEST-plan set.pdf.cadstone-native`]: Buffer.from("derived delivery copy"),
    [`backups/db/${DUMP_DATE}.sql.gz`]: Buffer.concat([Buffer.from("PLAINTEXT-MARKER-DB "), randomBytes(2048)]),
    ["backups/db/2026-09-27.sql.gz"]: Buffer.from("older dump"),
  };
  for (const [name, data] of Object.entries(files)) source.put(name, data);
  return { source, files };
}

function makeConfig(overrides: Record<string, string> = {}) {
  return backup.readBackupConfig(
    {
      FILE_BACKUP_ENCRYPTION_KEY: KEY_HEX,
      FILE_BACKUP_GCS_BUCKET: "slabplan-backup-test",
      FILE_BACKUP_DB_DUMP_DATE: DUMP_DATE,
      ...overrides,
    },
    new Date(`${DUMP_DATE}T10:30:00Z`),
  );
}

describe("independent private-file backup and restore", () => {
  const fake = new FakeGcs();
  let dest: ReturnType<typeof gcs.createGcsBackupStore>;
  const logs: string[] = [];
  const log = (line: string) => logs.push(line);
  const tempDirs: string[] = [];
  let seeded: ReturnType<typeof seedSource>;
  let clock = Date.parse(`${DUMP_DATE}T10:30:00Z`);
  const now = () => new Date((clock += 1000));

  before(async () => {
    await fake.start();
    dest = gcs.createGcsBackupStore({
      bucket: fake.bucket,
      getAccessToken: async () => TOKEN,
      apiOrigin: fake.origin,
      uploadChunkBytes: 256 * 1024,
      retryDelayMs: 1,
    });
    seeded = seedSource();
  });

  after(async () => {
    await fake.stop();
    for (const dir of tempDirs) await rm(dir, { recursive: true, force: true });
  });

  async function tempDir() {
    const dir = await mkdtemp(path.join(os.tmpdir(), "slabplan-file-backup-test-"));
    tempDirs.push(dir);
    return dir;
  }

  test("first run copies every in-scope object and today's database dump as ciphertext", async () => {
    const summary = await backup.runFileBackup({ source: seeded.source, dest, config: makeConfig(), now, log, segmentBytes: 64 * 1024 });
    assert.equal(summary.status, "complete", JSON.stringify(summary.failures));
    assert.equal(summary.counts.copied, 7);
    assert.equal(summary.counts.excluded, 1);
    assert.equal(summary.counts.carried, 0);
    assert.equal(summary.manifestEntries, 7);
    assert.equal(summary.organizations, 2);
    assert.equal(summary.dbDump.present, true);

    const stored = [...fake.objects.values()];
    for (const object of stored) {
      assert.ok(!object.data.includes(Buffer.from("PLAINTEXT-MARKER")), `${object.name} holds plaintext`);
      assert.ok(!object.name.includes(ORG_A) && !object.name.includes(ORG_B), "destination names must not reveal tenants");
      const relative = object.name.replace(/^slabplan-file-backup\/v1\//, "");
      assert.match(relative, /^(blobs\/[0-9a-f]{2}\/[0-9a-f]{64}|manifests\/\d{8}T\d{6}Z-[0-9a-f]{8}\.ndjson\.spfb|runs\/\d{8}T\d{6}Z-[0-9a-f]{8}\.json)$/, "destination names must not reveal file names");
    }
    const runSummary = stored.find((object) => object.name.includes("/runs/"))!;
    const text = runSummary.data.toString("utf8");
    assert.ok(!text.includes(ORG_A) && !text.includes("TEST-"), "plaintext run summary must hold counts only");
    assert.ok(!logs.join("\n").includes(ORG_A), "logs must not include tenant object names");
    // The repository is public: CI log lines carry status only, not volumes.
    for (const line of logs.filter((entry) => entry.startsWith("[backup]"))) {
      assert.match(line, /^\[backup\] (run=\S+ keyId=[0-9a-f]{16}|previous run \S+|run=\S+ status=\w+ failed=\d+ deferred=\d+ dbDump=[\w-]+|failure .+)$/, line);
    }
  });

  test("second run is incremental and carries unchanged versions forward", async () => {
    const uploadsBefore = fake.uploadsStarted;
    const summary = await backup.runFileBackup({ source: seeded.source, dest, config: makeConfig(), now, log, segmentBytes: 64 * 1024 });
    assert.equal(summary.status, "complete");
    assert.equal(summary.counts.copied, 0);
    assert.equal(summary.counts.carried, 7);
    assert.equal(fake.uploadsStarted - uploadsBefore, 2, "only manifest and run summary are written");
  });

  test("changed objects get a new immutable version; deleted objects leave the manifest", async () => {
    const changed = `slabplan/uploads/organizations/${ORG_B}/job-9/documents/5-uuid-TEST-notes.txt`;
    const removed = "slabplan/uploads/legacy-job/documents/6-uuid-TEST-legacy.txt";
    seeded.files[changed] = Buffer.from("PLAINTEXT-MARKER-ORG-B notes v2");
    seeded.source.put(changed, seeded.files[changed]);
    seeded.source.objects.delete(removed);
    delete seeded.files[removed];
    const summary = await backup.runFileBackup({ source: seeded.source, dest, config: makeConfig(), now, log, segmentBytes: 64 * 1024 });
    assert.equal(summary.status, "complete");
    assert.equal(summary.counts.copied, 1);
    assert.equal(summary.counts.carried, 5);
    assert.equal(summary.manifestEntries, 6);
  });

  test("verify authenticates and hash-checks every entry against the manifest and the source", async () => {
    const config = restore.readRestoreConfig({ FILE_BACKUP_ENCRYPTION_KEY: KEY_HEX, FILE_BACKUP_GCS_BUCKET: fake.bucket });
    const result = await restore.runCommand({
      command: "verify",
      options: { "compare-source": true },
      config,
      dest,
      log,
      createStorage: () => seeded.source,
    });
    assert.equal(result.checked, 6);
    assert.equal(result.matched, 6);
    assert.equal(result.failed, 0);
    assert.equal(result.sourceMatched, 6);
  });

  test("organization-scoped restore returns only that tenant's files, byte for byte", async () => {
    const config = restore.readRestoreConfig({ FILE_BACKUP_ENCRYPTION_KEY: KEY_HEX, FILE_BACKUP_GCS_BUCKET: fake.bucket });
    const outDir = await tempDir();
    const result = await restore.runCommand({ command: "restore", options: { organization: ORG_A, "to-dir": outDir }, config, dest, log });
    assert.equal(result.restored, 3);
    assert.equal(result.failed, 0);
    for (const [name, data] of Object.entries(seeded.files)) {
      const target = path.join(outDir, ...name.split("/"));
      if (name.includes(ORG_A) && !name.endsWith(".cadstone-native")) {
        const restored = await readFile(target);
        assert.equal(sha256(restored), sha256(data), name);
        assert.equal((await stat(target)).mode & 0o777, 0o600);
      } else {
        await assert.rejects(stat(target), /ENOENT/, `${name} must not be restored for another scope`);
      }
    }
    const again = await restore.runCommand({ command: "restore", options: { organization: ORG_A, "to-dir": outDir }, config, dest, log });
    assert.equal(again.skippedExisting, 3, "restores never overwrite");
    const leftovers = (await readdir(outDir, { recursive: true })).filter((name) => String(name).includes(".restore-"));
    assert.deepEqual(leftovers, []);
  });

  test("storage restore targets a separate bucket, never overwrites, and guards the primary", async () => {
    const config = restore.readRestoreConfig({ FILE_BACKUP_ENCRYPTION_KEY: KEY_HEX, FILE_BACKUP_GCS_BUCKET: fake.bucket });
    const target = new FakeSource("slabplan-restore-drill");
    const env = {
      SUPABASE_URL: "https://primary.example.supabase.co",
      SUPABASE_STORAGE_BUCKET: "slabplan-files",
      RESTORE_TARGET_SUPABASE_URL: "https://drill.example.supabase.co",
      RESTORE_TARGET_SUPABASE_STORAGE_BUCKET: "slabplan-restore-drill",
      RESTORE_TARGET_SUPABASE_SERVICE_ROLE_KEY: "drill-service-key",
    };
    const result = await restore.runCommand({ command: "restore", options: { organization: ORG_B, "to-supabase": true }, config, dest, env, log, createStorage: () => target });
    assert.equal(result.restored, 2);
    for (const [name, object] of target.objects) assert.equal(sha256(object.data), sha256(seeded.files[name]));
    const again = await restore.runCommand({ command: "restore", options: { organization: ORG_B, "to-supabase": true }, config, dest, env, log, createStorage: () => target });
    assert.equal(again.skippedExisting, 2);

    await assert.rejects(
      restore.runCommand({
        command: "restore",
        options: { all: true, "to-supabase": true },
        config,
        dest,
        env: { ...env, RESTORE_TARGET_SUPABASE_URL: "https://PRIMARY.example.supabase.co/", RESTORE_TARGET_SUPABASE_STORAGE_BUCKET: "slabplan-files" },
        log,
        createStorage: () => target,
      }),
      /primary bucket/,
    );
  });

  test("db-dump restores the day's database dump with hash verification", async () => {
    const config = restore.readRestoreConfig({ FILE_BACKUP_ENCRYPTION_KEY: KEY_HEX, FILE_BACKUP_GCS_BUCKET: fake.bucket });
    const dir = await tempDir();
    const to = path.join(dir, "restored.sql.gz");
    const result = await restore.runCommand({ command: "db-dump", options: { to }, config, dest, log });
    assert.equal(result.dbDumpDate, DUMP_DATE);
    assert.equal(sha256(await readFile(to)), sha256(seeded.files[`backups/db/${DUMP_DATE}.sql.gz`]));
    await assert.rejects(restore.runCommand({ command: "db-dump", options: { to }, config, dest, log }), /refusing to overwrite/);
    assert.deepEqual((await readdir(dir)).sort(), ["restored.sql.gz"]);
  });

  test("check-db-files binds restored file rows to backed-up objects and their tenant", async () => {
    const config = restore.readRestoreConfig({ FILE_BACKUP_ENCRYPTION_KEY: KEY_HEX, FILE_BACKUP_GCS_BUCKET: fake.bucket });
    const run = await manifestLib.resolveRun(dest, config.root, "latest");
    const csv = [
      `f1,${ORG_A},/uploads/organizations/${ORG_A}/job-1/photos/2-uuid-TEST-été.jpg,28`,
      `f2,${ORG_A},/uploads/organizations/${ORG_A}/job-2/documents/3-uuid-empty.txt,0`,
      `f3,${ORG_A},/uploads/organizations/${ORG_B}/job-9/documents/4-uuid-TEST-contract.pdf,31`,
      `f4,${ORG_B},/uploads/organizations/${ORG_B}/job-9/documents/missing.pdf,10`,
      `f5,${ORG_B},/uploads/../escape,10`,
      `f6,${ORG_B},/uploads/organizations/${ORG_B}/job-9/documents/5-uuid-TEST-notes.txt,`,
    ].join("\n");
    const rows = restore.parseFileRowsCsv(csv);
    assert.equal(rows[5].fileSize, null);
    const result = await restore.checkDatabaseFiles({ dest, root: config.root, masterKey: config.masterKey, run, rows, log });
    assert.equal(result.rowsChecked, 6);
    assert.equal(result.present, 4);
    assert.equal(result.missing, 1);
    assert.equal(result.organizationMismatch, 1, "a row may not claim another tenant's object");
    assert.equal(result.invalidUrl, 1);
    assert.equal(result.sizeDiffers, 0);
    assert.equal(result.failed, 3);
    assert.ok(!logs.join("\n").includes("contract"));
  });

  test("tampered blobs fail verification and are never written to a restore target", async () => {
    const config = restore.readRestoreConfig({ FILE_BACKUP_ENCRYPTION_KEY: KEY_HEX, FILE_BACKUP_GCS_BUCKET: fake.bucket });
    const run = await manifestLib.resolveRun(dest, config.root, "latest");
    const entries = await restore.selectEntries({ dest, root: config.root, masterKey: config.masterKey, run, organizationId: ORG_B });
    const victim = entries[0];
    const blob = fake.objects.get(manifestLib.backupPaths.blob(config.root, victim.blobDigest))!;
    const original = Buffer.from(blob.data);
    blob.data[blob.data.length - 20] ^= 0xff;
    try {
      const verified = await restore.verifyEntries({ dest, root: config.root, masterKey: config.masterKey, entries: [victim], log });
      assert.equal(verified.failed, 1);
      assert.ok(!verified.failures[0].reason.includes(ORG_B));
      const outDir = await tempDir();
      const restored = await restore.restoreToDirectory({ dest, root: config.root, masterKey: config.masterKey, entries: [victim], outDir, log });
      assert.equal(restored.failed, 1);
      const files = (await readdir(outDir, { recursive: true, withFileTypes: true })).filter((entry) => entry.isFile());
      assert.deepEqual(files, [], "no plaintext or partial file may remain");
    } finally {
      blob.data = original;
    }
  });

  test("a different key cannot read or silently extend existing backups", async () => {
    const config = restore.readRestoreConfig({ FILE_BACKUP_ENCRYPTION_KEY: OTHER_KEY_HEX, FILE_BACKUP_GCS_BUCKET: fake.bucket });
    await assert.rejects(restore.runCommand({ command: "verify", options: {}, config, dest, log }), /key id/);
    await assert.rejects(
      backup.runFileBackup({ source: seeded.source, dest, config: makeConfig({ FILE_BACKUP_ENCRYPTION_KEY: OTHER_KEY_HEX }), now, log }),
      /key id/,
    );
    assert.throws(() => makeConfig({ FILE_BACKUP_EXPECTED_KEY_ID: "0000000000000000" }), /Refusing to use an unexpected key/);
  });

  test("missing database dump, size cap and changing sources produce a partial run", async () => {
    const isolated = seedSource();
    const root = "slabplan-file-backup-drill/partial";
    isolated.source.objects.delete(`backups/db/${DUMP_DATE}.sql.gz`);
    const growing = `slabplan/uploads/organizations/${ORG_A}/job-1/photos/2-uuid-TEST-été.jpg`;
    isolated.source.lieAboutSize.add(growing);
    const summary = await backup.runFileBackup({
      source: isolated.source,
      dest,
      config: makeConfig({ FILE_BACKUP_DEST_ROOT: root, FILE_BACKUP_MAX_NEW_BYTES: String(300 * 1024) }),
      now,
      log,
      segmentBytes: 64 * 1024,
    });
    assert.equal(summary.status, "partial");
    assert.equal(summary.dbDump.present, false);
    assert.equal(summary.counts.deferred, 1, "the large file exceeds the per-run cap");
    assert.equal(summary.counts.failed, 1, "the object whose size changed");
    const labels = summary.failures.map((failure: { label: string }) => failure.label);
    assert.ok(labels.includes("db-dump") && labels.includes("new-bytes-cap"));
    const growingDigest = crypto.backupBlobDigest(makeConfig().masterKey, growing, backup.versionTagFor((await isolated.source.listAllObjects("slabplan/uploads")).find((o) => o.name === growing)));
    assert.equal(fake.objects.has(manifestLib.backupPaths.blob(root, growingDigest)), false, "an unverified upload must never be finalized");
    assert.ok(!JSON.stringify(summary).includes("TEST-"));
  });

  test("uploads resume after a lost chunk response and reject unsafe sessions", async () => {
    const data = randomBytes(700 * 1024);
    fake.failNextChunkPuts = 1;
    const stored = await dest.uploadBuffer("resilience/one", data);
    assert.equal(stored.size, data.length);
    assert.deepEqual(fake.objects.get("resilience/one")!.data, data);

    await assert.rejects(dest.uploadBuffer("resilience/one", data), /\(412\)/, "uploads are create-only");

    fake.truncateNextChunkAck = true;
    await assert.rejects(dest.uploadBuffer("resilience/two", data), /persisted through byte/);
    assert.equal(fake.objects.has("resilience/two"), false);

    fake.foreignSessionOrigin = true;
    try {
      await assert.rejects(dest.uploadBuffer("resilience/three", data), /unexpected origin/);
    } finally {
      fake.foreignSessionOrigin = false;
    }
  });

  test("prune only removes unreferenced blobs outside the retention window", async () => {
    const config = restore.readRestoreConfig({ FILE_BACKUP_ENCRYPTION_KEY: KEY_HEX, FILE_BACKUP_GCS_BUCKET: fake.bucket });
    const future = new Date(Date.now() + 200 * 24 * 60 * 60 * 1000);
    const dryRun = await restore.pruneBackups({ dest, root: config.root, masterKey: config.masterKey, keepDays: 90, keepRuns: 1, now: future, log });
    assert.equal(dryRun.applied, false);
    assert.equal(dryRun.retainedRuns, 1);
    assert.equal(dryRun.orphanedBlobs, 2, "old notes version and deleted legacy file");
    const before = fake.objects.size;
    const applied = await restore.pruneBackups({ dest, root: config.root, masterKey: config.masterKey, keepDays: 90, keepRuns: 1, now: future, apply: true, log });
    assert.equal(applied.deleted, 2 + (dryRun.expiredRuns * 2));
    assert.equal(fake.objects.size, before - applied.deleted);
    const verify = await restore.runCommand({ command: "verify", options: {}, config, dest, log });
    assert.equal(verify.failed, 0);
    assert.equal(verify.matched, 6);
  });

  test("restore paths cannot escape the target directory", () => {
    assert.throws(() => restore.safeRestorePath("/tmp/out", "../etc/passwd"), /unsafe/);
    assert.throws(() => restore.safeRestorePath("/tmp/out", "a//b"), /unsafe/);
    assert.throws(() => restore.safeRestorePath("/tmp/out", "/abs"), /unsafe/);
    assert.throws(() => restore.safeRestorePath("/tmp/out", "a\\..\\b"), /unsafe/);
    assert.equal(restore.safeRestorePath("/tmp/out", "a/b.txt"), path.resolve("/tmp/out/a/b.txt"));
  });
});

describe("backup tooling configuration", () => {
  test("gcloud token provider caches tokens and never exposes command output in errors", async () => {
    let calls = 0;
    const provider = gcs.createGcloudTokenProvider({
      execFileImpl: ((_file: string, args: string[], _options: unknown, callback: (error: Error | null, stdout: string) => void) => {
        calls += 1;
        assert.deepEqual(args.slice(0, 2), ["auth", "print-access-token"]);
        callback(null, "ya29.token-value\n");
      }) as never,
    });
    assert.equal(await provider(), "ya29.token-value");
    assert.equal(await provider(), "ya29.token-value");
    assert.equal(calls, 1);
    await provider({ forceRefresh: true });
    assert.equal(calls, 2);

    const failing = gcs.createGcloudTokenProvider({
      execFileImpl: ((_f: string, _a: string[], _o: unknown, callback: (error: Error | null, stdout: string) => void) =>
        callback(new Error("secret-stderr-content"), "")) as never,
    });
    await assert.rejects(failing(), (error: Error) => !error.message.includes("secret-stderr-content"));
    assert.throws(() => gcs.createGcloudTokenProvider({ impersonateServiceAccount: "not-an-email" }), /service account/);
  });

  test("configuration fails loudly and validates prefixes and roots", () => {
    assert.throws(() => backup.readBackupConfig({ FILE_BACKUP_GCS_BUCKET: "b" }), /FILE_BACKUP_ENCRYPTION_KEY is not set/);
    assert.throws(() => backup.readBackupConfig({ FILE_BACKUP_ENCRYPTION_KEY: KEY_HEX }), /FILE_BACKUP_GCS_BUCKET is not set/);
    assert.throws(() => backup.parseSourcePrefixes("../escape"), /unsafe/);
    assert.deepEqual(backup.parseSourcePrefixes(""), ["slabplan/uploads/"]);
    assert.deepEqual(backup.parseSourcePrefixes("slabplan/backup-drill/run-1"), ["slabplan/backup-drill/run-1/"]);
    assert.throws(() => manifestLib.normalizeBackupRoot("a/../b"), /safe segments/);
    assert.throws(() => gcs.createGcsBackupStore({ bucket: "Bad_Bucket!", getAccessToken: async () => TOKEN }), /bucket name/);
    assert.throws(() => gcs.createGcsBackupStore({ bucket: "okay-bucket", getAccessToken: async () => TOKEN, uploadChunkBytes: 1000 }), /256 KiB/);
    const config = makeConfig({ FILE_BACKUP_EXPECTED_KEY_ID: crypto.backupKeyIdHex(crypto.parseBackupMasterKey(KEY_HEX)) });
    assert.equal(config.requireDbDump, true);
    assert.equal(config.maxNewBytes, 100 * 1024 ** 3);
  });

  test("script storage streams downloads without buffering the object", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(Readable.toWeb(Readable.from([Buffer.from("abc"), Buffer.from("def")])) as ReadableStream, { status: 200 })) as typeof fetch;
    try {
      const { createSupabaseStorage } = await import("../scripts/lib/supabase-storage.mjs");
      const storage = createSupabaseStorage({ SUPABASE_URL: "https://example.supabase.co", SUPABASE_STORAGE_BUCKET: "b", SUPABASE_SERVICE_ROLE_KEY: "k" });
      assert.equal((await collect(await storage.downloadStream("x/y"))).toString(), "abcdef");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
