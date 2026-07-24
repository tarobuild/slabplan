import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react"
import { toast } from "sonner"
import { api } from "@/lib/api"
import { toastApiError } from "@/lib/api-errors"
import { inferPreviewKind } from "./file-preview-kind"
import { FilePreview, type PreviewFile } from "./FilePreview"

type FilePreviewContextValue = {
  open: (files: PreviewFile[], index?: number) => void
  close: () => void
}

const FilePreviewContext = createContext<FilePreviewContextValue | null>(null)

type State = {
  files: PreviewFile[]
  index: number
} | null

type SignedFileUrlResponse = {
  url: string
}

function isInlineDirectUrl(url: string | null | undefined): boolean {
  return !!url && (url.startsWith("data:") || url.startsWith("blob:"))
}

function openLoadingPdfTab(): Window | null {
  const newWindow = window.open("about:blank", "_blank")
  if (!newWindow) {
    toast.error("Please allow pop-ups to open this PDF.")
    return null
  }

  try {
    newWindow.document.write(
      '<!DOCTYPE html><title>Loading…</title>' +
        '<body style="margin:0;display:flex;align-items:center;justify-content:center;' +
        'height:100vh;font-family:sans-serif;color:#cbd5e1;background:#0f172a;">Loading PDF…</body>',
    )
    newWindow.opener = null
  } catch {
    // Keep the open path working even if browser policy blocks about:blank writes.
  }

  return newWindow
}

async function openPdfInBrowser(file: PreviewFile) {
  const directUrl = isInlineDirectUrl(file.directUrl) ? file.directUrl : null
  if (directUrl) {
    const opened = window.open(directUrl, "_blank", "noopener")
    if (!opened) toast.error("Please allow pop-ups to open this PDF.")
    return
  }

  const fileId = file.fileId || file.id || null
  if (!fileId) {
    toast.error("This PDF isn't available to open.")
    return
  }

  const newWindow = openLoadingPdfTab()
  if (!newWindow) return

  try {
    const res = await api.post<SignedFileUrlResponse>(`/files/${fileId}/signed-view`)
    if (!res.data.url) throw new Error("Missing signed view URL")
    newWindow.location.replace(res.data.url)
  } catch (err: unknown) {
    try {
      newWindow.close()
    } catch {
      // ignore
    }
    toastApiError(err, "Failed to open PDF.")
  }
}

export function FilePreviewProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>(null)

  const open = useCallback((files: PreviewFile[], index = 0) => {
    if (!files.length) return
    const safeIndex = Math.min(Math.max(index, 0), files.length - 1)
    const selectedFile = files[safeIndex]
    if (selectedFile && inferPreviewKind(selectedFile.mimeType, selectedFile.name) === "pdf") {
      void openPdfInBrowser(selectedFile)
      return
    }
    setState({ files, index: safeIndex })
  }, [])

  const close = useCallback(() => setState(null), [])

  const value = useMemo<FilePreviewContextValue>(() => ({ open, close }), [open, close])

  return (
    <FilePreviewContext.Provider value={value}>
      {children}
      <FilePreview
        files={state?.files ?? []}
        initialIndex={state?.index ?? 0}
        open={!!state}
        onClose={close}
      />
    </FilePreviewContext.Provider>
  )
}

export function useFilePreview() {
  const ctx = useContext(FilePreviewContext)
  if (!ctx) {
    throw new Error("useFilePreview must be used inside <FilePreviewProvider>")
  }
  return ctx
}
