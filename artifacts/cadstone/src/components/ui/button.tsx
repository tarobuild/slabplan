import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

// One clear primary action per view (filled deep orange, AA contrast), quiet
// secondary actions (outline / ghost), and generous hit targets.
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-semibold transition-[color,background-color,border-color,box-shadow,transform] duration-150 focus-visible:outline-none focus-visible:ring-[3px] active:scale-[0.97] motion-reduce:active:scale-100 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0" +
" hover-elevate active-elevate-2",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground border border-primary-border shadow-sm focus-visible:ring-ring/35",
        destructive:
          "bg-destructive text-destructive-foreground shadow-xs border border-destructive-border focus-visible:ring-destructive/35",
        outline:
          "border border-border bg-card text-foreground shadow-xs focus-visible:ring-ring/30",
        secondary:
          "border border-transparent bg-accent text-accent-foreground focus-visible:ring-ring/30",
        ghost:
          "border border-transparent text-foreground/85 focus-visible:ring-ring/30",
        link:
          "text-primary underline-offset-4 hover:underline focus-visible:ring-ring/30",
      },
      size: {
        default: "min-h-10 px-5 py-2",
        sm: "min-h-8 px-3.5 text-[13px]",
        lg: "min-h-12 px-7 text-[15px]",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, type = "button", ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...(!asChild ? { type } : {})}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
