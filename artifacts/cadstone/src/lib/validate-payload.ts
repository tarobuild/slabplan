import { z } from "zod"
import { toast } from "sonner"

/**
 * Validate a request payload with a generated Zod schema before issuing a
 * mutation. Returns the original payload on success (so callers preserve
 * exactly the wire shape they constructed) and `null` when validation fails.
 * On failure a toast is surfaced with the first issue so the caller can
 * simply early-return without writing per-field error handling.
 *
 * The original (un-parsed) value is returned on purpose: a few generated
 * schemas use `z.coerce.date()` for date strings, which would otherwise
 * convert ISO date strings into `Date` objects and change how `JSON.stringify`
 * serializes them.
 */
export function validatePayload<TPayload>(
  schema: z.ZodTypeAny,
  value: TPayload,
  fallbackMessage = "Please correct the highlighted fields and try again.",
): TPayload | null {
  const parsed = schema.safeParse(value)
  if (parsed.success) return value
  const firstIssue = parsed.error.issues[0]
  const fieldPath = firstIssue?.path.join(".") || ""
  const message = firstIssue?.message || fallbackMessage
  toast.error(fieldPath ? `${fieldPath}: ${message}` : message)
  return null
}
