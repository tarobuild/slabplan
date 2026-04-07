import { Link } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"

export default function NotFoundPage() {
  return (
    <Card className="mx-auto mt-12 max-w-xl border-[#E5E7EB] bg-white shadow-sm">
      <CardContent className="space-y-4 px-6 py-10 text-center">
        <h1 className="text-2xl font-semibold text-slate-950">Page not found</h1>
        <p className="text-sm text-slate-500">
          This route is outside the current frontend scaffold.
        </p>
        <Button asChild>
          <Link to="/dashboard">Return to Dashboard</Link>
        </Button>
      </CardContent>
    </Card>
  )
}
