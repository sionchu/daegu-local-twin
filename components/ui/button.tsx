import * as React from "react";
import { cn } from "@/lib/utils";

type ButtonVariant = "default" | "outline" | "ghost" | "secondary";

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: "sm" | "md";
};

const variants: Record<ButtonVariant, string> = {
  default:
    "border border-transparent bg-[color:var(--primary)] text-slate-950 hover:brightness-105",
  outline:
    "border border-white/12 bg-white/[0.035] text-[color:var(--foreground)] hover:bg-white/[0.075]",
  ghost:
    "border border-transparent bg-transparent text-[color:var(--muted-foreground)] hover:bg-white/[0.06] hover:text-[color:var(--foreground)]",
  secondary:
    "border border-amber-300/20 bg-amber-300/10 text-amber-100 hover:bg-amber-300/15",
};

export function Button({
  className,
  variant = "default",
  size = "md",
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-xl font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--primary)] disabled:pointer-events-none disabled:opacity-50",
        size === "sm" ? "h-8 px-3 text-xs" : "h-10 px-4 text-sm",
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}
