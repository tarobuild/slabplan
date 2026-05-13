import { Link, useOutletContext, useParams } from "react-router-dom"
import { cn } from "@/lib/utils"
import FileBrowser from "@/components/FileBrowser"
import FieldJobFilesPage from "@/pages/job-files-field"
import { useDocumentTitle } from "@/hooks/use-document-title"
import { useAuthStore } from "@/store/auth"

const FILE_TABS = [
  { label: "Documents", path: "files/documents" },
  { label: "Photos", path: "files/photos" },
  { label: "Videos", path: "files/videos" },
]

type JobAccess = {
  documents: boolean
  photos: boolean
  videos: boolean
  uploadPhotos?: boolean
  createFolders?: boolean
}

function visibleTabs(access: JobAccess | undefined) {
  if (!access) return FILE_TABS
  return FILE_TABS.filter((tab) => {
    if (tab.path === "files/documents") return access.documents
    if (tab.path === "files/photos") return access.photos
    return access.videos
  })
}

export default function JobFilesPhotosPage() {
  useDocumentTitle("Job photos")
  const { jobId } = useParams<{ jobId: string }>()
  const { job } = useOutletContext<{ job: { access?: JobAccess } | null }>()
  const user = useAuthStore((state) => state.user)
  const isFieldUser = user?.role === "project_manager" || user?.role === "crew_member"
  const tabs = visibleTabs(job?.access)
  const canView = job?.access?.photos ?? true
  if (isFieldUser) {
    return <FieldJobFilesPage job={job} />
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-1 border-b border-[#E5E7EB]">
        {tabs.map(tab => (
          <Link
            key={tab.path}
            to={`/jobs/${jobId}/${tab.path}`}
            className={cn(
              "px-3 py-1.5 text-xs font-medium rounded-t transition-colors",
              tab.path === "files/photos"
                ? "bg-white border border-b-white border-[#E5E7EB] text-slate-900 -mb-px"
                : "text-slate-500 hover:text-slate-800",
            )}
          >
            {tab.label}
          </Link>
        ))}
      </div>
      {canView ? (
        <FileBrowser
          mediaType="photo"
          defaultView="grid"
          canUpload={job?.access?.uploadPhotos}
          canCreateFolders={job?.access?.createFolders}
        />
      ) : (
        <p className="text-sm text-slate-500">You do not have access to job photos.</p>
      )}
    </div>
  )
}
