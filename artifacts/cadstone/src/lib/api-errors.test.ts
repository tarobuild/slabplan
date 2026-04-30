import assert from "node:assert/strict"
import { afterEach, describe, test } from "node:test"
import { AxiosError, AxiosHeaders } from "axios"
import { toast } from "sonner"

import { apiErrorDetailCode, classifyApiError, toastApiError } from "./api-errors.ts"

function buildAxiosError(options: {
  status?: number
  data?: unknown
  code?: string
  message?: string
}): AxiosError {
  const headers = new AxiosHeaders()
  const config = { headers, url: "/test" } as never
  const response =
    options.status === undefined && options.data === undefined
      ? undefined
      : {
          status: options.status ?? 200,
          statusText: "",
          data: options.data,
          headers,
          config,
        }
  return new AxiosError(
    options.message ?? "boom",
    options.code,
    config,
    undefined,
    response as never,
  )
}

describe("classifyApiError", () => {
  test("returns the session-expired marker for 401 responses (no toast)", () => {
    // The global axios interceptor handles 401s: it tries a token refresh
    // and, on failure, surfaces a single debounced "session expired" toast.
    // The classifier must therefore stay silent so we don't double-toast.
    const result = classifyApiError(
      buildAxiosError({ status: 401, data: { message: "unauthorized" } }),
      "fallback",
    )
    assert.deepEqual(result, { kind: "session-expired" })
  })

  test("returns the forbidden marker for 403 responses (no toast)", () => {
    const result = classifyApiError(
      buildAxiosError({ status: 403, data: { message: "nope" } }),
      "fallback",
    )
    assert.deepEqual(result, { kind: "forbidden" })
  })

  test("returns the generic server-error toast for 5xx without a server message", () => {
    const result = classifyApiError(
      buildAxiosError({ status: 503 }),
      "fallback",
    )
    assert.deepEqual(result, {
      kind: "toast",
      message: "Server error — please try again in a moment.",
    })
  })

  test("returns the network-error toast when axios reports ERR_NETWORK", () => {
    const result = classifyApiError(
      buildAxiosError({ code: "ERR_NETWORK", message: "Network Error" }),
      "fallback",
    )
    assert.deepEqual(result, {
      kind: "toast",
      message:
        "Couldn't reach the server. Check your connection and try again.",
    })
  })

  test("returns the network-error toast when the message is 'Network Error' even without ERR_NETWORK", () => {
    const result = classifyApiError(
      buildAxiosError({ message: "Network Error" }),
      "fallback",
    )
    assert.deepEqual(result, {
      kind: "toast",
      message:
        "Couldn't reach the server. Check your connection and try again.",
    })
  })

  test("prefers a non-empty server message over fallbacks for 4xx responses", () => {
    const result = classifyApiError(
      buildAxiosError({ status: 422, data: { message: "Email already taken" } }),
      "fallback",
    )
    assert.deepEqual(result, {
      kind: "toast",
      message: "Email already taken",
    })
  })

  test("prefers a non-empty server message over the generic 5xx toast", () => {
    const result = classifyApiError(
      buildAxiosError({ status: 500, data: { message: "DB exploded" } }),
      "fallback",
    )
    assert.deepEqual(result, {
      kind: "toast",
      message: "DB exploded",
    })
  })

  test("ignores blank server messages and falls through to the next branch", () => {
    const result = classifyApiError(
      buildAxiosError({ status: 500, data: { message: "   " } }),
      "fallback",
    )
    assert.deepEqual(result, {
      kind: "toast",
      message: "Server error — please try again in a moment.",
    })
  })

  test("ignores non-string server messages", () => {
    const result = classifyApiError(
      buildAxiosError({ status: 500, data: { message: 42 } }),
      "fallback",
    )
    assert.deepEqual(result, {
      kind: "toast",
      message: "Server error — please try again in a moment.",
    })
  })

  test("uses the axios error's own message when no other branch matches", () => {
    const result = classifyApiError(
      buildAxiosError({ status: 418, message: "I'm a teapot" }),
      "fallback",
    )
    assert.deepEqual(result, { kind: "toast", message: "I'm a teapot" })
  })

  test("falls back when an axios error has no message and no other details", () => {
    const result = classifyApiError(
      buildAxiosError({ status: 418, message: "" }),
      "fallback",
    )
    assert.deepEqual(result, { kind: "toast", message: "fallback" })
  })

  test("uses the message of a non-axios Error", () => {
    const result = classifyApiError(new Error("local boom"), "fallback")
    assert.deepEqual(result, { kind: "toast", message: "local boom" })
  })

  test("falls back when a plain Error has an empty message", () => {
    const result = classifyApiError(new Error(""), "fallback")
    assert.deepEqual(result, { kind: "toast", message: "fallback" })
  })

  test("falls back for non-Error rejection values", () => {
    assert.deepEqual(classifyApiError(null, "fallback"), {
      kind: "toast",
      message: "fallback",
    })
    assert.deepEqual(classifyApiError("oops", "fallback"), {
      kind: "toast",
      message: "fallback",
    })
    assert.deepEqual(classifyApiError(undefined, "fallback"), {
      kind: "toast",
      message: "fallback",
    })
  })
})

describe("toastApiError", () => {
  const originalErrorToast = toast.error
  let calls: Array<unknown[]>

  function installSpy() {
    calls = []
    ;(toast as unknown as { error: (...args: unknown[]) => void }).error = (
      ...args: unknown[]
    ) => {
      calls.push(args)
    }
  }

  afterEach(() => {
    ;(toast as unknown as { error: typeof originalErrorToast }).error =
      originalErrorToast
  })

  test("forwards the classified message to sonner.toast.error", () => {
    installSpy()
    toastApiError(
      buildAxiosError({ status: 422, data: { message: "Email already taken" } }),
      "fallback",
    )
    assert.equal(calls.length, 1)
    assert.deepEqual(calls[0], ["Email already taken"])
  })

  test("uses the fallback message when no classification details are available", () => {
    installSpy()
    toastApiError("not an error", "Could not load thing")
    assert.equal(calls.length, 1)
    assert.deepEqual(calls[0], ["Could not load thing"])
  })

  test("stays silent on 403 responses", () => {
    installSpy()
    toastApiError(
      buildAxiosError({ status: 403, data: { message: "nope" } }),
      "fallback",
    )
    assert.equal(calls.length, 0)
  })

  test("stays silent on 401 responses (interceptor toasts session-expired)", () => {
    installSpy()
    toastApiError(
      buildAxiosError({ status: 401, data: { message: "unauthorized" } }),
      "fallback",
    )
    assert.equal(calls.length, 0)
  })
})

describe("apiErrorDetailCode", () => {
  test("returns the multer code from a problem+json errors payload", () => {
    // The upload middleware in artifacts/api-server/src/lib/uploads.ts wraps
    // multer errors into HttpError with details = { limit, code, field }
    // and the problem+json renderer surfaces those as the `errors` field.
    // Comment-attachment toasts use this to swap the raw server detail for
    // a friendly, copy-locked message.
    const code = apiErrorDetailCode(
      buildAxiosError({
        status: 413,
        data: {
          message: "File exceeds the 10 MB upload size limit.",
          errors: { limit: 10485760, code: "LIMIT_FILE_SIZE", field: "files" },
        },
      }),
    )
    assert.equal(code, "LIMIT_FILE_SIZE")
  })

  test("returns null when the response has no errors object", () => {
    const code = apiErrorDetailCode(
      buildAxiosError({ status: 422, data: { message: "Bad input" } }),
    )
    assert.equal(code, null)
  })

  test("returns null when errors.code is not a string", () => {
    const code = apiErrorDetailCode(
      buildAxiosError({
        status: 413,
        data: { message: "boom", errors: { code: 42 } },
      }),
    )
    assert.equal(code, null)
  })

  test("returns null for non-axios errors", () => {
    assert.equal(apiErrorDetailCode(new Error("local")), null)
    assert.equal(apiErrorDetailCode(null), null)
    assert.equal(apiErrorDetailCode("oops"), null)
  })

  test("returns null when the axios error has no response", () => {
    assert.equal(
      apiErrorDetailCode(
        buildAxiosError({ code: "ERR_NETWORK", message: "Network Error" }),
      ),
      null,
    )
  })
})
