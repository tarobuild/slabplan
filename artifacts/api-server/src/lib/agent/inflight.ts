/**
 * Per-user in-flight cap for the in-app AI assistant.
 *
 * One assistant turn fans out into one or more Anthropic streams plus several
 * MCP tool calls — and each turn is metered against the user's monthly token
 * cap. Letting a single user spam Send (or scripting the endpoint) creates N
 * concurrent fan-outs, multiplies the cost per minute, and produces output
 * the user will never read.
 *
 * This module gates concurrency on the route layer: every accepted assistant
 * turn must hold a slot for its lifetime; overflow returns a clean 429 with
 * a friendly message so the UI can disable the Send button instead of
 * silently piling up requests.
 *
 * In-memory only: production runs as a single Reserved VM (see `replit.md` →
 * "Deployment target — Reserved VM, not autoscale"), same constraint as the
 * rate-limit buckets in `../rate-limit.ts`. If the deployment is ever moved
 * to autoscale the source of truth must move to a shared store (Postgres or
 * Redis) — otherwise each instance enforces its own counters and the
 * effective cap becomes `instances × MAX_INFLIGHT`.
 */

const DEFAULT_MAX_INFLIGHT = 1;

export function maxInFlightPerUser(): number {
  const raw = process.env.AGENT_MAX_INFLIGHT;
  if (!raw) return DEFAULT_MAX_INFLIGHT;
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n) || n <= 0) return DEFAULT_MAX_INFLIGHT;
  return n;
}

const inFlight = new Map<string, number>();

/**
 * Atomically attempt to take a slot for `userId`. Returns true if a slot was
 * acquired (caller is responsible for `releaseSlot`); false if the user is
 * already at the cap and the caller must reject the request.
 */
export function tryAcquireSlot(userId: string): boolean {
  const cap = maxInFlightPerUser();
  const current = inFlight.get(userId) ?? 0;
  if (current >= cap) return false;
  inFlight.set(userId, current + 1);
  return true;
}

/**
 * Release a previously acquired slot. Idempotent and safe to call inside a
 * `finally` block — a missing or zero counter is treated as already-released
 * rather than throwing, so a double-release from clean-up paths cannot
 * corrupt the bookkeeping.
 */
export function releaseSlot(userId: string): void {
  const current = inFlight.get(userId) ?? 0;
  if (current <= 1) {
    inFlight.delete(userId);
    return;
  }
  inFlight.set(userId, current - 1);
}

/** Test/diagnostic helper. */
export function getInFlightCount(userId: string): number {
  return inFlight.get(userId) ?? 0;
}

/** Test helper: clear all slots. Not for production use. */
export function _resetInFlightForTests(): void {
  inFlight.clear();
}
