import assert from "node:assert/strict"
import { describe, test } from "node:test"

import {
  DEFAULT_UPLOAD_TIMEOUT_MS,
  MAX_VIDEO_DURATION_SECONDS,
  UPLOAD_MAX_FILE_SIZE_BYTES,
  uploadFileWithChunks,
  uploadWithProgress,
  validateSelectedFiles,
  validateSelectedFilesAsync,
  validateVideoDurations,
} from "./uploads.ts"

function makeFile(name: string, mimeType: string, size = 16): File {
  return new File([new Uint8Array(size)], name, { type: mimeType })
}

describe("validateSelectedFiles", () => {
  test("accepts a .pdf with the standard application/pdf MIME", () => {
    const error = validateSelectedFiles([makeFile("plan.pdf", "application/pdf")], "document")
    assert.equal(error, null)
  })

  test("accepts a .docx whose browser MIME is the openxml type", () => {
    const error = validateSelectedFiles(
      [
        makeFile(
          "spec.docx",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ),
      ],
      "document",
    )
    assert.equal(error, null)
  })

  test("accepts a .docx when the browser reports application/octet-stream", () => {
    // Some Windows file pickers and older browsers report a generic
    // MIME for .docx uploads. The server still does the authoritative
    // magic-byte check, so the front-end must not dead-end the user.
    const error = validateSelectedFiles(
      [makeFile("spec.docx", "application/octet-stream")],
      "document",
    )
    assert.equal(error, null)
  })

  test("accepts a .csv with an empty MIME (Safari behaviour)", () => {
    const error = validateSelectedFiles([makeFile("data.csv", "")], "document")
    assert.equal(error, null)
  })

  test("accepts a .dwg CAD drawing with an empty browser MIME", () => {
    // Browsers don't have a built-in MIME for AutoCAD DWG, so the file
    // picker reports "" — we used to block this on the front-end and
    // strand contractors who routinely attach drawings.
    const error = validateSelectedFiles([makeFile("site.dwg", "")], "document")
    assert.equal(error, null)
  })

  test("accepts a HEIC photo, an MP3 voice memo, and a ZIP of plans", () => {
    for (const f of [
      makeFile("burst.heic", "image/heic"),
      makeFile("voicememo.mp3", "audio/mpeg"),
      makeFile("plans.zip", "application/zip"),
      makeFile("raw.cr2", ""),
    ]) {
      assert.equal(validateSelectedFiles([f], "document"), null, `${f.name} should be accepted`)
    }
  })

  test("accepts lead-sized project PDFs above the former 500 MB cap", () => {
    const largePdf = {
      name: "K Bakery - Issue for Construction-260409.pdf",
      type: "application/pdf",
      size: 600 * 1024 * 1024,
    } as File

    assert.equal(UPLOAD_MAX_FILE_SIZE_BYTES, 2 * 1024 * 1024 * 1024)
    assert.equal(validateSelectedFiles([largePdf], "document"), null)
  })

  test("rejects a .exe with a clear, extension-named message", () => {
    // Loosening the MIME check must not loosen the extension check —
    // a renamed executable still has a non-document extension and
    // must be refused before it leaves the browser.
    const error = validateSelectedFiles(
      [makeFile("payload.exe", "application/octet-stream")],
      "document",
    )
    assert.ok(error, "expected a validation error for .exe")
    assert.match(error!, /\.exe/)
    assert.match(error!, /aren't allowed for safety/)
  })

  test("rejects .bat / .sh / .html / .svg across the blocklist", () => {
    for (const name of ["run.bat", "deploy.sh", "evil.html", "payload.svg"]) {
      const error = validateSelectedFiles([makeFile(name, "")], "document")
      assert.ok(error, `${name} should be blocked`)
    }
  })

  test("does not block .pdf even when the MIME looks unusual (server is authoritative)", () => {
    // Front-end no longer second-guesses the MIME for legitimate
    // extensions. The server's PDF magic-byte check catches a renamed
    // payload before storage.
    const error = validateSelectedFiles([makeFile("plan.pdf", "image/png")], "document")
    assert.equal(error, null)
  })
})

describe("validateVideoDurations", () => {
  test("lets a 30-second clip through", async () => {
    const error = await validateVideoDurations(
      [makeFile("walkaround.mp4", "video/mp4")],
      { probe: () => Promise.resolve(30) },
    )
    assert.equal(error, null)
  })

  test("accepts a clip exactly at the 2-minute limit", async () => {
    const error = await validateVideoDurations(
      [makeFile("limit.mp4", "video/mp4")],
      { probe: () => Promise.resolve(MAX_VIDEO_DURATION_SECONDS) },
    )
    assert.equal(error, null)
  })

  test("rejects a 3-minute clip with a message naming the file and length", async () => {
    const error = await validateVideoDurations(
      [makeFile("walkthrough.mov", "video/quicktime")],
      { probe: () => Promise.resolve(180) },
    )
    assert.ok(error, "expected a duration error")
    assert.match(error!, /walkthrough\.mov/)
    assert.match(error!, /3m/)
    assert.match(error!, /2 minutes? or shorter/)
  })

  test("lets unreadable metadata fall through to the server", async () => {
    const error = await validateVideoDurations(
      [makeFile("corrupt.mp4", "video/mp4")],
      { probe: () => Promise.resolve(null) },
    )
    assert.equal(error, null)
  })

  test("ignores non-video selections without invoking the probe", async () => {
    let probeCalls = 0
    const error = await validateVideoDurations(
      [makeFile("notes.pdf", "application/pdf")],
      {
        probe: () => {
          probeCalls += 1
          return Promise.resolve(999)
        },
      },
    )
    assert.equal(error, null)
    assert.equal(probeCalls, 0)
  })

  test("probes advertised video extensions even when MIME is generic", async () => {
    const extensions = [".mp4", ".mov", ".avi", ".webm", ".m4v", ".mkv", ".wmv", ".flv", ".3gp"]
    let probeCalls = 0
    const error = await validateVideoDurations(
      extensions.map((extension) => makeFile(`clip${extension}`, "application/octet-stream")),
      {
        probe: () => {
          probeCalls += 1
          return Promise.resolve(30)
        },
      },
    )
    assert.equal(error, null)
    assert.equal(probeCalls, extensions.length)
  })
})

describe("validateSelectedFilesAsync (video)", () => {
  test("accepts a .mp4 well under the limit", async () => {
    const error = await validateSelectedFilesAsync(
      [makeFile("intro.mp4", "video/mp4")],
      "video",
      { probeDuration: () => Promise.resolve(30) },
    )
    assert.equal(error, null)
  })

  test("rejects a .mp4 longer than 2 minutes before the upload starts", async () => {
    const error = await validateSelectedFilesAsync(
      [makeFile("long.mp4", "video/mp4")],
      "video",
      { probeDuration: () => Promise.resolve(180) },
    )
    assert.ok(error)
    assert.match(error!, /long\.mp4/)
    assert.match(error!, /3m/)
  })

  test("falls back to the synchronous error first (e.g. dangerous extension)", async () => {
    // The picker now uses the wide-accept attribute everywhere and
    // `validateSelectedFiles` only enforces size, count, and the shared
    // dangerous-extension blocklist. The async helper must short-circuit
    // on those sync failures and never invoke the duration probe.
    let probed = false
    const error = await validateSelectedFilesAsync(
      [makeFile("payload.exe", "application/octet-stream")],
      "video",
      {
        probeDuration: () => {
          probed = true
          return Promise.resolve(10)
        },
      },
    )
    assert.ok(error)
    assert.match(error!, /\.exe files aren't allowed/)
    assert.equal(probed, false)
  })

  test("lets unreadable metadata pass — server stays the safety net", async () => {
    const error = await validateSelectedFilesAsync(
      [makeFile("exotic.mp4", "video/mp4")],
      "video",
      { probeDuration: () => Promise.resolve(null) },
    )
    assert.equal(error, null)
  })
})

describe("uploadWithProgress", () => {
  test("marks non-JSON 403 responses as plain forbidden upload errors", async () => {
    class PlainForbiddenXMLHttpRequest {
      static instances: PlainForbiddenXMLHttpRequest[] = []

      upload = { addEventListener: () => undefined }
      timeout = 0
      withCredentials = false
      responseType: XMLHttpRequestResponseType = ""
      status = 403
      responseText = "Forbidden"
      onload: XMLHttpRequest["onload"] = null
      onerror: XMLHttpRequest["onerror"] = null
      ontimeout: XMLHttpRequest["ontimeout"] = null
      onabort: XMLHttpRequest["onabort"] = null

      constructor() {
        PlainForbiddenXMLHttpRequest.instances.push(this)
      }

      open() {}
      setRequestHeader() {}
      getResponseHeader(name: string) {
        return name.toLowerCase() === "content-type" ? "text/plain" : null
      }
      abort() {
        this.onabort?.call(this as unknown as XMLHttpRequest, new Event("abort") as ProgressEvent)
      }
      send() {
        queueMicrotask(() => {
          this.onload?.call(this as unknown as XMLHttpRequest, new Event("load") as ProgressEvent)
        })
      }
    }

    const previousXMLHttpRequest = globalThis.XMLHttpRequest
    globalThis.XMLHttpRequest = PlainForbiddenXMLHttpRequest as unknown as typeof XMLHttpRequest

    try {
      await assert.rejects(
        uploadWithProgress({
          url: "/folders/test/files",
          formData: new FormData(),
          maxAttempts: 1,
        }),
        (error) => {
          assert.equal((error as { status?: number }).status, 403)
          assert.equal((error as { code?: string }).code, "UPLOAD_FORBIDDEN_PLAIN_RESPONSE")
          assert.deepEqual((error as { details?: unknown }).details, {
            structured: false,
            responseContentType: "text/plain",
            rawBody: "Forbidden",
          })
          return true
        },
      )
    } finally {
      globalThis.XMLHttpRequest = previousXMLHttpRequest
    }
  })

  test("chunked uploads retry a plain 403 raw chunk as base64 text", async () => {
    const file = new File([new Uint8Array([1, 2, 3, 4, 5])], "edge-photo.jpg", {
      type: "image/jpeg",
    })
    const fetchCalls: Array<{ url: string; init?: RequestInit }> = []
    const xhrSends: Array<{
      url: string
      headers: Record<string, string>
      body: unknown
    }> = []

    class PlainForbiddenThenBase64XMLHttpRequest {
      upload = { addEventListener: () => undefined }
      timeout = 0
      withCredentials = false
      responseType: XMLHttpRequestResponseType = ""
      status = 0
      responseText = ""
      onload: XMLHttpRequest["onload"] = null
      onerror: XMLHttpRequest["onerror"] = null
      ontimeout: XMLHttpRequest["ontimeout"] = null
      onabort: XMLHttpRequest["onabort"] = null
      private responseContentType = "application/json"
      private url = ""
      private headers: Record<string, string> = {}

      open(_method: string, url: string) {
        this.url = url
      }
      setRequestHeader(name: string, value: string) {
        this.headers[name.toLowerCase()] = value
      }
      getResponseHeader(name: string) {
        return name.toLowerCase() === "content-type" ? this.responseContentType : null
      }
      abort() {
        this.onabort?.call(this as unknown as XMLHttpRequest, new Event("abort") as ProgressEvent)
      }
      send(body: unknown) {
        xhrSends.push({ url: this.url, headers: this.headers, body })
        if (this.headers["content-type"] === "text/plain") {
          this.status = 200
          this.responseContentType = "application/json"
          this.responseText = JSON.stringify({ transport: "base64" })
        } else {
          this.status = 403
          this.responseContentType = "text/plain"
          this.responseText = "Forbidden"
        }
        queueMicrotask(() => {
          this.onload?.call(this as unknown as XMLHttpRequest, new Event("load") as ProgressEvent)
        })
      }
    }

    const previousFetch = globalThis.fetch
    const previousXMLHttpRequest = globalThis.XMLHttpRequest
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      fetchCalls.push({ url, init })
      if (url.endsWith("/api/folders/folder-1/files/chunked")) {
        return new Response(JSON.stringify({ session: { uploadId: "upload-1" } }), {
          status: 201,
          headers: { "content-type": "application/json" },
        })
      }
      if (url.endsWith("/api/folders/folder-1/files/chunked/upload-1/complete")) {
        return new Response(JSON.stringify({ status: "uploaded" }), {
          status: 201,
          headers: { "content-type": "application/json" },
        })
      }
      return new Response("not found", { status: 404 })
    }) as typeof fetch
    globalThis.XMLHttpRequest = PlainForbiddenThenBase64XMLHttpRequest as unknown as typeof XMLHttpRequest

    try {
      const result = await uploadFileWithChunks<{ status: string }>({
        folderId: "folder-1",
        file,
        chunkSizeBytes: 1024,
      })

      assert.equal(result.status, "uploaded")
      assert.equal(fetchCalls.length, 2)
      assert.equal(xhrSends.length, 2)
      assert.equal(xhrSends[0]?.headers["content-type"], "application/octet-stream")
      assert.ok(xhrSends[0]?.body instanceof Blob)
      assert.equal(xhrSends[1]?.headers["content-type"], "text/plain")
      assert.equal(xhrSends[1]?.body, "AQIDBAU=")
    } finally {
      globalThis.fetch = previousFetch
      globalThis.XMLHttpRequest = previousXMLHttpRequest
    }
  })

  test("configures a request timeout and surfaces XHR timeout failures", async () => {
    class TimeoutXMLHttpRequest {
      static instances: TimeoutXMLHttpRequest[] = []

      upload = { addEventListener: () => undefined }
      timeout = 0
      withCredentials = false
      responseType: XMLHttpRequestResponseType = ""
      onload: XMLHttpRequest["onload"] = null
      onerror: XMLHttpRequest["onerror"] = null
      ontimeout: XMLHttpRequest["ontimeout"] = null
      onabort: XMLHttpRequest["onabort"] = null

      constructor() {
        TimeoutXMLHttpRequest.instances.push(this)
      }

      open() {}
      setRequestHeader() {}
      abort() {
        this.onabort?.call(this as unknown as XMLHttpRequest, new Event("abort") as ProgressEvent)
      }
      send() {
        queueMicrotask(() => {
          this.ontimeout?.call(
            this as unknown as XMLHttpRequest,
            new Event("timeout") as ProgressEvent,
          )
        })
      }
    }

    const previousXMLHttpRequest = globalThis.XMLHttpRequest
    globalThis.XMLHttpRequest = TimeoutXMLHttpRequest as unknown as typeof XMLHttpRequest

    try {
      await assert.rejects(
        uploadWithProgress({
          url: "/folders/test/files",
          formData: new FormData(),
          maxAttempts: 1,
        }),
        (error) => {
          assert.equal((error as { code?: string }).code, "UPLOAD_NETWORK_TIMEOUT")
          assert.match((error as Error).message, /timed out/i)
          return true
        },
      )
      assert.equal(TimeoutXMLHttpRequest.instances[0]?.timeout, DEFAULT_UPLOAD_TIMEOUT_MS)
    } finally {
      globalThis.XMLHttpRequest = previousXMLHttpRequest
    }
  })
})

// Component-level coverage: verify the actual upload-picker call sites
// (Files > Videos via FileBrowser, daily-logs attachment dropzone)
// route their selections through the shared async validator. The unit
// tests above prove the validator rejects long videos with a message
// that names the file and length; this test prevents the wiring from
// silently regressing.
import * as nodeFs from "node:fs/promises"
import * as nodePath from "node:path"
import { fileURLToPath } from "node:url"

describe("upload pickers wire the async video-duration check", () => {
  const here = nodePath.dirname(fileURLToPath(import.meta.url))

  test("FileBrowser routes the file picker through validateSelectedFilesAsync", async () => {
    const source = await nodeFs.readFile(
      nodePath.join(here, "..", "components", "FileBrowser.tsx"),
      "utf8",
    )
    assert.match(source, /validateSelectedFilesAsync/, "FileBrowser must import the async validator")
    // Both the click-to-upload picker (handleUploadSelection) and the
    // drag-and-drop callback (onDrop) must run the async check so a
    // long video is rejected before the upload starts.
    const callMatches = source.match(/validateSelectedFilesAsync\s*\(/g) ?? []
    assert.ok(callMatches.length >= 2, "expected validateSelectedFilesAsync to be called from both the picker and the dropzone")
  })

  test("daily-logs attachment dropzone routes selections through validateSelectedFilesAsync", async () => {
    const source = await nodeFs.readFile(
      nodePath.join(here, "..", "pages", "job-daily-logs.tsx"),
      "utf8",
    )
    assert.match(source, /validateSelectedFilesAsync/, "daily-logs page must import the async validator")
    assert.match(
      source,
      /validateSelectedFilesAsync\s*\(\s*\[\s*\.\.\.pendingFiles/,
      "daily-logs onDrop must call validateSelectedFilesAsync on the combined attachment list",
    )
  })

  test("the video upload hint mentions the 2-minute limit", async () => {
    const source = await nodeFs.readFile(
      nodePath.join(here, "..", "components", "FileBrowser.tsx"),
      "utf8",
    )
    assert.match(source, /videoUploadHint\s*\(\s*\)/, "FileBrowser should render the shared video upload hint")
  })

  test("FileBrowser chunks proxy-sized uploads before the hard app limit", async () => {
    const source = await nodeFs.readFile(
      nodePath.join(here, "..", "components", "FileBrowser.tsx"),
      "utf8",
    )
    assert.match(source, /DIRECT_UPLOAD_CHUNKING_THRESHOLD_BYTES/, "FileBrowser must import the direct-upload chunking threshold")
    assert.match(source, /file\.size > DIRECT_UPLOAD_CHUNKING_THRESHOLD_BYTES/, "FileBrowser must route proxy-sized files through chunked upload")
  })

  test("FileBrowser routes job photo and video uploads through chunked upload by default", async () => {
    const source = await nodeFs.readFile(
      nodePath.join(here, "..", "components", "FileBrowser.tsx"),
      "utf8",
    )
    assert.match(
      source,
      /mediaType !== "document"/,
      "FileBrowser must route job Photos/Videos through chunked upload even when individual files are below the proxy-sized threshold",
    )
  })

  test("lead attachment uploads route large files through the lead chunked endpoint", async () => {
    const source = await nodeFs.readFile(
      nodePath.join(here, "..", "pages", "leads.tsx"),
      "utf8",
    )
    assert.match(source, /uploadLeadAttachmentWithChunks/, "Leads page must import the lead chunked upload helper")
    assert.match(source, /leadsGetLeadsIdAttachmentsUploadPolicy/, "Lead attachments must ask the API for the live upload policy")
    assert.match(source, /policy\.multipart\.maxAppFileSizeBytes/, "Lead attachments must enforce the policy app max instead of a stale bundled cap")
    assert.match(source, /file\.size > DIRECT_UPLOAD_CHUNKING_THRESHOLD_BYTES/, "Lead attachments must chunk large files before multipart upload")
    assert.match(source, /maxFileSizeBytes:\s*Number\.MAX_SAFE_INTEGER/, "Lead attachment pickers must not block policy-sized files before policy lookup")
  })

  test("lead attachment rows download directly instead of opening the file preview", async () => {
    const source = await nodeFs.readFile(
      nodePath.join(here, "..", "pages", "leads.tsx"),
      "utf8",
    )
    assert.match(source, /downloadLeadAttachment/, "Lead attachment rows must have a direct download action")
    assert.match(source, /\/files\/\$\{att\.fileId\}\/signed-download/, "Lead attachment downloads must mint a signed download URL")
    assert.match(source, /window\.location\.assign\(response\.data\.url\)/, "Lead downloads must use an unblockable same-tab download navigation")
    assert.doesNotMatch(source, /\/files\/\$\{att\.fileId\}\/download[`"]/, "Lead attachment downloads must not buffer the file through Axios before saving")
    assert.doesNotMatch(source, /anchor\.click\(\)/, "Lead downloads must not rely on a delayed synthetic click")
    assert.doesNotMatch(source, /useFilePreview/, "Lead attachments should not mount the preview modal hook")
    assert.doesNotMatch(source, /filePreview\.open/, "Lead attachment clicks should not open the preview modal")
  })
})
