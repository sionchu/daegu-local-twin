import * as React from "react";
import { cn } from "@/lib/utils";

type BadgeVariant = "default" | "outline" | "amber" | "blue" | "danger";

const variants: Record<BadgeVariant, string> = {
  default: "border-emerald-300/20 bg-emerald-300/10 text-emerald-100",
  outline: "border-white/12 bg-white/[0.04] text-[color:var(--muted-foreground)]",
  amber: "border-amber-300/20 bg-amber-300/10 text-amber-100",
  blue: "border-sky-300/20 bg-sky-300/10 text-sky-100",
  danger: "border-rose-300/20 bg-rose-300/10 text-rose-100",
};

export function Badge({
  className,
  variant = "default",
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { variant?: BadgeVariant }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium tracking-wide",
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}
