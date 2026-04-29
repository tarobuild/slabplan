import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react"
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

export function FilePreviewProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>(null)

  const open = useCallback((files: PreviewFile[], index = 0) => {
    if (!files.length) return
    setState({ files, index })
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
