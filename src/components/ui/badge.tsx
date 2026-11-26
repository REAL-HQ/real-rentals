import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";
import { DANGER_BADGE } from "@/lib/badge-tone";

const badgeVariants = cva(
  "inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground shadow hover:bg-primary/80",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
        destructive:
          `border-transparent ${DANGER_BADGE}`,
        outline: "text-foreground",
        success: "border-success/20 bg-success-soft text-success",
        warning: "border-warning/30 bg-warning-soft text-warning-foreground",
        occupied: "border-status-occupied/20 bg-status-occupied-soft text-status-occupied",
        attention: "border-destructive/20 bg-danger-soft text-destructive",
        white: "border-border bg-white text-muted-foreground",
        neutral: "border-border bg-secondary text-muted-foreground",
        sale: "border-[#007AFF]/30 bg-[#E8F3FF] text-[#007AFF]",
        pending: "border-[#E6B325]/50 bg-[#FFF4CC] text-[#7A5B00]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
