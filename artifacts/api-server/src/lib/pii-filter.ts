// Defensive PII scrubber for Sentry events.
//
// Sentry events naturally include extras (request body fragments, error
// messages, breadcrumbs). Stone Track handles construction client data, so we
// must NEVER let an email, phone number, or street address land in the
// Sentry project even if a developer mistakenly attaches the wrong
// `extra` field. The filter walks the entire event payload as a JSON
// string, scans for known PII patterns, and DROPS the whole event if
// any are present (returning `null` from Sentry's `beforeSend` hook
// suppresses the event).
//
// We err on the side of dropping events instead of redacting because:
//  1. A redaction failure would silently leak; a drop is observable
//     (the missing event prompts a developer to add the missing field
//     to the captured `extra` rather than smuggle PII into Sentry).
//  2. The PII patterns below are deliberately conservative — false
//     positives are acceptable noise for an error-monitoring backstop.
//
// Patterns covered:
//   - email: RFC-ish `local@domain.tld`
//   - phone: NANP / E.164 — 10+ digits with optional separators
//   - US street address: `123 Main St`, `4567 Oak Avenue`, etc.

const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

// Phone: 10–15 digits, allowing common separators (space, dash, dot,
// parentheses, leading + or country code).  We require at least one
// non-digit separator OR a leading "+" to reduce false positives on
// arbitrary numeric ids that happen to be 10+ chars long.
const PHONE_PATTERN =
  /(?:\+\d{1,3}[\s.\-]?)?\(?\d{3}\)?[\s.\-]\d{3}[\s.\-]\d{4}\b|\+\d{10,15}\b/;

// US street address — number + street word + suffix.
const STREET_PATTERN =
  /\b\d{1,6}\s+[A-Za-z][A-Za-z0-9\s.'-]{0,60}\s+(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard|Ln|Lane|Dr|Drive|Ct|Court|Way|Pkwy|Parkway|Hwy|Highway|Pl|Place|Ter|Terrace)\b/i;

export const PII_PATTERNS = [
  { name: "email", regex: EMAIL_PATTERN },
  { name: "phone", regex: PHONE_PATTERN },
  { name: "street_address", regex: STREET_PATTERN },
] as const;

export type PiiMatch = { name: string; sample: string };

/**
 * Returns the first PII match found in `text`, or null if none.
 * Exported for unit testing — production code should use
 * {@link containsPii}.
 */
export function findPii(text: string): PiiMatch | null {
  for (const { name, regex } of PII_PATTERNS) {
    const match = regex.exec(text);
    if (match) {
      return { name, sample: match[0] };
    }
  }
  return null;
}

export function containsPii(text: string): boolean {
  return findPii(text) !== null;
}

/**
 * Walk an arbitrary value and check meaningful string fields for PII.
 *
 * Sentry events contain a lot of operational identifiers (event ids,
 * trace ids, release hashes, request tokens). Scanning the whole event
 * as one serialized blob creates false positives because UUID-like
 * values can look phone-ish. We still scan developer-controlled
 * message, breadcrumb, extra, context, and stack-frame values, but we
 * skip known identifier/secret metadata and strip URL query strings.
 */
export function valueContainsPii(value: unknown): boolean {
  const seen = new WeakSet<object>();

  function isIdentifierKey(key: string): boolean {
    return /(^|_)(id|uuid|hash)$/i.test(key);
  }

  function isSensitiveKey(key: string): boolean {
    return /(^|_)(token|secret|key|api[_-]?key|dsn|password|credential|authorization)$/i.test(key);
  }

  function urlContainsPii(text: string): boolean {
    try {
      const url = new URL(text);
      for (const [name, rawValue] of url.searchParams.entries()) {
        if (isSensitiveKey(name)) continue;
        if (containsPii(name) || containsPii(rawValue)) return true;
      }
      return containsPii(`${url.origin}${url.pathname}`);
    } catch {
      return containsPii(text);
    }
  }

  function visit(val: unknown, key = ""): boolean {
    if (val === null || val === undefined) return false;
    if (typeof val === "string") {
      if (isSensitiveKey(key)) return true;
      if (isIdentifierKey(key)) return false;
      if (/url$/i.test(key)) return urlContainsPii(val);
      return containsPii(val);
    }
    if (typeof val !== "object") return false;
    if (seen.has(val as object)) return false;
    seen.add(val as object);

    if (val instanceof Error) {
      return containsPii(val.message);
    }

    if (Array.isArray(val)) return val.some((item) => visit(item, key));

    for (const [childKey, childValue] of Object.entries(
      val as Record<string, unknown>,
    )) {
      if (isSensitiveKey(childKey) && childValue !== null && childValue !== undefined) return true;
      if (isIdentifierKey(childKey)) continue;
      if (visit(childValue, childKey)) return true;
    }
    return false;
  }

  try {
    return visit(value);
  } catch {
    // If we can't inspect the event, refuse to send — better safe
    // than sorry.
    return true;
  }
}
