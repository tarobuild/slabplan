import { Link, useParams } from "react-router-dom"
import { cn } from "@/lib/utils"
import FileBrowser from "@/components/FileBrowser"
import { useDocumentTitle } from "@/hooks/use-document-title"

const FILE_TABS = [
  { label: "Documents", path: "files/documents" },
  { label: "Photos", path: "files/photos" },
  { label: "Videos", path: "files/videos" },
]

export default function JobFilesDocumentsPage() {
  useDocumentTitle("Job documents")
  const { jobId } = useParams<{ jobId: string }>()

  return (
    <div className="space-y-4">
      <div className="flex gap-1 border-b border-[#E5E7EB]">
        {FILE_TABS.map(tab => (
          <Link
            key={tab.path}
            to={`/jobs/${jobId}/${tab.path}`}
            className={cn(
              "px-3 py-1.5 text-xs font-medium rounded-t transition-colors",
              tab.path === "files/documents"
                ? "bg-white border border-b-white border-[#E5E7EB] text-slate-900 -mb-px"
                : "text-slate-500 hover:text-slate-800",
            )}
          >
            {tab.label}
          </Link>
        ))}
      </div>
      <FileBrowser mediaType="document" defaultView="list" />
    </div>
  )
}
