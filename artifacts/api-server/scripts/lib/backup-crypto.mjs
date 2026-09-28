/**
 * Client-side encryption for SlabPlan's independent private-file backups.
 *
 * Objects are encrypted before they leave the backup worker, so the backup
 * destination only ever stores ciphertext. The format is a segmented
 * AES-256-GCM stream in the style of Tink's AES-GCM-HKDF streaming AEAD:
 *
 *   header (64 bytes, authenticated as AAD of every segment)
 *     0..3   magic "SPFB"
 *     4      format version (1)
 *     5      algorithm (1 = AES-256-GCM, HKDF-SHA256 per-object key)
 *     6..7   reserved, zero
 *     8..11  plaintext bytes per segment, uint32 big-endian
 *     12..19 key id (fingerprint of the master key, not secret)
 *     20..51 random per-object HKDF salt
 *     52..58 random nonce prefix
 *     59..63 reserved, zero
 *   segments: ciphertext || 16-byte tag
 *
 * Every segment except the last carries exactly `segmentBytes` plaintext
 * bytes. The nonce is prefix || segment index || last-segment flag, so
 * reordering, truncation at a segment boundary, or appending segments fails
 * authentication. Memory use is bounded by roughly two segments per stream.
 *
 * This module uses only Node built-ins so the backup worker does not need
 * the application's dependency tree.
 */
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { Transform } from "node:stream";

export const BACKUP_MAGIC = Buffer.from("SPFB", "ascii");
export const BACKUP_FORMAT_VERSION = 1;
export const BACKUP_ALGORITHM_AES256GCM_HKDF = 1;
export const BACKUP_HEADER_BYTES = 64;
export const BACKUP_TAG_BYTES = 16;
export const DEFAULT_BACKUP_SEGMENT_BYTES = 4 * 1024 * 1024;
export const MIN_BACKUP_SEGMENT_BYTES = 16;
export const MAX_BACKUP_SEGMENT_BYTES = 64 * 1024 * 1024;
const MAX_SEGMENT_INDEX = 0xffffffff;
const KEY_ID_BYTES = 8;
const SALT_BYTES = 32;
const NONCE_PREFIX_BYTES = 7;
const OBJECT_KEY_INFO = Buffer.from("slabplan-file-backup/v1/object-key");
const NAME_KEY_INFO = Buffer.from("slabplan-file-backup/v1/blob-name-key");
const KEY_ID_LABEL = Buffer.from("slabplan-file-backup/v1/key-id\0");

export class BackupIntegrityError extends Error {
  constructor(message) {
    super(message);
    this.name = "BackupIntegrityError";
  }
}

/**
 * Parse the 32-byte master key from its 64-character hex form. Errors never
 * include the supplied value.
 */
export function parseBackupMasterKey(raw) {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!/^[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(
      "FILE_BACKUP_ENCRYPTION_KEY must be 64 hexadecimal characters (32 random bytes).",
    );
  }
  const key = Buffer.from(value, "hex");
  if (key.every((byte) => byte === 0)) {
    throw new Error("FILE_BACKUP_ENCRYPTION_KEY must not be all zero bytes.");
  }
  return key;
}

/** Non-secret fingerprint that identifies which master key encrypted a blob. */
export function backupKeyId(masterKey) {
  assertMasterKey(masterKey);
  return createHash("sha256")
    .update(KEY_ID_LABEL)
    .update(masterKey)
    .digest()
    .subarray(0, KEY_ID_BYTES);
}

export function backupKeyIdHex(masterKey) {
  return backupKeyId(masterKey).toString("hex");
}

/**
 * Deterministic, keyed destination name for one source object version. The
 * destination therefore never sees customer file names or organization IDs.
 */
export function backupBlobDigest(masterKey, objectName, versionTag) {
  assertMasterKey(masterKey);
  const nameKey = Buffer.from(
    hkdfSync("sha256", masterKey, Buffer.alloc(0), NAME_KEY_INFO, 32),
  );
  return createHmac("sha256", nameKey)
    .update("v1\n")
    .update(String(objectName))
    .update("\n")
    .update(String(versionTag))
    .digest("hex");
}

/** Exact ciphertext length for a plaintext length, used for verification. */
export function encryptedLengthFor(plainBytes, segmentBytes = DEFAULT_BACKUP_SEGMENT_BYTES) {
  assertSegmentBytes(segmentBytes);
  if (!Number.isSafeInteger(plainBytes) || plainBytes < 0) {
    throw new Error("Plaintext length must be a non-negative safe integer.");
  }
  const segments = plainBytes === 0 ? 1 : Math.ceil(plainBytes / segmentBytes);
  return BACKUP_HEADER_BYTES + plainBytes + segments * BACKUP_TAG_BYTES;
}

function assertMasterKey(masterKey) {
  if (!Buffer.isBuffer(masterKey) || masterKey.length !== 32) {
    throw new Error("Backup master key must be a 32-byte Buffer.");
  }
}

function assertSegmentBytes(segmentBytes) {
  if (
    !Number.isInteger(segmentBytes) ||
    segmentBytes < MIN_BACKUP_SEGMENT_BYTES ||
    segmentBytes > MAX_BACKUP_SEGMENT_BYTES
  ) {
    throw new Error(
      `Backup segment size must be an integer between ${MIN_BACKUP_SEGMENT_BYTES} and ${MAX_BACKUP_SEGMENT_BYTES} bytes.`,
    );
  }
}

function deriveObjectKey(masterKey, salt) {
  return Buffer.from(hkdfSync("sha256", masterKey, salt, OBJECT_KEY_INFO, 32));
}

function segmentNonce(noncePrefix, index, last) {
  if (index > MAX_SEGMENT_INDEX) {
    throw new BackupIntegrityError("Backup object has too many segments.");
  }
  const nonce = Buffer.alloc(12);
  noncePrefix.copy(nonce, 0);
  nonce.writeUInt32BE(index, NONCE_PREFIX_BYTES);
  nonce[11] = last ? 1 : 0;
  return nonce;
}

function buildHeader({ segmentBytes, keyId, salt, noncePrefix }) {
  const header = Buffer.alloc(BACKUP_HEADER_BYTES);
  BACKUP_MAGIC.copy(header, 0);
  header[4] = BACKUP_FORMAT_VERSION;
  header[5] = BACKUP_ALGORITHM_AES256GCM_HKDF;
  header.writeUInt32BE(segmentBytes, 8);
  keyId.copy(header, 12);
  salt.copy(header, 20);
  noncePrefix.copy(header, 52);
  return header;
}

/**
 * Parse and validate a header. The key id is compared before any
 * decryption so a wrong key fails with an actionable message.
 */
export function parseBackupHeader(header, masterKey) {
  if (!Buffer.isBuffer(header) || header.length < BACKUP_HEADER_BYTES) {
    throw new BackupIntegrityError("Backup object is truncated before its header ended.");
  }
  if (!header.subarray(0, 4).equals(BACKUP_MAGIC)) {
    throw new BackupIntegrityError("Object is not a SlabPlan encrypted backup.");
  }
  if (header[4] !== BACKUP_FORMAT_VERSION) {
    throw new BackupIntegrityError(`Unsupported backup format version ${header[4]}.`);
  }
  if (header[5] !== BACKUP_ALGORITHM_AES256GCM_HKDF) {
    throw new BackupIntegrityError(`Unsupported backup algorithm ${header[5]}.`);
  }
  if (header[6] !== 0 || header[7] !== 0 || !header.subarray(59, 64).every((b) => b === 0)) {
    throw new BackupIntegrityError("Backup header has non-zero reserved bytes.");
  }
  const segmentBytes = header.readUInt32BE(8);
  try {
    assertSegmentBytes(segmentBytes);
  } catch {
    throw new BackupIntegrityError("Backup header declares an invalid segment size.");
  }
  const keyId = Buffer.from(header.subarray(12, 20));
  const expectedKeyId = backupKeyId(masterKey);
  if (!timingSafeEqual(keyId, expectedKeyId)) {
    throw new BackupIntegrityError(
      `Backup object was encrypted with key id ${keyId.toString("hex")}, not the configured key id ${expectedKeyId.toString("hex")}.`,
    );
  }
  return {
    header: Buffer.from(header.subarray(0, BACKUP_HEADER_BYTES)),
    segmentBytes,
    keyId,
    salt: Buffer.from(header.subarray(20, 52)),
    noncePrefix: Buffer.from(header.subarray(52, 59)),
  };
}

class ByteQueue {
  constructor() {
    this.chunks = [];
    this.length = 0;
  }

  push(chunk) {
    if (chunk.length === 0) return;
    this.chunks.push(chunk);
    this.length += chunk.length;
  }

  take(count) {
    if (count > this.length) throw new Error("ByteQueue underflow");
    const out = Buffer.allocUnsafe(count);
    let offset = 0;
    while (offset < count) {
      const head = this.chunks[0];
      const needed = count - offset;
      if (head.length <= needed) {
        head.copy(out, offset);
        offset += head.length;
        this.chunks.shift();
      } else {
        head.copy(out, offset, 0, needed);
        this.chunks[0] = head.subarray(needed);
        offset += needed;
      }
    }
    this.length -= count;
    return out;
  }

  takeAll() {
    return this.take(this.length);
  }
}

/** Transform stream: plaintext in, SPFB ciphertext out. */
export function createBackupEncryptStream(
  masterKey,
  { segmentBytes = DEFAULT_BACKUP_SEGMENT_BYTES } = {},
) {
  assertMasterKey(masterKey);
  assertSegmentBytes(segmentBytes);
  const salt = randomBytes(SALT_BYTES);
  const noncePrefix = randomBytes(NONCE_PREFIX_BYTES);
  const header = buildHeader({
    segmentBytes,
    keyId: backupKeyId(masterKey),
    salt,
    noncePrefix,
  });
  const objectKey = deriveObjectKey(masterKey, salt);
  const pending = new ByteQueue();
  let headerSent = false;
  let index = 0;

  function seal(plaintext, last) {
    const cipher = createCipheriv("aes-256-gcm", objectKey, segmentNonce(noncePrefix, index, last), {
      authTagLength: BACKUP_TAG_BYTES,
    });
    cipher.setAAD(header);
    const body = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
    index += 1;
    return body;
  }

  return new Transform({
    transform(chunk, _encoding, callback) {
      try {
        if (!headerSent) {
          this.push(header);
          headerSent = true;
        }
        pending.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        // Hold back at least one byte so the final segment is always known.
        while (pending.length > segmentBytes) {
          this.push(seal(pending.take(segmentBytes), false));
        }
        callback();
      } catch (error) {
        callback(error);
      }
    },
    flush(callback) {
      try {
        if (!headerSent) {
          this.push(header);
          headerSent = true;
        }
        this.push(seal(pending.takeAll(), true));
        objectKey.fill(0);
        callback();
      } catch (error) {
        callback(error);
      }
    },
  });
}

/**
 * Transform stream: SPFB ciphertext in, verified plaintext out. A segment's
 * plaintext is only emitted after its tag verifies; callers must still treat
 * output as provisional until the stream ends without error.
 */
export function createBackupDecryptStream(masterKey) {
  assertMasterKey(masterKey);
  const pending = new ByteQueue();
  let parsed = null;
  let objectKey = null;
  let index = 0;

  function open(sealed, last) {
    const ciphertext = sealed.subarray(0, sealed.length - BACKUP_TAG_BYTES);
    const tag = sealed.subarray(sealed.length - BACKUP_TAG_BYTES);
    const decipher = createDecipheriv(
      "aes-256-gcm",
      objectKey,
      segmentNonce(parsed.noncePrefix, index, last),
      { authTagLength: BACKUP_TAG_BYTES },
    );
    decipher.setAAD(parsed.header);
    decipher.setAuthTag(tag);
    let plaintext;
    try {
      plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    } catch {
      throw new BackupIntegrityError(
        `Backup segment ${index} failed authentication (tampered, truncated, reordered or wrong key).`,
      );
    }
    index += 1;
    return plaintext;
  }

  return new Transform({
    transform(chunk, _encoding, callback) {
      try {
        pending.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        if (!parsed && pending.length >= BACKUP_HEADER_BYTES) {
          parsed = parseBackupHeader(pending.take(BACKUP_HEADER_BYTES), masterKey);
          objectKey = deriveObjectKey(masterKey, parsed.salt);
        }
        if (parsed) {
          const sealedBytes = parsed.segmentBytes + BACKUP_TAG_BYTES;
          while (pending.length > sealedBytes) {
            this.push(open(pending.take(sealedBytes), false));
          }
        }
        callback();
      } catch (error) {
        callback(error);
      }
    },
    flush(callback) {
      try {
        if (!parsed) {
          throw new BackupIntegrityError("Backup object is truncated before its header ended.");
        }
        if (pending.length < BACKUP_TAG_BYTES) {
          throw new BackupIntegrityError("Backup object is truncated inside its final segment.");
        }
        this.push(open(pending.takeAll(), true));
        objectKey.fill(0);
        callback();
      } catch (error) {
        callback(error);
      }
    },
  });
}

/**
 * Pass-through that records byte count and SHA-256 (and optionally MD5, which
 * Google Cloud Storage reports for uploaded objects) of the bytes that flow
 * through it.
 */
export function createDigestPassThrough({ md5 = false } = {}) {
  const sha256 = createHash("sha256");
  const md5Hash = md5 ? createHash("md5") : null;
  const result = { bytes: 0, sha256Hex: null, md5Base64: null };
  const stream = new Transform({
    transform(chunk, _encoding, callback) {
      sha256.update(chunk);
      md5Hash?.update(chunk);
      result.bytes += chunk.length;
      callback(null, chunk);
    },
    flush(callback) {
      result.sha256Hex = sha256.digest("hex");
      result.md5Base64 = md5Hash ? md5Hash.digest("base64") : null;
      callback();
    },
  });
  return { stream, result };
}
