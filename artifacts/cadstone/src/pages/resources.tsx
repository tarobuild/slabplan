import FileBrowser from "@/components/FileBrowser"
import PageHeader from "@/components/layout/PageHeader"
import { useDocumentTitle } from "@/hooks/use-document-title"

export default function ResourcesPage() {
  useDocumentTitle("Resources")
  return (
    <div>
      <PageHeader
        title="Resources"
      />

      <FileBrowser
        mediaType="document"
        scope="resource"
        rootLabel="Resources"
      />
    </div>
  )
}
