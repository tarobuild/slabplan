import type { SVGProps } from "react"
import { Loader2Icon } from "lucide-react"

import { cn } from "@/lib/utils"

type SpinnerProps = Omit<SVGProps<SVGSVGElement>, "children">

function Spinner({ className, ...props }: SpinnerProps) {
  return (
    <Loader2Icon
      role="status"
      aria-label="Loading"
      className={cn("size-4 animate-spin", className)}
      {...(props as any)}
    />
  )
}

export { Spinner }
