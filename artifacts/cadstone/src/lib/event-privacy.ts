const PII_PATTERNS = [
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/,
  /(?:\+\d{1,3}[\s.\-]?)?\(?\d{3}\)?[\s.\-]\d{3}[\s.\-]\d{4}\b|\+\d{10,15}\b/,
  /\b\d{1,6}\s+[A-Za-z][A-Za-z0-9\s.'-]{0,60}\s+(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard|Ln|Lane|Dr|Drive|Ct|Court|Way|Pkwy|Parkway|Hwy|Highway|Pl|Place|Ter|Terrace)\b/i,
];

export function eventContainsPii(event: unknown): boolean {
  const seen = new WeakSet<object>();

  function isIdentifierKey(key: string): boolean {
    return /(^|_)(id|uuid|hash)$/i.test(key);
  }

  function isSensitiveKey(key: string): boolean {
    return /(token|secret|password|credential|authorization|recovery.?codes|api.?key|^key$|^dsn$)/i.test(
      key,
    );
  }

  function urlContainsPii(text: string): boolean {
    try {
      const url = new URL(text, "https://privacy.invalid");
      for (const [name, rawValue] of [
        ...url.searchParams,
        ...new URLSearchParams(url.hash.slice(1)),
      ]) {
        if (isSensitiveKey(name)) return true;
        if (PII_PATTERNS.some((re) => re.test(name) || re.test(rawValue)))
          return true;
      }
      return PII_PATTERNS.some((re) =>
        re.test(`${url.origin}${url.pathname}${url.hash}`),
      );
    } catch {
      return PII_PATTERNS.some((re) => re.test(text));
    }
  }

  function visit(value: unknown, key = ""): boolean {
    if (value === null || value === undefined) return false;
    if (typeof value === "string") {
      if (isSensitiveKey(key)) return true;
      if (isIdentifierKey(key)) return false;
      if (/url$|^(from|to)$/i.test(key) || /^https?:\/\//i.test(value))
        return urlContainsPii(value);
      return PII_PATTERNS.some((re) => re.test(value));
    }
    if (typeof value !== "object") return false;
    if (seen.has(value as object)) return false;
    seen.add(value as object);

    if (value instanceof Error) {
      return PII_PATTERNS.some((re) => re.test(value.message));
    }

    if (Array.isArray(value)) return value.some((item) => visit(item, key));

    for (const [childKey, childValue] of Object.entries(
      value as Record<string, unknown>,
    )) {
      if (
        isSensitiveKey(childKey) &&
        childValue !== null &&
        childValue !== undefined
      )
        return true;
      if (isIdentifierKey(childKey)) continue;
      if (visit(childValue, childKey)) return true;
    }
    return false;
  }

  try {
    return visit(event);
  } catch {
    return true;
  }
}
