import test from "node:test";
import assert from "node:assert/strict";

import {
  decodeIdempotencyResponseBody,
  encodeIdempotencyResponseBody,
  responseChunkToBuffer,
} from "../src/middleware/response-chunks.ts";

test("idempotency response capture preserves Uint8Array view bytes", () => {
  const backing = Uint8Array.from([1, 2, 3, 4, 5, 6]).buffer;
  const view = new Uint8Array(backing, 2, 3);

  assert.deepEqual([...responseChunkToBuffer(view)!], [3, 4, 5]);
});

test("idempotency response capture preserves DataView byte offsets", () => {
  const backing = Uint8Array.from([10, 20, 30, 40]).buffer;
  const view = new DataView(backing, 1, 2);

  assert.deepEqual([...responseChunkToBuffer(view)!], [20, 30]);
});

test("idempotency response capture honors string write encodings", () => {
  assert.deepEqual([...responseChunkToBuffer("é", "latin1")!], [0xe9]);
});

test("idempotency response capture skips absent chunks", () => {
  assert.equal(responseChunkToBuffer(undefined), null);
  assert.equal(responseChunkToBuffer(null), null);
});

test("idempotency response cache round-trips arbitrary bytes through text storage", () => {
  const encoded = encodeIdempotencyResponseBody([
    Buffer.from([0, 255]),
    Buffer.from([128, 65]),
  ]);

  const decoded = decodeIdempotencyResponseBody(encoded);
  assert.ok(Buffer.isBuffer(decoded));
  assert.deepEqual([...decoded], [0, 255, 128, 65]);
});

test("idempotency response cache keeps legacy plain text rows replayable", () => {
  assert.equal(decodeIdempotencyResponseBody('{"ok":true}'), '{"ok":true}');
});
