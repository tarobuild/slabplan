import { Component, type ErrorInfo, type ReactNode } from "react"
import { AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"

type Props = {
  children: ReactNode
  title?: string
}

type State = {
  hasError: boolean
}

export class RouteErrorBoundary extends Component<Props, State> {
  state: State = {
    hasError: false,
  }

  static getDerivedStateFromError() {
    return {
      hasError: true,
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Route error boundary caught an error", error, info)
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children
    }

    return (
      <Card className="border-[#E5E7EB] bg-white shadow-sm">
        <CardContent className="flex flex-col items-center gap-4 px-6 py-12 text-center">
          <div className="rounded-full border border-red-200 bg-red-50 p-3 text-red-600">
            <AlertTriangle className="size-5" />
          </div>
          <div className="space-y-1">
            <h2 className="text-lg font-semibold text-slate-950">
              {this.props.title || "Something went wrong"}
            </h2>
            <p className="max-w-md text-sm text-slate-500">
              This route hit an unexpected error. Refresh the view and try again.
            </p>
          </div>
          <Button type="button" onClick={() => window.location.reload()}>
            Retry
          </Button>
        </CardContent>
      </Card>
    )
  }
}
