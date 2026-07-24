const IDEMPOTENCY_BODY_BASE64_PREFIX = "__cadstone_idempotency_base64_v1__:";

export function responseChunkEncoding(args: unknown[]): BufferEncoding | undefined {
  const candidate = args[0];
  return typeof candidate === "string" && Buffer.isEncoding(candidate)
    ? (candidate as BufferEncoding)
    : undefined;
}

export function responseChunkToBuffer(
  chunk: unknown,
  encoding?: BufferEncoding,
): Buffer | null {
  if (chunk === undefined || chunk === null) return null;
  if (Buffer.isBuffer(chunk)) return Buffer.from(chunk);
  if (typeof chunk === "string") return Buffer.from(chunk, encoding);
  if (ArrayBuffer.isView(chunk)) {
    return Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
  }
  if (chunk instanceof ArrayBuffer) return Buffer.from(chunk);
  return Buffer.from(String(chunk));
}

export function encodeIdempotencyResponseBody(chunks: readonly Buffer[]): string {
  return `${IDEMPOTENCY_BODY_BASE64_PREFIX}${Buffer.concat(chunks).toString("base64")}`;
}

export function decodeIdempotencyResponseBody(body: string): string | Buffer {
  if (!body.startsWith(IDEMPOTENCY_BODY_BASE64_PREFIX)) return body;
  return Buffer.from(body.slice(IDEMPOTENCY_BODY_BASE64_PREFIX.length), "base64");
}
