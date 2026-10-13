import clsx from "clsx";
import type { ReactNode } from "react";

export type Tone = "neutral" | "primary" | "success" | "warning" | "danger" | "lavender" | "teal";

const tones: Record<Tone, string> = {
  neutral: "bg-surface-alt text-ink-soft",
  primary: "bg-primary-tint text-primary-strong",
  success: "bg-success-tint text-success",
  warning: "bg-warning-tint text-warning",
  danger: "bg-danger-tint text-danger",
  lavender: "bg-lavender-tint text-lavender-ink",
  teal: "bg-teal-tint text-teal-ink",
};

export function Badge({ tone = "neutral", icon, children, className }: { tone?: Tone; icon?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
        tones[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}
