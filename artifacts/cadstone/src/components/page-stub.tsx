import type { ReactNode } from "react"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export default function PageStub({
  title,
  route,
  description,
  children,
}: {
  title: string
  route: string
  description: string
  children?: ReactNode
}) {
  return (
    <Card className="border-[#E5E7EB] bg-white shadow-sm">
      <CardHeader className="gap-3 border-b border-[#E5E7EB]">
        <div className="flex items-center justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="text-xl text-slate-950">{title}</CardTitle>
            <CardDescription className="text-sm text-slate-500">{description}</CardDescription>
          </div>
          <Badge variant="outline" className="border-[#E5E7EB] bg-[#F9FAFB] text-slate-600">
            {route}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 p-6">
        <div className="rounded-lg border border-dashed border-[#E5E7EB] bg-[#F9FAFB] p-6 text-sm text-slate-500">
          Scaffold placeholder. Codex will replace this with the real page UI from
          `CODEX_FRONTEND_GUIDE.md`.
        </div>
        {children}
      </CardContent>
    </Card>
  )
}
