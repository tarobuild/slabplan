export type PreviewKind =
  | "image"
  | "video"
  | "audio"
  | "pdf"
  | "text"
  | "unsupported"

export function inferPreviewKind(
  mime: string | null | undefined,
  name: string,
): PreviewKind {
  const lower = name.toLowerCase()

  if (/\.(png|jpe?g|gif|webp|heic|bmp|tiff?)$/.test(lower)) return "image"
  if (/\.(mp4|mov|webm|m4v|avi|mkv)$/.test(lower)) return "video"
  if (/\.(mp3|wav|m4a|ogg|flac|aac)$/.test(lower)) return "audio"
  if (/\.pdf$/.test(lower)) return "pdf"

  const m = (mime || "").toLowerCase()
  if (m.startsWith("image/")) return "image"
  if (m.startsWith("video/")) return "video"
  if (m.startsWith("audio/")) return "audio"
  if (m === "application/pdf") return "pdf"
  if (
    m.startsWith("text/") ||
    m === "application/json" ||
    m === "application/xml" ||
    m === "application/javascript" ||
    m === "application/x-yaml"
  ) {
    return "text"
  }

  if (/\.(txt|md|markdown|json|xml|yml|yaml|csv|log|js|jsx|ts|tsx|css|html?)$/.test(lower)) {
    return "text"
  }

  return "unsupported"
}
