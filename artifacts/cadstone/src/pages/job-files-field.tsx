import FileBrowser from "@/components/FileBrowser"

type FieldJobAccess = {
  documents: boolean
  photos: boolean
  videos: boolean
  uploadDocuments?: boolean
  uploadPhotos?: boolean
  uploadVideos?: boolean
  createFolders?: boolean
}

type FieldJob = {
  access?: FieldJobAccess
} | null

const FILE_AREAS = [
  {
    key: "documents",
    title: "Project Files",
    mediaType: "document",
    defaultView: "list",
    uploadKey: "uploadDocuments",
    emptyLabel: "Project files",
  },
  {
    key: "photos",
    title: "Photos",
    mediaType: "photo",
    defaultView: "grid",
    uploadKey: "uploadPhotos",
    emptyLabel: "Photo files",
  },
  {
    key: "videos",
    title: "Videos",
    mediaType: "video",
    defaultView: "grid",
    uploadKey: "uploadVideos",
    emptyLabel: "Video files",
  },
] as const

export default function FieldJobFilesPage({ job }: { job: FieldJob }) {
  const access = job?.access
  const allowedAreas = FILE_AREAS.filter((area) => {
    if (!access) return true
    return access[area.key]
  })

  if (allowedAreas.length === 0) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white px-4 py-8 text-center">
        <p className="text-sm text-slate-500">You do not have access to job files.</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-slate-900">Files</h2>
        <p className="mt-1 text-sm text-slate-500">
          Open a folder to view files or add uploads where access is enabled.
        </p>
      </div>

      {allowedAreas.map((area) => (
        <section key={area.key} className="space-y-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-800">{area.title}</h3>
          </div>
          <FileBrowser
            mediaType={area.mediaType}
            defaultView={area.defaultView}
            rootLabel={area.emptyLabel}
            canUpload={access?.[area.uploadKey]}
            canCreateFolders={access?.createFolders}
          />
        </section>
      ))}
    </div>
  )
}
