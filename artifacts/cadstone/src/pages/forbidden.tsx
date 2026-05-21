import { Link } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { useDocumentTitle } from "@/hooks/use-document-title"

export default function ForbiddenPage() {
  useDocumentTitle("Access denied")
  return (
    <Card className="mx-auto mt-12 max-w-xl border-border bg-card shadow-sm">
      <CardContent className="space-y-4 px-6 py-10 text-center">
        <h1 className="text-2xl font-semibold text-foreground">Access denied</h1>
        <p className="text-sm text-muted-foreground">
          You don&apos;t have permission to view that page. If you think this is a
          mistake, contact your administrator.
        </p>
        <Button asChild>
          <Link to="/dashboard">Return to Dashboard</Link>
        </Button>
      </CardContent>
    </Card>
  )
}
