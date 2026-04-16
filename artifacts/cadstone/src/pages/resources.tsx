import { LibraryBig } from "lucide-react"
import FileBrowser from "@/components/FileBrowser"
import { useDocumentTitle } from "@/hooks/use-document-title"

export default function ResourcesPage() {
  useDocumentTitle("Resources")
  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center gap-2">
          <LibraryBig className="size-6 text-slate-700" />
          <h1 className="text-2xl font-bold text-slate-900">Resources</h1>
        </div>
        <p className="mt-0.5 text-sm text-slate-500">
          Company-wide SOPs, reference documents, and shared files.
        </p>
      </div>

      <div className="border-t border-slate-200" />

      <FileBrowser
        mediaType="document"
        scope="resource"
        rootLabel="Resources"
      />
    </div>
  )
}
