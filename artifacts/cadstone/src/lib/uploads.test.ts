import assert from "node:assert/strict"
import { describe, test } from "node:test"

import {
  MAX_VIDEO_DURATION_SECONDS,
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

  test("rejects .bat / .sh / .html across the blocklist", () => {
    for (const name of ["run.bat", "deploy.sh", "evil.html"]) {
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
})
