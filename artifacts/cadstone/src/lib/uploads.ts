import {
  MAX_UPLOAD_FILE_BYTES,
  MAX_UPLOAD_FILE_COUNT,
  formatUploadSize,
} from "@workspace/api-zod"

export type UploadMediaType = "document" | "photo" | "video"

// The size and count limits live in @workspace/api-zod so the file picker
// and the multer config on the server cannot drift apart. Keep the legacy
// names as re-exports so existing call sites don't churn.
export const UPLOAD_MAX_FILE_SIZE_BYTES = MAX_UPLOAD_FILE_BYTES
export const UPLOAD_MAX_FILES = MAX_UPLOAD_FILE_COUNT

const documentExtensions = [
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
  ".txt",
  ".csv",
]

const photoExtensions = [".jpg", ".jpeg", ".png", ".gif", ".webp"]
const videoExtensions = [".mp4", ".mov", ".avi", ".webm", ".m4v"]

const documentMimeTypes = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
  "text/plain",
  "text/csv",
])

const photoMimeTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
])

const videoMimeTypes = new Set([
  "video/mp4",
  "video/quicktime",
  "video/x-msvideo",
  "video/webm",
  "video/x-m4v",
])

const documentAcceptMimeTypes = [
  "application/pdf",
  "application/msword",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
  "text/csv",
]

function lowerExtension(fileName: string) {
  const index = fileName.lastIndexOf(".")
  return index >= 0 ? fileName.slice(index).toLowerCase() : ""
}

const formatMaxFileSize = formatUploadSize

function isAllowedDocumentMimeType(value: string) {
  return documentMimeTypes.has(value) || value.startsWith("application/vnd.openxmlformats-officedocument.")
}

function invalidTypeMessage(mediaType: UploadMediaType) {
  if (mediaType === "photo") {
    return "Photos must be image files (.jpg, .png, .gif, .webp)."
  }

  if (mediaType === "video") {
    return "Videos must be video files (.mp4, .mov, .avi, .webm)."
  }

  return "Documents must be supported office, text, or PDF files."
}

export function uploadAcceptForMediaType(mediaType: UploadMediaType) {
  if (mediaType === "photo") {
    return [...photoExtensions, ...photoMimeTypes].join(",")
  }

  if (mediaType === "video") {
    return [...videoExtensions, ...videoMimeTypes].join(",")
  }

  return [...documentExtensions, ...documentAcceptMimeTypes].join(",")
}

export function validateSelectedFiles(
  files: File[],
  mediaType: UploadMediaType,
  options?: {
    maxFileSizeBytes?: number
    maxFiles?: number
  },
) {
  const maxFileSizeBytes = options?.maxFileSizeBytes ?? UPLOAD_MAX_FILE_SIZE_BYTES
  const maxFiles = options?.maxFiles ?? UPLOAD_MAX_FILES

  if (files.length > maxFiles) {
    return `You can upload up to ${maxFiles} files at a time.`
  }

  for (const file of files) {
    if (file.size > maxFileSizeBytes) {
      return `${file.name} exceeds the ${formatMaxFileSize(maxFileSizeBytes)} file size limit.`
    }

    const extension = lowerExtension(file.name)
    const mimeType = file.type.toLowerCase()

    const isAllowed =
      mediaType === "photo"
        ? photoExtensions.includes(extension) && photoMimeTypes.has(mimeType)
        : mediaType === "video"
          ? videoExtensions.includes(extension) && videoMimeTypes.has(mimeType)
          : documentExtensions.includes(extension) && isAllowedDocumentMimeType(mimeType)

    if (!isAllowed) {
      return `${file.name}: ${invalidTypeMessage(mediaType)}`
    }
  }

  return null
}
