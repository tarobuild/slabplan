import {
  agentMessageStoppedReasons,
  type AgentMessageStoppedReason,
} from "@workspace/db/schema";
import { logger } from "../logger";

const ALLOWED: ReadonlySet<string> = new Set<string>(agentMessageStoppedReasons);

/**
 * Normalize a stop_reason value to the DB-allowed set.
 *
 * Background: `agent_messages.stopped_reason` has a CHECK constraint (Task
 * #290) that only accepts values in `agentMessageStoppedReasons`. The
 * orchestrator forwards Anthropic SDK `response.stop_reason` values verbatim,
 * so any new value the SDK introduces (or any model adapter that returns an
 * unfamiliar code) would otherwise hit the DB and trip the constraint,
 * failing the entire assistant turn at insert time.
 *
 * This helper coerces unknown values to the `"api_error"` sentinel and emits
 * a structured warn so we notice and extend the allow-list. `null` /
 * `undefined` pass through unchanged because the column is nullable and a
 * missing reason is a legitimate "still in progress / nothing to record"
 * signal.
 */
export function normalizeStoppedReason(
  value: string | null | undefined,
): AgentMessageStoppedReason | undefined {
  if (value === null || value === undefined) return undefined;
  if (ALLOWED.has(value)) return value as AgentMessageStoppedReason;
  logger.warn(
    { stoppedReason: value, allowed: agentMessageStoppedReasons },
    "Agent: unknown stop_reason from model adapter; coerced to api_error",
  );
  return "api_error";
}
